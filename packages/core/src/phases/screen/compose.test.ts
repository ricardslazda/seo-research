import { describe, expect, it } from 'vitest';

import { parseSiteConfig } from '../../config/site-config.js';
import { composeKeywords } from './compose.js';

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en', 'es'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            name: {
                en: { nom: 'Northbridge', loc: 'in Northbridge' },
                es: { nom: 'Northbridge', loc: 'en Northbridge' },
            },
        },
    ],
    services: [
        {
            key: 'plumber',
            head: { en: { term: 'Plumber', plural: 'plumbers' }, es: { term: 'fontanero' } },
        },
    ],
    head_forms: {
        en: [
            { term: 'term', place: 'nom' },
            { term: 'plural', place: 'nom' },
            { term: 'term', place: 'loc' },
        ],
        es: [{ term: 'term', place: 'loc' }],
    },
});

describe('composeKeywords', () => {
    it('composes the head, its variants and a control per service, place and language', () => {
        const keywords = composeKeywords(config);
        expect(keywords.map((k) => [k.language, k.role, k.text, k.variantKind])).toEqual([
            ['en', 'head', 'plumber northbridge', null],
            ['en', 'variant', 'plumbers northbridge', 'plural+nom'],
            ['en', 'variant', 'plumber in northbridge', 'term+loc'],
            ['en', 'control', 'plumber', null],
            ['es', 'head', 'fontanero en northbridge', null],
            ['es', 'control', 'fontanero', null],
        ]);
        expect(keywords[1]?.headText).toBe('plumber northbridge');
        expect(keywords[3]?.placeSlug).toBeNull();
        expect(keywords.every((k) => k.locationCode === 1001001)).toBe(true);
    });
});

describe('composeKeywords with a country volume scope', () => {
    it('prices country-scope towns at the country while the head keyword keeps the town', () => {
        const scoped = parseSiteConfig({
            slug: 's',
            languages: ['en'],
            places: [
                {
                    slug: 'northbridge',
                    location_code: 1001001,
                    name: { en: { nom: 'Northbridge' } },
                },
                {
                    slug: 'eastfield',
                    location_code: 1001002,
                    volume_scope: 'country',
                    name: { en: { nom: 'Eastfield' } },
                },
                {
                    slug: 'old-town',
                    location_code: 1001003,
                    volume_scope: 'country',
                    name: { en: { nom: 'Old Town' } },
                },
            ],
            services: [{ key: 'plumber', head: { en: { term: 'plumber' } } }],
            head_forms: { en: [{ term: 'term', place: 'nom' }] },
        });
        const keywords = composeKeywords(scoped, 2999);
        expect(keywords.find((k) => k.text === 'plumber eastfield')?.locationCode).toBe(2999);
        expect(keywords.find((k) => k.text === 'plumber old town')?.locationCode).toBe(2999);
        expect(keywords.find((k) => k.text === 'plumber northbridge')?.locationCode).toBe(1001001);
        expect(new Set(keywords.map((k) => k.locationCode)).size).toBe(2);
    });
});
