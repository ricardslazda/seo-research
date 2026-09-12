import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    fixtureTransport,
    okEnvelope,
    serpOrganicEndpoint,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { parseSiteConfig } from '../../config/site-config.js';
import { SqliteCacheStore } from '../../db/cache-store.js';
import { openDatabase } from '../../db/open.js';
import { decide } from '../../decide.js';
import { keywordMetrics, keywords } from '../../db/schema.js';
import type { Reference } from '../../reference/index.js';
import { renderClustersReport } from '../../report/clusters-report.js';
import { planCluster, runCluster } from './gather.js';
import { readClusters } from './readings.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en'],
    places: [{ slug: 'northbridge', location_code: 1001001, name: { en: { nom: 'Northbridge' } } }],
    services: [{ key: 'plumber', head: { en: { term: 'plumber' } } }],
    head_forms: { en: [{ term: 'term', place: 'nom' }] },
    vocabulary: { modifiers: { price: '(\\bprices?\\b|\\bcosts?\\b)' } },
});
const reference: Reference = {
    locations: {
        '1001001': {
            code: 1001001,
            name: 'Northbridge,Testland',
            type: 'City',
            parent: null,
            countryIso: 'ZZ',
            sources: ['serp', 'ads'],
        },
    },
    support: {
        global: { ads: ['en'], serp: ['en'] },
        countries: { ZZ: { labs: ['en'] } },
        intentLanguages: ['en'],
    },
    prices: null,
    domains: {
        ZZ: { directory: ['directory-one.example'], classifieds: ['classifieds-hub.example'] },
    },
};

const distinct = (): DfsEnvelope => {
    const base = fixture('serp-organic-en');
    const result = structuredClone(base.tasks[0]!.result![0]) as {
        items: { type: string; url?: string; domain?: string; title?: string }[];
    };
    result.items = result.items.filter((item) => item.type !== 'local_pack');
    for (const item of result.items) {
        if (item.type === 'organic' && item.url) {
            item.url = item.url.replace(/https:\/\/[^/]+/, 'https://other.example');
            item.domain = 'other.example';
        }
    }
    return okEnvelope([result], 0.004);
};

