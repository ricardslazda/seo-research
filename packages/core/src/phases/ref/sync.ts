import {
    SEARCH_INTENT_LANGUAGES,
    adsLanguagesEndpoint,
    adsLocationsEndpoint,
    labsLocationsAndLanguagesEndpoint,
    serpLanguagesEndpoint,
    serpLocationsEndpoint,
    userDataEndpoint,
    type DfsClient,
    type LocationEntry,
    type LocationIndex,
    type LocationRow,
} from '@seo/dfs-client';

import { writeReference, type Reference } from '../../reference/index.js';

export interface SyncOptions {
    countries: string[];
    referenceDir?: string;
    now?: () => Date;
}

export interface SyncSummary {
    countries: Record<string, { locations: number; labs: string[] }>;
    global: { serp: number; ads: number };
    balance: number | null;
}

function addLocation(
    index: LocationIndex,
    row: LocationRow,
    countryIso: string,
    source: string,
): void {
    const key = String(row.location_code);
    const entry: LocationEntry = index[key] ?? {
        code: row.location_code,
        name: row.location_name,
        type: row.location_type,
        parent: row.location_code_parent ?? null,
        countryIso,
        sources: [],
    };
    if (!entry.sources.includes(source)) entry.sources.push(source);
    index[key] = entry;
}

export async function syncReference(client: DfsClient, options: SyncOptions): Promise<SyncSummary> {
    const countries = options.countries.map((iso) => iso.toUpperCase());
    const locations: LocationIndex = {};
    const summary: SyncSummary = { countries: {}, global: { serp: 0, ads: 0 }, balance: null };
    const reference: Reference = {
        locations,
        support: { global: {}, countries: {}, intentLanguages: [...SEARCH_INTENT_LANGUAGES] },
        prices: null,
        domains: {},
    };

    for (const iso of countries) {
        const serp = await client.call(serpLocationsEndpoint(iso), {});
        for (const row of serp.rows) addLocation(locations, row, iso, 'serp');
        const ads = await client.call(adsLocationsEndpoint(iso), {});
        for (const row of ads.rows) addLocation(locations, row, iso, 'ads');
        summary.countries[iso] = { locations: 0, labs: [] };
    }

    const labs = await client.call(labsLocationsAndLanguagesEndpoint, {});
    for (const row of labs.rows) {
        const iso = row.country_iso_code?.toUpperCase();
        if (!iso || !countries.includes(iso)) continue;
        addLocation(locations, row, iso, 'labs');
        const languages = row.available_languages
            .filter((language) => (language.available_sources ?? ['google']).includes('google'))
            .map((language) => language.language_code);
        reference.support.countries[iso] = { labs: languages };
        summary.countries[iso]!.labs = languages;
    }

    const serpLanguages = await client.call(serpLanguagesEndpoint, {});
    const adsLanguages = await client.call(adsLanguagesEndpoint, {});
    reference.support.global = {
        serp: serpLanguages.rows.map((row) => row.language_code).sort(),
        ads: adsLanguages.rows.map((row) => row.language_code).sort(),
    };
    summary.global = { serp: serpLanguages.rows.length, ads: adsLanguages.rows.length };

    const user = await client.call(userDataEndpoint, {});
    const account = user.rows[0];
    reference.prices = {
        syncedAt: (options.now?.() ?? new Date()).toISOString(),
        price: (account?.price as Record<string, unknown> | null | undefined) ?? null,
    };
    summary.balance = account?.money.balance ?? null;

    for (const entry of Object.values(locations)) {
        summary.countries[entry.countryIso]!.locations++;
    }
    writeReference(reference, options.referenceDir);
    return summary;
}
