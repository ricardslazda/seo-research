import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const LocationRow = z.looseObject({
    location_code: z.number(),
    location_name: z.string(),
    location_code_parent: z.number().nullable().optional(),
    country_iso_code: z.string().nullable().optional(),
    location_type: z.string(),
});
export type LocationRow = z.infer<typeof LocationRow>;

export const LabsLanguage = z.looseObject({
    language_name: z.string(),
    language_code: z.string(),
    available_sources: z.array(z.string()).nullable().optional(),
    keywords: z.number().nullable().optional(),
    serps: z.number().nullable().optional(),
});

export const LabsLocationRow = LocationRow.extend({
    available_languages: z.array(LabsLanguage),
});
export type LabsLocationRow = z.infer<typeof LabsLocationRow>;

export const UserDataRow = z.looseObject({
    money: z.looseObject({
        balance: z.number().nullable().optional(),
        total: z.number().nullable().optional(),
    }),
    price: z.record(z.string(), z.unknown()).nullable().optional(),
    limits: z.record(z.string(), z.unknown()).nullable().optional(),
});
export type UserDataRow = z.infer<typeof UserDataRow>;

const free = {
    method: 'GET',
    family: 'free',
    defaults: {},
    unorderedArrays: [],
    price: () => 0,
    gate: () => null,
} as const;

export function serpLocationsEndpoint(countryIso: string) {
    return defineEndpoint<Record<string, never>, LocationRow>({
        ...free,
        name: `serp.google.locations.${countryIso.toLowerCase()}`,
        path: `/v3/serp/google/locations/${countryIso.toLowerCase()}`,
        parse: (task) => z.array(LocationRow).parse(task.result ?? []),
    });
}

export function adsLocationsEndpoint(countryIso: string) {
    return defineEndpoint<Record<string, never>, LocationRow>({
        ...free,
        name: `ads.locations.${countryIso.toLowerCase()}`,
        path: `/v3/keywords_data/google_ads/locations/${countryIso.toLowerCase()}`,
        parse: (task) => z.array(LocationRow).parse(task.result ?? []),
    });
}

export const labsLocationsAndLanguagesEndpoint = defineEndpoint<
    Record<string, never>,
    LabsLocationRow
>({
    ...free,
    name: 'labs.locations_and_languages',
    path: '/v3/dataforseo_labs/locations_and_languages',
    parse: (task) => z.array(LabsLocationRow).parse(task.result ?? []),
});

export const userDataEndpoint = defineEndpoint<Record<string, never>, UserDataRow>({
    ...free,
    name: 'appendix.user_data',
    path: '/v3/appendix/user_data',
    parse: (task) => z.array(UserDataRow).parse(task.result ?? []),
});

export const LanguageRow = z.looseObject({
    language_name: z.string(),
    language_code: z.string(),
});
export type LanguageRow = z.infer<typeof LanguageRow>;

export const serpLanguagesEndpoint = defineEndpoint<Record<string, never>, LanguageRow>({
    ...free,
    name: 'serp.google.languages',
    path: '/v3/serp/google/languages',
    parse: (task) => z.array(LanguageRow).parse(task.result ?? []),
});

export const adsLanguagesEndpoint = defineEndpoint<Record<string, never>, LanguageRow>({
    ...free,
    name: 'ads.languages',
    path: '/v3/keywords_data/google_ads/languages',
    parse: (task) => z.array(LanguageRow).parse(task.result ?? []),
});

export const SEARCH_INTENT_LANGUAGES = [
    'ar',
    'zh-TW',
    'cs',
    'da',
    'nl',
    'en',
    'fi',
    'fr',
    'de',
    'he',
    'hi',
    'it',
    'ja',
    'ko',
    'ms',
    'nb',
    'pl',
    'pt',
    'ro',
    'ru',
    'es',
    'sv',
    'th',
    'uk',
    'vi',
    'bg',
    'hr',
    'sr',
    'sl',
    'bs',
] as const;
