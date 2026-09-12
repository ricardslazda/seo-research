import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    adsSearchVolumeEndpoint,
    bulkReferringDomainsEndpoint,
    fixtureTransport,
    okEnvelope,
    serpOrganicEndpoint,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { parseSiteConfig } from '../../config/site-config.js';
import { SqliteCacheStore } from '../../db/cache-store.js';
import { openDatabase } from '../../db/open.js';
import { keywordMetrics, keywords, rawResponses, serpItems, serps } from '../../db/schema.js';
import { writeDecision } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { planScreen, runScreen, seriesHash, validatePlaces } from './gather.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            name: { en: { nom: 'Northbridge', loc: 'in Northbridge' } },
        },
        {
            slug: 'eastfield',
            location_code: 1001002,
            name: { en: { nom: 'Eastfield', loc: 'in Eastfield' } },
        },
    ],
    services: [{ key: 'plumber', head: { en: { term: 'plumber', plural: 'plumbers' } } }],
    head_forms: {
        en: [
            { term: 'term', place: 'nom' },
            { term: 'plural', place: 'nom' },
            { term: 'term', place: 'loc' },
        ],
    },
});

const city = (code: number, name: string) => ({
    code,
    name: `${name},Testland`,
    type: 'City',
    parent: 2999,
    countryIso: 'ZZ',
    sources: ['serp', 'ads'],
});

