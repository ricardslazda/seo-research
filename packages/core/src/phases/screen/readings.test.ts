import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

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
import { decide } from '../../decide.js';
import { findQuery } from '../../queries/index.js';
import type { Reference } from '../../reference/index.js';
import { runScreen } from './gather.js';
import { loadScreen } from './load.js';
import { applyScreenRules } from './rules.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en'],
    places: [
        { slug: 'northbridge', location_code: 1001001, name: { en: { nom: 'Northbridge' } } },
        { slug: 'eastfield', location_code: 1001002, name: { en: { nom: 'Eastfield' } } },
    ],
    services: [{ key: 'plumber', head: { en: { term: 'plumber', plural: 'plumbers' } } }],
    head_forms: {
        en: [
            { term: 'term', place: 'nom' },
            { term: 'plural', place: 'nom' },
        ],
    },
});

const city = (code: number, name: string) => ({
    code,
    name: `${name},Testland`,
    type: 'City',
    parent: null,
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

const setup = async () => {
    const { transport } = fixtureTransport({
        [adsSearchVolumeEndpoint.path]: fixture('ads-search-volume-en'),
        [serpOrganicEndpoint.path]: fixture('serp-organic-en'),
        [bulkReferringDomainsEndpoint.path]: okEnvelope(
            [
                {
                    items: [
                        { target: 'directory-one.example', referring_domains: 410 },
                        { target: 'plumbers-r-us.example', referring_domains: 12 },
                    ],
                },
            ],
            0.02,
        ),
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    const summary = await runScreen({ db, client, config, reference });
    const applied = applyScreenRules(db, loadScreen(db, config, reference), summary.runId);
    return { db, close, applied };
};

describe('screen rules over the fixtures', () => {
    it('writes domain kinds and probes as rule decisions, and never overwrites a human', async () => {
        const { db, close, applied } = await setup();
        expect(applied.domainDecisions).toBeGreaterThan(0);
        expect(applied.probeDecisions).toBe(2);
        decide(db, {
            subjectType: 'domain',
            subjectId: 'plumbers-r-us.example',
            decisions: [{ kind: 'kind', value: 'business' }],
            reason: 'a real plumber',
            madeBy: 'human',
        });
        const again = applyScreenRules(db, loadScreen(db, config, reference), null);
        expect(again.domainDecisions).toBe(0);
        expect(again.probeDecisions).toBe(0);
        close();
    });

    it('answers the screen-batch query with readings and a distribution', async () => {
        const { db, close } = await setup();
        const query = findQuery('screen-batch')!;
        const result = query.run({ db, config, reference, site: 'northbridge-plumbing' }, {});
        expect(result.meta['count']).toBe(2);
        const row = result.rows[0] as {
            place: string;
            languages: Record<string, Record<string, unknown>>;
            flags: string[];
            verdict: string | null;
        };
        expect(row.place).toBe('northbridge');
        const en = row.languages['en']!;
        expect(en['keyword']).toBe('plumber northbridge');
        expect(en['volume']).toBe(210);
        expect(en['probe']).toBe('measured');
        expect(en['controlVolume']).toBe(320);
        expect(en['valueProxy']).toBeCloseTo(210 * 2.34, 1);
        expect(en['firstOrganicRank']).toBe(1);
        expect(en['pack']).toEqual({ rank: 3, size: 2, medianReviews: 34.5 });
        expect(en['directoriesTop10']).toBe(5);
        expect(en['rdMedianBusinesses']).toBe(12);
        expect((en['top10'] as { domain: string; kind: string }[])[0]).toMatchObject({
            domain: 'directory-one.example',
            kind: 'directory',
            referringDomains: 410,
        });
        expect(
            (en['top10'] as { domain: string; kind: string }[]).find(
                (item) => item.domain === 'trade-finder.example',
            )?.kind,
        ).toBe('directory_suspect');
        expect(en['demandEvidence']).toEqual(
            expect.arrayContaining(['volume', 'purpose_built', 'paa', 'related', 'pack']),
        );
        expect(row.verdict).toBeNull();
        const distribution = (
            result.meta['distribution'] as Record<string, Record<string, unknown>>
        )['en']!;
        expect(distribution['measured']).toBe(1);
        expect(distribution['missing']).toBe(1);
        expect(distribution['volume']).toEqual({ p25: 210, p50: 210, p75: 210, max: 210 });
        close();
    });

    it('lists domains with their kinds', async () => {
        const { db, close } = await setup();
        const result = findQuery('screen-domains')!.run(
            { db, config, reference, site: 'northbridge-plumbing' },
            {},
        );
        const rows = result.rows as { domain: string; kind: string; appearances: number }[];
        expect(rows.find((r) => r.domain === 'directory-one.example')).toMatchObject({
            kind: 'directory',
            appearances: 2,
        });
        expect(rows.find((r) => r.domain === 'classifieds-hub.example')?.kind).toBe('classifieds');
        close();
    });
});
