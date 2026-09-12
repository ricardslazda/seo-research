import type { Reference } from '../reference/index.js';
import type { SiteConfig } from './site-config.js';

// The market block of a site config, resolved against the reference data and compiled once per
// reading, the way vocabularyOf compiles the trade's words.
export interface Market {
    country: string;
    currency: string | null;
    price: RegExp | null;
    phone: RegExp;
    homeTlds: string[];
    ignoreCountries: Set<string>;
}

export const DEFAULT_PHONE_PATTERN = '\\+?\\d[\\d\\s().-]{5,}\\d';

export class MarketError extends Error {
    constructor(readonly locationCode: number | null) {
        super(
            `the site's country is unknown: set market.country in the site config, or run "seo ref sync --countries <ISO,...>" for the country of location ${locationCode ?? '(no place)'}`,
        );
        this.name = 'MarketError';
    }
}

export function countryIsoFor(config: SiteConfig, reference: Reference): string {
    if (config.market.country) return config.market.country;
    const first = config.places[0];
    const iso = first ? reference.locations[String(first.location_code)]?.countryIso : undefined;
    if (!iso) throw new MarketError(first?.location_code ?? null);
    return iso;
}

function escapePattern(text: string): string {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A number next to the currency code or one of its marks, on either side: "120 GBP", "£120".
function pricePattern(marks: string[]): RegExp {
    const after = marks.map((mark) => escapePattern(mark) + (/\w$/.test(mark) ? '\\b' : ''));
    const before = marks.map((mark) => (/^\w/.test(mark) ? '\\b' : '') + escapePattern(mark));
    return new RegExp(
        `\\d[\\d\\s.,]*\\s?(?:${after.join('|')})|(?:${before.join('|')})\\s?\\d`,
        'i',
    );
}

export function marketOf(config: SiteConfig, reference: Reference): Market {
    const block = config.market;
    const country = countryIsoFor(config, reference);
    const currency = block.currency ?? null;
    return {
        country,
        currency,
        price: currency ? pricePattern([currency, ...block.currency_marks]) : null,
        phone: new RegExp(block.phone_pattern ?? DEFAULT_PHONE_PATTERN, 'g'),
        homeTlds: block.home_tlds ?? [`.${country.toLowerCase()}`],
        ignoreCountries: new Set(block.ignore_countries),
    };
}
