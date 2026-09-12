import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';
import { LabsKeywordData } from './labs-ranked-keywords.js';

export const LabsExpansionItem = LabsKeywordData.extend({
    se_type: z.string().nullable().optional(),
});
export type LabsExpansionItem = z.infer<typeof LabsExpansionItem>;

export const LabsExpansionResult = z.looseObject({
    seed_keyword: z.string().nullable().optional(),
    seed_keywords: z.array(z.string()).nullable().optional(),
    total_count: z.number().nullable().optional(),
    items_count: z.number().nullable().optional(),
    offset_token: z.string().nullable().optional(),
    items: z.array(LabsExpansionItem).nullable().optional(),
});
export type LabsExpansionResult = z.infer<typeof LabsExpansionResult>;

export interface KeywordSuggestionsRequest {
    keyword: string;
    location_code: number;
    language_code: string;
    limit?: number;
    offset?: number;
    include_seed_keyword?: boolean;
    exact_match?: boolean;
    ignore_synonyms?: boolean;
    order_by?: string[];
    filters?: unknown[];
}

export const labsKeywordSuggestionsEndpoint = defineEndpoint<
    KeywordSuggestionsRequest,
    LabsExpansionResult
>({
    name: 'labs.keyword_suggestions',
    path: '/v3/dataforseo_labs/google/keyword_suggestions/live',
    method: 'POST',
    family: 'labs',
    defaults: {
        limit: 1000,
        include_seed_keyword: true,
        order_by: ['keyword_info.search_volume,desc'],
    },
    unorderedArrays: [],
    price: (request) => 0.0101 + 0.00012 * (request.limit ?? 1000),
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(LabsExpansionResult).parse(task.result ?? []),
});

export interface KeywordIdeasRequest {
    keywords: string[];
    location_code: number;
    language_code: string;
    limit?: number;
    offset?: number;
    closely_variants?: boolean;
    order_by?: string[];
    filters?: unknown[];
}

export const labsKeywordIdeasEndpoint = defineEndpoint<KeywordIdeasRequest, LabsExpansionResult>({
    name: 'labs.keyword_ideas',
    path: '/v3/dataforseo_labs/google/keyword_ideas/live',
    method: 'POST',
    family: 'labs',
    defaults: {
        limit: 1000,
        closely_variants: false,
        order_by: ['keyword_info.search_volume,desc'],
    },
    unorderedArrays: ['keywords'],
    price: (request) => 0.0103 + 0.00012 * (request.limit ?? 1000),
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(LabsExpansionResult).parse(task.result ?? []),
});

export const KeywordDifficultyItem = z.looseObject({
    keyword: z.string(),
    keyword_difficulty: z.number().nullable().optional(),
});

export const KeywordDifficultyResult = z.looseObject({
    items: z.array(KeywordDifficultyItem).nullable().optional(),
});
export type KeywordDifficultyResult = z.infer<typeof KeywordDifficultyResult>;

export interface BulkKeywordDifficultyRequest {
    keywords: string[];
    location_code: number;
    language_code: string;
}

export const labsBulkKeywordDifficultyEndpoint = defineEndpoint<
    BulkKeywordDifficultyRequest,
    KeywordDifficultyResult
>({
    name: 'labs.bulk_keyword_difficulty',
    path: '/v3/dataforseo_labs/google/bulk_keyword_difficulty/live',
    method: 'POST',
    family: 'labs',
    defaults: {},
    unorderedArrays: ['keywords'],
    price: (request) => 0.0103 + 0.00012 * request.keywords.length,
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(KeywordDifficultyResult).parse(task.result ?? []),
});

export const SearchIntentItem = z.looseObject({
    keyword: z.string(),
    keyword_intent: z
        .looseObject({
            label: z.string().nullable().optional(),
            probability: z.number().nullable().optional(),
        })
        .nullable()
        .optional(),
    secondary_keyword_intents: z
        .array(
            z.looseObject({
                label: z.string().nullable().optional(),
                probability: z.number().nullable().optional(),
            }),
        )
        .nullable()
        .optional(),
});

export const SearchIntentResult = z.looseObject({
    language_code: z.string().nullable().optional(),
    items: z.array(SearchIntentItem).nullable().optional(),
});
export type SearchIntentResult = z.infer<typeof SearchIntentResult>;

export interface SearchIntentRequest {
    keywords: string[];
    language_code: string;
}

export const labsSearchIntentEndpoint = defineEndpoint<SearchIntentRequest, SearchIntentResult>({
    name: 'labs.search_intent',
    path: '/v3/dataforseo_labs/google/search_intent/live',
    method: 'POST',
    family: 'labs',
    defaults: {},
    unorderedArrays: ['keywords'],
    price: () => 0.0014,
    gate: () => null,
    parse: (task) => z.array(SearchIntentResult).parse(task.result ?? []),
});
