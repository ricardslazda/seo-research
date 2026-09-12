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
import {
    domainKeywords,
    domainPages,
    domains,
    keywordMetrics,
    keywords,
    pageAnatomy,
} from '../../db/schema.js';
import { currentDecision } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { labsLanguageFor, planCompetitors, runCompetitors } from './gather.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en'],
    places: [{ slug: 'northbridge', location_code: 1001001, name: { en: { nom: 'Northbridge' } } }],
    services: [
        { key: 'boiler-repair', head: { en: { term: 'boiler repair' } } },
        { key: 'drain-unblocking', head: { en: { term: 'drain unblocking' } } },
    ],
    head_forms: { en: [{ term: 'term', place: 'nom' }] },
    market: { currency: 'USD', currency_marks: ['$'] },
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
        global: { ads: ['en'], serp: ['en'] },
        countries: { ZZ: { labs: ['en'] } },
        intentLanguages: ['en'],
    },
    prices: null,
    domains: {},
};

const setup = () => {
    const { transport, sent } = fixtureTransport({
        [labsRankedKeywordsEndpoint.path]: fixture('labs-ranked-keywords-example'),
        [labsRelevantPagesEndpoint.path]: fixture('labs-relevant-pages-example'),
        [adsKeywordsForSiteEndpoint.path]: fixture('ads-keywords-for-site-example'),
        [onPageContentParsingEndpoint.path]: fixture('onpage-content-parsing-example-home'),
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    return { db, close, client, sent };
};

describe('runCompetitors', () => {
    it('reads one named competitor: ranked keywords, earning pages, site keywords and page anatomy', async () => {
        const { db, close, client, sent } = setup();
        const summary = await runCompetitors({
            db,
            client,
            config,
            reference,
            domains: ['www.plumbers-r-us.example'],
            pagesPerDomain: 2,
        });
        expect(summary.labsLanguage).toBe('en');
        expect(summary.rankedKeywords).toBe(5);
        expect(summary.relevantPages).toBe(4);
        expect(summary.siteIdeas).toBe(8);
        expect(summary.pagesParsed).toBe(3);
        expect(summary.failures).toEqual([]);
        expect(sent.filter((call) => call.path === adsKeywordsForSiteEndpoint.path)).toHaveLength(
            1,
        );

        const domainRow = db.select().from(domains).get();
        expect(domainRow?.labsKeywords).toBe(5);
        expect(db.select().from(domainKeywords).all()).toHaveLength(5 + 8);
        const pages = db.select().from(domainPages).all();
        expect(pages.map((page) => page.url)).toContain(
            'https://plumbers-r-us.example/services/drain-unblocking/',
        );

        const ranked = db
            .select()
            .from(keywords)
            .all()
            .filter((row) => row.role === 'ranked');
        expect(ranked.map((row) => row.text)).toContain('boiler repair');
        expect(ranked.every((row) => row.locationCode === 2999 && row.language === 'en')).toBe(
            true,
        );
        const labsMetric = db
            .select()
            .from(keywordMetrics)
            .all()
            .find((row) => row.source === 'labs' && row.intentEndpoint !== null);
        expect(labsMetric?.intentEndpoint).toBe('commercial');
        const ideas = db
            .select()
            .from(keywords)
            .all()
            .filter((row) => row.role === 'site_idea');
        expect(ideas.map((row) => row.text)).toContain('emergency plumber');

        const anatomy = db.select().from(pageAnatomy).all();
        expect(anatomy).toHaveLength(3);
        const home = anatomy.find((row) => row.url === 'https://plumbers-r-us.example/')!;
        expect(home.title).toMatch(/^Plumbers R Us/);
        expect(home.wordCount).toBeGreaterThan(50);
        expect(home.ratingValue).toBe(4.8);
        expect(home.hasPrices).toBe(true);
        expect(home.phoneCount).toBe(0);
        expect(JSON.parse(home.navLinksJson!)).toHaveLength(5);
        expect(currentDecision(db, 'domain', 'plumbers-r-us.example', 'competitor')?.madeBy).toBe(
            'human',
        );
        close();
    });

    it('is free and idempotent the second time', async () => {
        const { db, close, client } = setup();
        await runCompetitors({ db, client, config, reference, domains: ['plumbers-r-us.example'] });
        const second = await runCompetitors({
            db,
            client,
            config,
            reference,
            domains: ['plumbers-r-us.example'],
        });
        expect(second.cost).toBe(0);
        expect(db.select().from(pageAnatomy).all()).toHaveLength(3);
        expect(
            db
                .select()
                .from(keywordMetrics)
                .all()
                .filter((row) => row.source === 'labs'),
        ).toHaveLength(5);
        close();
    });
});

describe('planCompetitors', () => {
    it('prices the calls per domain', () => {
        expect(labsLanguageFor(config, reference)).toEqual({ language: 'en', countryCode: 2999 });
        const plan = planCompetitors(
            [
                {
                    domain: 'a',
                    kind: 'unknown',
                    pages: 9,
                    services: 1,
                    places: 1,
                    referringDomains: null,
                    explicit: false,
                },
            ],
            config,
            reference,
            3,
        );
        expect(plan.calls.map((c) => [c.endpoint, c.count])).toEqual([
            ['labs.ranked_keywords', 1],
            ['labs.relevant_pages', 1],
            ['ads.keywords_for_site', 1],
            ['onpage.content_parsing', 4],
        ]);
        expect(plan.total).toBeCloseTo(0.132 + 0.0223 + 0.09 + 0.0006, 4);
    });
});