const reference: Reference = {
    locations: { '1001001': city(1001001, 'Northbridge'), '1001002': city(1001002, 'Eastfield') },
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

const backlinks = okEnvelope(
    [
        {
            items: [
                {
                    target: 'directory-one.example',
                    referring_domains: 410,
                    backlinks: 900,
                    referring_main_domains: 300,
                },
            ],
        },
    ],
    0.02,
);

const setup = () => {
    const { transport, sent } = fixtureTransport({
        [adsSearchVolumeEndpoint.path]: fixture('ads-search-volume-en'),
        [serpOrganicEndpoint.path]: fixture('serp-organic-en'),
        [bulkReferringDomainsEndpoint.path]: backlinks,
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    return { db, close, client, sent };
};

describe('runScreen', () => {
    it('gathers volume, result pages and referring domains for every candidate and place', async () => {
        const { db, close, client, sent } = setup();
        const summary = await runScreen({
            db,
            client,
            config,
            reference,
            now: () => new Date('2026-09-02T12:00:00Z'),
        });
        expect(summary.candidates).toBe(2);
        expect(summary.keywords).toBe(8);
        expect(summary.volumeCalls).toBe(2);
        expect(summary.serps).toBe(2);
        expect(summary.domains).toBe(1);
        expect(summary.cost).toBeCloseTo(0.09 + 0.09 + 0.004 + 0.004 + 0.02, 5);

        const metrics = db
            .select({
                text: keywords.text,
                status: keywordMetrics.volumeStatus,
                volume: keywordMetrics.volume,
                role: keywords.role,
            })
            .from(keywordMetrics)
            .innerJoin(
                keywords,
                and(eq(keywordMetrics.keywordId, keywords.id), eq(keywords.locationCode, 1001001)),
            )
            .all();
        const byText = new Map(metrics.map((row) => [row.text, row]));
        expect(byText.get('plumber northbridge')).toMatchObject({
            status: 'measured',
            volume: 210,
            role: 'head',
        });
        expect(byText.get('plumbers northbridge')).toMatchObject({
            status: 'below_floor',
            volume: null,
            role: 'variant',
        });
        expect(byText.get('plumber in northbridge')).toMatchObject({
            status: 'missing',
            volume: null,
            role: 'variant',
        });
        expect(byText.get('plumber')).toMatchObject({
            status: 'measured',
            volume: 320,
            role: 'control',
        });

        const serpRows = db.select().from(serps).all();
        expect(serpRows.map((row) => [row.locationCode, row.firstOrganicRank])).toEqual([
            [1001001, 1],
            [1001002, 1],
        ]);
        const items = db.select().from(serpItems).all();
        expect(items.filter((item) => item.type === 'local_pack')).toHaveLength(4);
        expect(items.find((item) => item.rankAbsolute === 1)?.domain).toBe('directory-one.example');
        expect(items.find((item) => item.rankAbsolute === 3)?.domain).toBe('plumbers-r-us.example');
        expect(sent.filter((call) => call.path === bulkReferringDomainsEndpoint.path)).toHaveLength(
            1,
        );
        close();
    });

    it('costs nothing and adds no rows the second time', async () => {
        const { db, close, client, sent } = setup();
        await runScreen({ db, client, config, reference });
        const rawBefore = db.select().from(rawResponses).all().length;
        const second = await runScreen({ db, client, config, reference });
        expect(second.cost).toBe(0);
        expect(second.cachedCalls).toBeGreaterThan(0);
        expect(db.select().from(rawResponses).all()).toHaveLength(rawBefore);
        expect(db.select().from(serps).all()).toHaveLength(2);
        expect(db.select().from(keywordMetrics).all()).toHaveLength(8);
        expect(sent).toHaveLength(5);
        close();
    });

    it('skips the result pages of a candidate whose local facts were answered no', async () => {
        const { db, close, client } = setup();
        writeDecision(db, {
            subjectType: 'candidate',
            subjectId: '1',
            kind: 'local_facts',
            value: 'no',
            reason: 'nothing local to say about it',
            madeBy: 'human',
        });
        const summary = await runScreen({ db, client, config, reference });
        expect(summary.serps).toBe(1);
        expect(summary.serpsSkipped).toBe(1);
        expect(summary.volumeCalls).toBe(2);
        close();
    });
});

describe('runScreen with a failing result page', () => {
    it('records the failure and keeps the pages that came back', async () => {
        const failed: DfsEnvelope = {
            ...okEnvelope(null, 0),
            tasks: [
                {
                    ...okEnvelope(null, 0).tasks[0]!,
                    status_code: 40400,
                    status_message: 'Not Found.',
                },
            ],
        };
        const { transport } = fixtureTransport({
            [adsSearchVolumeEndpoint.path]: fixture('ads-search-volume-en'),
            [serpOrganicEndpoint.path]: [failed, fixture('serp-organic-en')],
            [bulkReferringDomainsEndpoint.path]: backlinks,
        });
        const { db, close } = openDatabase(':memory:');
        const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
        const summary = await runScreen({ db, client, config, reference });
        expect(summary.serps).toBe(1);
        expect(summary.serpsFailed).toBe(1);
        expect(summary.failures[0]).toMatch(/^en "plumber northbridge": .*40400/);
        expect(
            db
                .select()
                .from(rawResponses)
                .all()
                .filter((row) => row.taskStatusCode === 40400),
        ).toHaveLength(1);
        close();
    });
});

describe('planScreen', () => {
    it('estimates one volume call per language and place and one result page per candidate and language', () => {
        const plan = planScreen(config);
        expect(plan.calls.map((call) => [call.endpoint, call.count])).toEqual([
            ['ads.search_volume', 2],
            ['serp.google.organic', 2],
            ['backlinks.bulk_referring_domains', 1],
        ]);
        expect(plan.total).toBeCloseTo(0.18 + 0.008 + 0.0208, 4);
    });
});

describe('helpers', () => {
    it('hashes a monthly series and ignores an all-zero one', () => {
        const series = [
            { year: 2026, month: 1, search_volume: 10 },
            { year: 2025, month: 12, search_volume: 20 },
        ];
        expect(seriesHash(series)).toBe(seriesHash([...series].reverse()));
        expect(seriesHash([{ year: 2026, month: 1, search_volume: 0 }])).toBeNull();
        expect(seriesHash(null)).toBeNull();
    });

    it('names a place missing from either location list', () => {
        const broken: Reference = {
            ...reference,
            locations: {
                ...reference.locations,
                '1001001': { ...city(1001001, 'Northbridge'), sources: ['serp'] },
            },
        };
        expect(() => validatePlaces(config, broken)).toThrow(/missing from the ads location list/);
    });
});
