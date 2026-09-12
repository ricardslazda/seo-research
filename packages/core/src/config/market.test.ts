import { describe, expect, it } from 'vitest';

import type { Reference } from '../reference/index.js';
import { MarketError, countryIsoFor, marketOf } from './market.js';
import { parseSiteConfig } from './site-config.js';

const site = (market: Record<string, unknown> = {}) =>
    parseSiteConfig({
        slug: 'northbridge-plumbing',
        languages: ['en'],
        places: [
            { slug: 'northbridge', location_code: 1001001, name: { en: { nom: 'Northbridge' } } },
        ],
        services: [{ key: 'plumber', head: { en: { term: 'plumber' } } }],
        head_forms: { en: [{ term: 'term', place: 'nom' }] },
        market,
    });

const reference: Reference = {
    locations: {
        '1001001': {
            code: 1001001,
            name: 'Northbridge,Testland',
            type: 'City',
            parent: 2999,
            countryIso: 'ZZ',
            sources: ['serp', 'ads'],
        },
    },
    support: { global: {}, countries: {}, intentLanguages: [] },
    prices: null,
    domains: {},
};
const unsynced: Reference = { ...reference, locations: {} };

describe('countryIsoFor', () => {
    it('takes the stated country, then the country of the first place', () => {
        expect(countryIsoFor(site({ country: 'XX' }), unsynced)).toBe('XX');
        expect(countryIsoFor(site(), reference)).toBe('ZZ');
        expect(() => countryIsoFor(site(), unsynced)).toThrow(MarketError);
        expect(() => countryIsoFor(site(), unsynced)).toThrow(/seo ref sync --countries/);
    });
});

describe('marketOf', () => {
    it('defaults the home domain to the country and leaves prices unread without a currency', () => {
        const market = marketOf(site(), reference);
        expect(market.country).toBe('ZZ');
        expect(market.currency).toBeNull();
        expect(market.price).toBeNull();
        expect(market.homeTlds).toEqual(['.zz']);
        expect(market.ignoreCountries.size).toBe(0);
        expect('Call 555 0100 today'.match(market.phone)).toEqual(['555 0100']);
    });

    it('reads a price by the currency code or a mark on either side of the number', () => {
        const market = marketOf(
            site({ currency: 'USD', currency_marks: ['$'], home_tlds: ['.example'] }),
            reference,
        );
        const price = market.price!;
        expect(price.test('Boiler repair from $95')).toBe(true);
        expect(price.test('from 95 USD a visit')).toBe(true);
        expect(price.test('USD95')).toBe(true);
        expect(price.test('95 USDT')).toBe(false);
        expect(price.test('call us on 95 days a year')).toBe(false);
        expect(market.homeTlds).toEqual(['.example']);
    });

    it('uses the stated phone pattern', () => {
        const market = marketOf(site({ phone_pattern: '\\b0\\d{3} \\d{6}\\b' }), reference);
        expect('0123 456789 or 555 0100'.match(market.phone)).toEqual(['0123 456789']);
    });
});
