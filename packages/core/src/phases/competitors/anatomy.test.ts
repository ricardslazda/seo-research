import { describe, expect, it } from 'vitest';

import { parsePageContent } from '@seo/dfs-client';

import { marketOf } from '../../config/market.js';
import { parseSiteConfig } from '../../config/site-config.js';
import type { Reference } from '../../reference/index.js';
import { readAnatomy } from './anatomy.js';

const reference: Reference = {
    locations: {},
    support: { global: {}, countries: {}, intentLanguages: [] },
    prices: null,
    domains: {},
};

const marketWith = (market: Record<string, unknown>) =>
    marketOf(
        parseSiteConfig({
            slug: 'northbridge-plumbing',
            languages: ['en'],
            places: [
                { slug: 'northbridge', location_code: 1, name: { en: { nom: 'Northbridge' } } },
            ],
            services: [{ key: 'plumber', head: { en: { term: 'plumber' } } }],
            head_forms: { en: [{ term: 'term', place: 'nom' }] },
            market: { country: 'ZZ', ...market },
        }),
        reference,
    );

const page = parsePageContent({
    header: {
        secondary_content: [
            { text: 'Call 555-0100', url: 'https://plumbers-r-us.example/contact/' },
            { text: 'Partner', url: 'https://directory-one.example/' },
        ],
    },
    main_topic: [
        {
            h_title: 'Plumbers in Northbridge',
            level: 1,
            primary_content: [
                { text: 'Ring 555-0100 or (555) 010-0199 any time. Visits from 60 GBP.' },
                { text: 'Order number 12345 is not a phone. Do you cover Eastfield?' },
            ],
        },
    ],
    footer: { primary_content: [{ text: 'Open since 1998; call 555 0100.' }] },
});

describe('readAnatomy', () => {
    it('counts distinct phone numbers of seven to fifteen digits and keeps internal links', () => {
        const anatomy = readAnatomy(page, 'www.plumbers-r-us.example', marketWith({}));
        expect(anatomy.phoneCount).toBe(2);
        expect(anatomy.questionsCount).toBe(1);
        expect(anatomy.navLinks).toEqual([
            { text: 'Call 555-0100', url: 'https://plumbers-r-us.example/contact/' },
        ]);
    });

    it('reads prices only in the market currency', () => {
        expect(readAnatomy(page, 'plumbers-r-us.example', marketWith({})).hasPrices).toBe(false);
        expect(
            readAnatomy(page, 'plumbers-r-us.example', marketWith({ currency: 'USD' })).hasPrices,
        ).toBe(false);
        expect(
            readAnatomy(page, 'plumbers-r-us.example', marketWith({ currency: 'GBP' })).hasPrices,
        ).toBe(true);
    });
});
