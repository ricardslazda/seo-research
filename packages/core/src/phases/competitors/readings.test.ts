import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    adsKeywordsForSiteEndpoint,
    fixtureTransport,
    labsRankedKeywordsEndpoint,
    labsRelevantPagesEndpoint,
    onPageContentParsingEndpoint,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { parseSiteConfig } from '../../config/site-config.js';
import { SqliteCacheStore } from '../../db/cache-store.js';
import { openDatabase } from '../../db/open.js';
import { findQuery } from '../../queries/index.js';
import type { Reference } from '../../reference/index.js';
import { renderCompetitorsReport } from '../../report/competitors-report.js';
import { runCompetitors } from './gather.js';
import { guessPageType, readCompetitors, tokensFor } from './readings.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en', 'es'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            name: { en: { nom: 'Northbridge' }, es: { nom: 'Northbridge' } },
        },
    ],
    services: [
        {
            key: 'boiler-repair',
            head: { en: { term: 'boiler repair' }, es: { term: 'reparación de calderas' } },
        },
        {
            key: 'drain-unblocking',
            head: { en: { term: 'drain unblocking' }, es: { term: 'desatascos' } },
        },
    ],
    head_forms: { en: [{ term: 'term', place: 'nom' }], es: [{ term: 'term', place: 'nom' }] },
    market: { currency: 'USD', currency_marks: ['$'] },
    vocabulary: { guide_paths: '(consejos|precios)' },
});

const reference: Reference = {
    locations: {
        '2999': {
            code: 2999,
            name: 'Testland',
            type: 'Country',
            parent: null,
            countryIso: 'ZZ',
            sources: ['serp', 'ads', 'labs'],
        },
        '1001001': {
            code: 1001001,
            name: 'Northbridge,Testland',
            type: 'City',
            parent: 2999,
            countryIso: 'ZZ',
            sources: ['serp', 'ads'],
        },
    },
    support: {
        global: { ads: ['en', 'es'], serp: ['en', 'es'] },
        countries: { ZZ: { labs: ['en'] } },
        intentLanguages: ['en'],
    },
    prices: null,
    domains: {},
};

const setup = async () => {
    const { transport } = fixtureTransport({
        [labsRankedKeywordsEndpoint.path]: fixture('labs-ranked-keywords-example'),
        [labsRelevantPagesEndpoint.path]: fixture('labs-relevant-pages-example'),
        [adsKeywordsForSiteEndpoint.path]: fixture('ads-keywords-for-site-example'),
        [onPageContentParsingEndpoint.path]: fixture('onpage-content-parsing-example-home'),
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    await runCompetitors({ db, client, config, reference, domains: ['plumbers-r-us.example'] });
    return { db, close };
};

describe('guessPageType', () => {
    const tokens = tokensFor(config);
    it('reads home, service, place, intersection and guide from the path', () => {
        expect(guessPageType('https://x.example/', tokens)).toBe('home');
        expect(guessPageType('https://x.example/es/', tokens)).toBe('home');
        expect(guessPageType('https://x.example/fr/', tokens)).toBe('other');
        expect(guessPageType('https://x.example/services/drain-unblocking/', tokens)).toBe(
            'service',
        );
        expect(guessPageType('https://x.example/es/reparacion-de-calderas/', tokens)).toBe(
            'service',
        );
        expect(guessPageType('https://x.example/areas/northbridge/', tokens)).toBe('place');
        expect(guessPageType('https://x.example/boiler-repair-northbridge/', tokens)).toBe(
            'intersection',
        );
        expect(guessPageType('https://x.example/services/boiler-repair-prices/', tokens)).toBe(
            'guide',
        );
        expect(guessPageType('https://x.example/es/precios-desatascos/', tokens)).toBe('guide');
        expect(guessPageType('https://x.example/about-us', tokens)).toBe('other');
    });
});

describe('readCompetitors', () => {
    it('lists the competitor with its earning pages, menu, seed keywords and a report', async () => {
        const { db, close } = await setup();
        const data = readCompetitors(db, config, reference);
        expect(data.rows).toHaveLength(1);
        const row = data.rows[0]!;
        expect(row.domain).toBe('plumbers-r-us.example');
        expect(row.labsKeywords).toBe(5);
        expect(row.earningPages).toBe(4);
        expect(row.siteIdeas).toBe(8);
        expect(row.homeRating).toBe(4.8);
        expect(row.homePrices).toBe(true);
        expect(row.menuItems).toBe(5);
        expect(data.pages[0]?.pageType).toBe('home');
        expect(data.pages.some((page) => page.pageType === 'service')).toBe(true);
        expect(data.pages.some((page) => page.pageType === 'guide')).toBe(true);
        expect(data.menus.some((m) => m.text === 'Boiler Repair' && m.pageType === 'service')).toBe(
            true,
        );
        const top = data.seeds[0]!;
        expect(top.volume).toBe(880);
        const emergency = data.seeds.find((s) => s.text === 'emergency plumber');
        expect(emergency?.volume).toBe(480);
        expect(emergency?.source).toBe('site_idea');
        expect(
            data.seeds.find((s) => s.text === 'boiler repair' && s.source === 'ranked')?.intent,
        ).toBe('commercial');

        const report = renderCompetitorsReport(data, ['en']);
        expect(report).toContain('| plumbers-r-us.example | unknown |');
        expect(report).toContain('`emergency plumber`');
        expect(report).toContain('Boiler Repair (service)');

        const query = findQuery('competitor-keywords')!;
        const result = query.run(
            { db, config, reference, site: 'northbridge-plumbing' },
            { min_volume: 400 },
        );
        expect(result.rows).toHaveLength(4);
        close();
    });
});
