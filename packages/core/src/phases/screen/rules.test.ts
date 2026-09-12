import { describe, expect, it } from 'vitest';

import type { Reference } from '../../reference/index.js';
import { parseSiteConfig } from '../../config/site-config.js';
import type { ScreenData, ScreenItem, ScreenSerp } from './load.js';
import {
    aboveTheFold,
    classifyDomains,
    domainBreadth,
    foldAscii,
    isPurposeBuilt,
    median,
    packReading,
    placeTokens,
    probeFor,
    quantile,
    questionsFrom,
    serviceTokens,
    stem,
    transliterate,
} from './rules.js';

const config = parseSiteConfig({
    slug: 's',
    languages: ['en'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            name: { en: { nom: 'Northbridge', loc: 'in Northbridge' } },
        },
    ],
    services: [
        { key: 'plumber', head: { en: { term: 'plumber' } } },
        { key: 'electrician', head: { en: { term: 'electrician' } } },
        { key: 'facade-cleaning', head: { en: { term: 'façade cleaning' } } },
    ],
    head_forms: { en: [{ term: 'term', place: 'nom' }] },
    market: { country: 'ZZ' },
    vocabulary: { directory_paths: '/find-a-trade/' },
});

const reference: Reference = {
    locations: {},
    support: { global: {}, countries: {}, intentLanguages: [] },
    prices: null,
    domains: {
        ZZ: {
            directory: ['directory-one.example', 'town-guide.example'],
            classifieds: ['classifieds-hub.example'],
            jobs: ['jobs-board.example'],
        },
        XX: { directory: ['everywhere.example'] },
    },
};

const organic = (rank: number, domain: string, url: string): ScreenItem => ({
    rankAbsolute: rank,
    rankGroup: rank,
    type: 'organic',
    domain,
    url,
    title: null,
    payload: null,
});

const serpFor = (id: number, keywordId: number, items: ScreenItem[]): ScreenSerp => ({
    id,
    keywordId,
    language: 'en',
    firstOrganicRank: Math.min(
        ...items.filter((i) => i.type === 'organic').map((i) => i.rankAbsolute),
    ),
    itemTypes: [...new Set(items.map((i) => i.type))],
    rawId: null,
    items,
});

const keyword = (
    id: number,
    candidateId: number,
    role: string,
    status: string | null,
    text = 'x',
) => ({
    id,
    text,
    language: 'en',
    locationCode: 1001001,
    candidateId,
    role,
    variantOf: null,
    variantKind: null,
    metric: status
        ? {
              volume: status === 'measured' ? 100 : null,
              volumeStatus: status,
              cpc: null,
              bidLow: null,
              bidHigh: null,
              seriesHash: null,
              rawId: null,
          }
        : null,
});

const data: ScreenData = {
    config,
    reference,
    candidates: [
        { id: 1, serviceKey: 'plumber', placeSlug: 'northbridge' },
        { id: 2, serviceKey: 'electrician', placeSlug: 'northbridge' },
        { id: 3, serviceKey: 'facade-cleaning', placeSlug: 'northbridge' },
    ],
    keywords: new Map([
        [10, keyword(10, 1, 'head', 'measured')],
        [20, keyword(20, 2, 'head', 'measured')],
        [30, keyword(30, 3, 'head', 'measured')],
    ]),
    serps: [
        serpFor(1, 10, [
            organic(1, 'directory-one.example', 'https://directory-one.example/category/plumbers'),
            organic(2, 'everywhere.example', 'https://everywhere.example/a'),
            organic(
                3,
                'plumbers-r-us.example',
                'https://www.plumbers-r-us.example/plumber-northbridge',
            ),
            organic(
                4,
                'trade-finder.example',
                'https://trade-finder.example/companies/northbridge',
            ),
            organic(5, 'north.town-guide.example', 'https://north.town-guide.example/x'),
            organic(6, 'jobs-board.example', 'https://jobs-board.example/vacancy/1'),
            organic(
                7,
                'local-trades.example',
                'https://local-trades.example/find-a-trade/plumbing',
            ),
        ]),
        serpFor(2, 20, [
            organic(1, 'everywhere.example', 'https://everywhere.example/b'),
            organic(2, 'sparks.example', 'https://sparks.example/'),
        ]),
        serpFor(3, 30, [organic(1, 'everywhere.example', 'https://everywhere.example/c')]),
    ],
    domains: new Map(),
    decisions: {
        candidate: new Map(),
        domain: new Map(),
        keyword: new Map(),
        threshold: new Map(),
    },
};

