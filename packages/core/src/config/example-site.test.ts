import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import type { Reference } from '../reference/index.js';
import { marketOf } from './market.js';
import { loadSiteConfig } from './site-config.js';

const exampleDir = fileURLToPath(new URL('../../../../sites/example/', import.meta.url));

const reference: Reference = {
    locations: {},
    support: { global: {}, countries: {}, intentLanguages: [] },
    prices: null,
    domains: {},
};

describe('the example site', () => {
    it('loads through loadSiteConfig with every block stated', () => {
        const config = loadSiteConfig(exampleDir);
        expect(config.slug).toBe('example');
        expect(config.languages).toEqual(['en']);
        expect(config.services.map((service) => service.key)).toEqual([
            'plumber',
            'boiler-repair',
            'drain-unblocking',
        ]);
        expect(config.paths['en']).toEqual({ services: 'plumbing', guides: 'advice' });
        expect(config.service_area?.per_km).toBe(0.8);
        expect(Object.keys(config.vocabulary?.modifiers ?? {})).toContain('price');
        const market = marketOf(config, reference);
        expect(market.country).toBe('GB');
        expect(market.homeTlds).toEqual(['.uk']);
        expect(market.price?.test('Boiler repair from £95')).toBe(true);
        expect('Call 01632 960 123'.match(market.phone)).toEqual(['01632 960 123']);
    });
});
