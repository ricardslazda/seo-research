import { describe, expect, it } from 'vitest';

import { SiteConfigError, parseSiteConfig } from './site-config.js';

const valid = {
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
            head: { en: { term: 'plumber', plural: 'plumbers' }, es: { term: 'fontanero' } },
        },
    ],
    head_forms: {
        en: [
            { term: 'term', place: 'nom' },
            { term: 'plural', place: 'loc' },
        ],
        es: [{ term: 'term', place: 'loc' }],
    },
};

describe('parseSiteConfig', () => {
    it('accepts a complete config and defaults the place kind, the market and the paths', () => {
        const config = parseSiteConfig(valid);
        expect(config.places[0]?.kind).toBe('city');
        expect(config.head_forms['en']).toHaveLength(2);
        expect(config.market).toEqual({ currency_marks: [], ignore_countries: [] });
        expect(config.paths).toEqual({});
    });

    it('names the missing place form a head form needs', () => {
        const broken = structuredClone(valid);
        delete (broken.places[0]!.name['en'] as Record<string, string>)['loc'];
        expect(() => parseSiteConfig(broken)).toThrow(SiteConfigError);
        expect(() => parseSiteConfig(broken)).toThrow(
            /place "northbridge" has no "loc" form in "en"/,
        );
    });

    it('names the missing service form a head form needs', () => {
        const broken = structuredClone(valid);
        broken.head_forms.es.push({ term: 'plural', place: 'loc' });
        expect(() => parseSiteConfig(broken)).toThrow(
            /service "plumber" has no "plural" form in "es"/,
        );
    });

    it('requires head forms for every language', () => {
        const broken = structuredClone(valid);
        delete (broken.head_forms as Record<string, unknown>)['es'];
        expect(() => parseSiteConfig(broken)).toThrow(/no head forms for "es"/);
    });

    it('rejects a parent that is not a place', () => {
        const broken = structuredClone(valid) as unknown as { places: unknown[] };
        broken.places.push({
            ...structuredClone(valid.places[0]!),
            slug: 'old-town',
            parent: 'nowhere',
        });
        expect(() => parseSiteConfig(broken)).toThrow(/unknown parent "nowhere"/);
    });

    it('leaves the vocabulary absent unless the config states one', () => {
        expect(parseSiteConfig(valid).vocabulary).toBeUndefined();
        const stated = parseSiteConfig({
            ...valid,
            vocabulary: { topic_stems: ['plumb'], exclusions: { jobs: '(\\bjobs?\\b)' } },
        });
        expect(stated.vocabulary).toEqual({
            topic_stems: ['plumb'],
            non_distinctive: [],
            brands: [],
            exclusions: { jobs: '(\\bjobs?\\b)' },
            modifiers: {},
        });
    });

    it('rejects a pattern that does not compile, naming its place', () => {
        expect(() =>
            parseSiteConfig({ ...valid, vocabulary: { exclusions: { jobs: '(jobs' } } }),
        ).toThrow(/vocabulary\.exclusions\.jobs: not a pattern/);
        expect(() => parseSiteConfig({ ...valid, vocabulary: { near: '[near' } })).toThrow(
            /vocabulary\.near: not a pattern/,
        );
        expect(() =>
            parseSiteConfig({ ...valid, service_area: { listing_match: '[plumb' } }),
        ).toThrow(/service_area\.listing_match: not a pattern/);
        expect(() => parseSiteConfig({ ...valid, market: { phone_pattern: '(\\d' } })).toThrow(
            /market\.phone_pattern: not a pattern/,
        );
    });

    it('keeps the rule-owned reasons and the place modifier out of the vocabulary', () => {
        const broken = {
            ...valid,
            vocabulary: { exclusions: { brand: 'x' }, modifiers: { place: 'y' } },
        };
        expect(() => parseSiteConfig(broken)).toThrow(/"brand" is decided by a rule/);
        expect(() => parseSiteConfig(broken)).toThrow(/"place" is decided by a rule/);
        const price = parseSiteConfig({
            ...valid,
            vocabulary: { modifiers: { price: '\\bprices?\\b', urgency: 'emergency' } },
        });
        expect(price.vocabulary?.modifiers).toEqual({
            price: '\\bprices?\\b',
            urgency: 'emergency',
        });
    });

    it('fills the path words a language leaves out', () => {
        const config = parseSiteConfig({ ...valid, paths: { es: { services: 'servicios' } } });
        expect(config.paths['es']).toEqual({ services: 'servicios', guides: 'guides' });
        expect(config.paths['en']).toBeUndefined();
    });

    it('refuses a per-km charge without a currency and malformed market codes', () => {
        expect(() => parseSiteConfig({ ...valid, service_area: { per_km: 0.5 } })).toThrow(
            /service_area\.per_km: a per-km charge needs market\.currency/,
        );
        const priced = parseSiteConfig({
            ...valid,
            market: { currency: 'USD' },
            service_area: { per_km: 0.5 },
        });
        expect(priced.service_area?.per_km).toBe(0.5);
        expect(() => parseSiteConfig({ ...valid, market: { country: 'zz' } })).toThrow(
            /market\.country: must be a two-letter uppercase country code/,
        );
        expect(() => parseSiteConfig({ ...valid, market: { home_tlds: ['example'] } })).toThrow(
            /market\.home_tlds\.0/,
        );
    });
});
