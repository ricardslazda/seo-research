import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    adsKeywordsForKeywordsEndpoint,
    adsSearchVolumeEndpoint,
    fixtureTransport,
    labsBulkKeywordDifficultyEndpoint,
    labsKeywordIdeasEndpoint,
    labsKeywordSuggestionsEndpoint,
    labsSearchIntentEndpoint,
    okEnvelope,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { parseSiteConfig } from '../../config/site-config.js';
import { SqliteCacheStore } from '../../db/cache-store.js';
import { openDatabase } from '../../db/open.js';
import { keywordMetrics, keywordOrigins, keywords, serpItems, serps } from '../../db/schema.js';
import type { Reference } from '../../reference/index.js';
import { runKeywords, topicality } from './gather.js';
import { collectSeeds, mentionsService } from './seeds.js';

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
        { key: 'plumber', head: { en: { term: 'plumber' } } },
    ],
    head_forms: { en: [{ term: 'term', place: 'nom' }] },
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

const seedQuestion = (db: ReturnType<typeof openDatabase>['db']) => {
    const kw = db
        .insert(keywords)
        .values({
            text: 'plumber northbridge',
            language: 'en',
            locationCode: 1001001,
            role: 'head',
        })
        .returning({ id: keywords.id })
        .get()!;
    const serp = db
        .insert(serps)
        .values({
            keywordId: kw.id,
            locationCode: 1001001,
            language: 'en',
            device: 'mobile',
            depth: 20,
            itemTypesJson: '[]',
            fetchedAt: 'x',
        })
        .returning({ id: serps.id })
        .get()!;
    db.insert(serpItems)
        .values({
            serpId: serp.id,
            rankAbsolute: 6,
            rankGroup: 1,
            type: 'people_also_ask',
            payloadJson: JSON.stringify({
                items: [
                    { title: 'How much does boiler repair cost in Northbridge?' },
                    { title: 'What time is sunset today?' },
                ],
            }),
        })
        .run();
};

const setup = () => {
    const { transport, sent } = fixtureTransport({
        [labsKeywordSuggestionsEndpoint.path]: fixture('labs-keyword-suggestions-en'),
        [labsKeywordIdeasEndpoint.path]: fixture('labs-keyword-ideas-offtopic'),
        [labsBulkKeywordDifficultyEndpoint.path]: fixture('labs-bulk-keyword-difficulty-en'),
        [labsSearchIntentEndpoint.path]: fixture('labs-search-intent-en'),
        [adsKeywordsForKeywordsEndpoint.path]: fixture('ads-keywords-for-keywords-en'),
        [adsSearchVolumeEndpoint.path]: okEnvelope(
            [
                {
                    keyword: 'boiler repair',
                    search_volume: 170,
                    competition: 'MEDIUM',
                    competition_index: 50,
                    cpc: 2.4,
                    low_top_of_page_bid: 1,
                    high_top_of_page_bid: 2.5,
                    monthly_searches: null,
                },
            ],
            0.09,
        ),
    });
    const { db, close } = openDatabase(':memory:');
    seedQuestion(db);
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    return { db, close, client, sent };
};

describe('collectSeeds', () => {
    it('takes service terms and on-topic questions from the result pages', () => {
        const { db, close } = setup();
        const seeds = collectSeeds(db, config);
        expect(seeds.map((s) => [s.language, s.origin, s.text])).toEqual([
            ['en', 'service', 'boiler repair'],
            ['en', 'service', 'plumber'],
            ['en', 'question', 'how much does boiler repair cost in northbridge'],
        ]);
        expect(mentionsService('What time is sunset today?', ['boil', 'repa', 'plumb'])).toBe(
            false,
        );
        close();
    });
});

describe('runKeywords', () => {
    it('expands, prices at the city, abandons off-topic ideas, and classifies intent', async () => {
        const { db, close, client, sent } = setup();
        const summary = await runKeywords({ db, client, config, reference });
        expect(summary.seeds).toEqual({ en: 3 });
        expect(summary.suggestions).toBe(16);
        expect(summary.ideasAbandoned).toBe(true);
        expect(summary.ideasTopicality).not.toBeNull();
        expect(summary.ideasTopicality!).toBeLessThan(0.5);
        expect(summary.ideas).toBe(0);
        expect(summary.adsIdeas).toBe(8);
        expect(summary.failures).toEqual([]);

        const rows = db.select().from(keywords).all();
        expect(
            rows.some(
                (row) =>
                    row.role === 'suggestion' &&
                    row.text === 'combi boiler repair' &&
                    row.locationCode === 2999,
            ),
        ).toBe(true);
        expect(
            rows.some(
                (row) =>
                    row.role === 'ads_idea' &&
                    row.text === 'emergency plumber' &&
                    row.locationCode === 1001001,
            ),
        ).toBe(true);
        expect(
            rows.some(
                (row) =>
                    row.role === 'question' &&
                    row.text === 'how much does boiler repair cost in northbridge',
            ),
        ).toBe(true);
        const origins = db.select().from(keywordOrigins).all();
        expect(origins.some((o) => o.source === 'labs_suggest' && o.seed === 'boiler repair')).toBe(
            true,
        );
        const metrics = db.select().from(keywordMetrics).all();
        expect(metrics.some((m) => m.source === 'labs_kd' && m.difficulty === 4)).toBe(true);
        expect(sent.some((call) => call.path === labsBulkKeywordDifficultyEndpoint.path)).toBe(
            true,
        );
        expect(
            metrics.some((m) => m.source === 'labs_intent' && m.intentEndpoint === 'navigational'),
        ).toBe(true);
        expect(metrics.some((m) => m.source === 'ads' && m.volume === 170)).toBe(true);
        close();
    });

    it('measures topicality on the top rows', () => {
        expect(
            topicality([{ keyword: 'boiler repair' }, { keyword: 'weather tomorrow' }], ['boil']),
        ).toBe(0.5);
        expect(topicality([], ['boil'])).toBeNull();
    });
});