describe('classifyDomains', () => {
    it("uses the country's reference list, then the path, and leaves breadth as a number", () => {
        const kinds = classifyDomains(data);
        expect(kinds.get('directory-one.example')?.kind).toBe('directory');
        expect(kinds.get('everywhere.example')?.kind).toBe('unknown');
        expect(domainBreadth(data).get('everywhere.example')).toEqual({
            services: 3,
            places: 1,
            pages: 3,
        });
        expect(domainBreadth(data).get('directory-one.example')).toEqual({
            services: 1,
            places: 1,
            pages: 1,
        });
        expect(kinds.get('trade-finder.example')?.kind).toBe('directory_suspect');
        expect(kinds.get('local-trades.example')?.kind).toBe('directory_suspect');
        expect(kinds.get('plumbers-r-us.example')?.kind).toBe('unknown');
        expect(kinds.get('sparks.example')?.kind).toBe('unknown');
        expect(kinds.get('north.town-guide.example')?.kind).toBe('directory');
        expect(kinds.get('jobs-board.example')?.kind).toBe('jobs');
    });

    it('refuses to classify when the country is unknown', () => {
        const market = { currency_marks: [], ignore_countries: [] };
        expect(() => classifyDomains({ ...data, config: { ...config, market } })).toThrow(
            /market\.country/,
        );
    });
});

describe('probeFor', () => {
    it('blames the form only when the control is blank too', () => {
        expect(
            probeFor(keyword(1, 1, 'head', 'measured'), keyword(2, 1, 'control', 'measured')),
        ).toBe('measured');
        expect(
            probeFor(keyword(1, 1, 'head', 'below_floor'), keyword(2, 1, 'control', 'measured')),
        ).toBe('below_floor');
        expect(
            probeFor(keyword(1, 1, 'head', 'below_floor'), keyword(2, 1, 'control', 'below_floor')),
        ).toBe('form_suspect');
        expect(probeFor(keyword(1, 1, 'head', 'below_floor'), undefined)).toBe('form_suspect');
        expect(
            probeFor(keyword(1, 1, 'head', 'missing'), keyword(2, 1, 'control', 'measured')),
        ).toBe('missing');
    });
});

describe('result page readings', () => {
    const items: ScreenItem[] = [
        {
            rankAbsolute: 1,
            rankGroup: 1,
            type: 'paid',
            domain: 'ad.example',
            url: null,
            title: null,
            payload: null,
        },
        {
            rankAbsolute: 2,
            rankGroup: 1,
            type: 'local_pack',
            domain: null,
            url: null,
            title: 'A',
            payload: { rating: { value: 4.1, votes_count: 49 } },
        },
        {
            rankAbsolute: 3,
            rankGroup: 2,
            type: 'local_pack',
            domain: null,
            url: null,
            title: 'B',
            payload: { rating: { value: 5, votes_count: 20 } },
        },
        {
            rankAbsolute: 4,
            rankGroup: 3,
            type: 'local_pack',
            domain: null,
            url: null,
            title: 'C',
            payload: { rating: { value: null, votes_count: null } },
        },
        organic(5, 'plumbers-r-us.example', 'https://plumbers-r-us.example/emergency-plumbers/'),
        {
            rankAbsolute: 6,
            rankGroup: 1,
            type: 'people_also_ask',
            domain: null,
            url: null,
            title: null,
            payload: { items: [{ title: 'How much does a plumber cost?' }] },
        },
        {
            rankAbsolute: 7,
            rankGroup: 1,
            type: 'people_also_search',
            domain: null,
            url: null,
            title: null,
            payload: { items: ['Plumber Eastfield'] },
        },
    ];
    const serp = serpFor(9, 10, items);

    it('reads the pack, what sits above the fold and the questions', () => {
        expect(packReading(items)).toEqual({ rank: 2, size: 3, medianReviews: 34.5 });
        expect(aboveTheFold(serp)).toEqual({ paid: 1, local_pack: 3 });
        expect(questionsFrom(serp, 'people_also_ask')).toEqual(['How much does a plumber cost?']);
        expect(questionsFrom(serp, 'people_also_search')).toEqual(['Plumber Eastfield']);
        expect(packReading([organic(1, 'a.example', 'https://a.example/')])).toBeNull();
    });

    it('recognizes a purpose-built page by a service or place stem in its path', () => {
        const tokens = { service: ['plumb'], place: ['northbrid'] };
        expect(isPurposeBuilt('https://plumbers-r-us.example/emergency-plumbers/', tokens)).toBe(
            true,
        );
        expect(isPurposeBuilt('https://x.example/services/northbridge', tokens)).toBe(true);
        expect(isPurposeBuilt('https://x.example/', tokens)).toBe(false);
        expect(isPurposeBuilt('https://x.example/about', tokens)).toBe(false);
        expect(isPurposeBuilt(null, tokens)).toBe(false);
    });

    it('stems and transliterates the config forms into tokens', () => {
        expect(serviceTokens(data)).toEqual(
            expect.arrayContaining(['plumb', 'electrici', 'faca', 'cleani']),
        );
        expect(placeTokens(data)).toEqual(expect.arrayContaining(['northbrid']));
        expect(transliterate('кафе у моря')).toBe('kafe u morja');
        expect(stem('plumber')).toBe('plumb');
        expect(stem('pipe')).toBe('pipe');
    });
});

describe('numbers', () => {
    it('folds diacritics and takes medians and quantiles with gaps', () => {
        expect(foldAscii('Crème Brûlée Café')).toBe('creme brulee cafe');
        expect(median([3, null, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([null])).toBeNull();
        expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
        expect(quantile([10], 0.25)).toBe(10);
        expect(quantile([], 0.5)).toBeNull();
    });
});