const setup = () => {
    const { transport, sent } = fixtureTransport({
        [serpOrganicEndpoint.path]: [
            fixture('serp-organic-en'),
            fixture('serp-organic-en'),
            distinct(),
        ],
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    const ids = ['plumber northbridge', 'emergency plumber northbridge', 'plumbing prices'].map(
        (text) =>
            db
                .insert(keywords)
                .values({ text, language: 'en', locationCode: 1001001, role: 'ads_idea' })
                .returning({ id: keywords.id })
                .get()!.id,
    );
    for (const [i, id] of ids.entries())
        db.insert(keywordMetrics)
            .values({
                keywordId: id,
                source: 'ads_idea',
                volume: [170, 30, 20][i]!,
                volumeStatus: 'measured',
                fetchedAt: 'x',
            })
            .run();
    for (const id of ids)
        decide(db, {
            subjectType: 'keyword',
            subjectId: String(id),
            decisions: [{ kind: 'shortlist', value: 'true' }],
            reason: 't',
            madeBy: 'human',
        });
    return { db, close, client, sent, ids };
};

describe('cluster phase', () => {
    it('reads one page per shortlisted keyword and merges the ones that share results', async () => {
        const { db, close, client, sent, ids } = setup();
        const plan = planCluster(db, config);
        expect(plan.keywords).toHaveLength(3);
        expect(plan.total).toBeCloseTo(0.012, 4);
        const summary = await runCluster({ db, client, config, reference });
        expect(summary.serpsFetched).toBe(3);
        expect(sent).toHaveLength(3);

        const batch = readClusters(db, config, reference);
        expect(batch.clusters).toHaveLength(2);
        const big = batch.clusters.find((c) => c.members.length === 2)!;
        expect(big.primaryKeyword).toBe('plumber northbridge');
        expect(big.members.map((m) => m.text)).toContain('emergency plumber northbridge');
        expect(big.intentSerp).toBe('commercial');
        expect(big.packPresent).toBe(true);
        expect(big.pageType).toBe('intersection');
        expect(big.questions.length).toBeGreaterThan(0);
        const pair = batch.pairs.find(
            (p) => (p.a === ids[0] && p.b === ids[1]) || (p.a === ids[1] && p.b === ids[0]),
        )!;
        expect(pair.sharedUrls).toBeGreaterThanOrEqual(3);
        expect(pair.samePage).toBe(true);
        const price = batch.clusters.find((c) => c.primaryKeyword === 'plumbing prices')!;
        expect(price.intentSerp).toBe('commercial');
        expect(price.pageType).toBe('guide');

        decide(db, {
            subjectType: 'keyword',
            subjectId: String(ids[1]),
            decisions: [{ kind: 'cluster', value: 'own' }],
            reason: 'a purpose-built emergency page ranks for it',
            madeBy: 'human',
        });
        expect(readClusters(db, config, reference).clusters).toHaveLength(3);
        decide(db, {
            subjectType: 'keyword',
            subjectId: String(ids[2]),
            decisions: [
                { kind: 'cluster', value: String(ids[1]) },
                { kind: 'page_type', value: 'home' },
            ],
            reason: 'moved',
            madeBy: 'human',
        });
        const moved = readClusters(db, config, reference);
        expect(moved.clusters).toHaveLength(2);
        const target = moved.clusters.find((c) => c.members.some((m) => m.keywordId === ids[2]))!;
        expect(target.members.map((m) => m.keywordId)).toEqual(
            expect.arrayContaining([ids[1], ids[2]]),
        );
        expect(target.members).toHaveLength(2);

        const report = renderClustersReport(batch);
        expect(report).toContain(
            '| `plumber northbridge` | `emergency plumber northbridge` | 200 | commercial / -',
        );
        const second = await runCluster({ db, client, config, reference });
        expect(second.serpsFetched).toBe(0);
        expect(second.cost).toBe(0);
        close();
    });

    it('reads an informational keyword that carries a configured modifier as a guide', async () => {
        const informational = (): DfsEnvelope => {
            const base = fixture('serp-organic-en');
            const result = structuredClone(base.tasks[0]!.result![0]) as {
                items: { type: string; url?: string; domain?: string }[];
            };
            result.items = result.items
                .filter((item) => item.type !== 'local_pack')
                .map((item, index) =>
                    item.type === 'organic'
                        ? { ...item, url: `https://guides-${index}.example/blog/${index}` }
                        : item,
                );
            return okEnvelope([result], 0.004);
        };
        const { transport } = fixtureTransport({ [serpOrganicEndpoint.path]: informational() });
        const { db, close } = openDatabase(':memory:');
        const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
        const withMaterial = parseSiteConfig({
            ...config,
            vocabulary: { modifiers: { material: '(copper|plastic)' } },
        });
        for (const text of ['copper plumber', 'plumber']) {
            const id = db
                .insert(keywords)
                .values({ text, language: 'en', locationCode: 1001001, role: 'ads_idea' })
                .returning({ id: keywords.id })
                .get()!.id;
            decide(db, {
                subjectType: 'keyword',
                subjectId: String(id),
                decisions: [
                    { kind: 'shortlist', value: 'true' },
                    { kind: 'cluster', value: 'own' },
                ],
                reason: 't',
                madeBy: 'human',
            });
        }
        await runCluster({ db, client, config: withMaterial, reference });
        const clusters = readClusters(db, withMaterial, reference).clusters;
        const pageType = (text: string) =>
            clusters.find((c) => c.primaryKeyword === text)?.pageType;
        expect(clusters.every((c) => c.intentFinal === 'informational')).toBe(true);
        expect(pageType('copper plumber')).toBe('guide');
        expect(pageType('plumber')).toBe('service');
        close();
    });
});
