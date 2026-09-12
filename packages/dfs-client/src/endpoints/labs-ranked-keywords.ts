import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const LabsKeywordInfo = z.looseObject({
    search_volume: z.number().nullable().optional(),
    cpc: z.number().nullable().optional(),
    competition: z.number().nullable().optional(),
    competition_level: z.string().nullable().optional(),
    low_top_of_page_bid: z.number().nullable().optional(),
    high_top_of_page_bid: z.number().nullable().optional(),
    monthly_searches: z
        .array(z.looseObject({ year: z.number(), month: z.number(), search_volume: z.number() }))
        .nullable()
        .optional(),
});

export const LabsKeywordData = z.looseObject({
    keyword: z.string(),
    location_code: z.number().nullable().optional(),
    language_code: z.string().nullable().optional(),
    keyword_info: LabsKeywordInfo.nullable().optional(),
    keyword_properties: z
        .looseObject({
            keyword_difficulty: z.number().nullable().optional(),
            detected_language: z.string().nullable().optional(),
        })
        .nullable()
        .optional(),
    search_intent_info: z
        .looseObject({
            main_intent: z.string().nullable().optional(),
            foreign_intent: z.array(z.string()).nullable().optional(),
        })
        .nullable()
        .optional(),
});
export type LabsKeywordData = z.infer<typeof LabsKeywordData>;

export const RankedSerpItem = z.looseObject({
    type: z.string().nullable().optional(),
    rank_group: z.number().nullable().optional(),
    rank_absolute: z.number().nullable().optional(),
    url: z.string().nullable().optional(),
    relative_url: z.string().nullable().optional(),
    etv: z.number().nullable().optional(),
    estimated_paid_traffic_cost: z.number().nullable().optional(),
});

export const RankedKeywordItem = z.looseObject({
    keyword_data: LabsKeywordData,
    ranked_serp_element: z
        .looseObject({ serp_item: RankedSerpItem.nullable().optional() })
        .nullable()
        .optional(),
});
export type RankedKeywordItem = z.infer<typeof RankedKeywordItem>;

export const RankedKeywordsResult = z.looseObject({
    target: z.string().nullable().optional(),
    total_count: z.number().nullable().optional(),
    items_count: z.number().nullable().optional(),
    metrics: z.record(z.string(), z.unknown()).nullable().optional(),
    items: z.array(RankedKeywordItem).nullable().optional(),
});
export type RankedKeywordsResult = z.infer<typeof RankedKeywordsResult>;

export interface RankedKeywordsRequest {
    target: string;
    location_code: number;
    language_code: string;
    limit?: number;
    offset?: number;
    item_types?: string[];
    order_by?: string[];
    filters?: unknown[];
}

export const labsRankedKeywordsEndpoint = defineEndpoint<
    RankedKeywordsRequest,
    RankedKeywordsResult
>({
    name: 'labs.ranked_keywords',
    path: '/v3/dataforseo_labs/google/ranked_keywords/live',
    method: 'POST',
    family: 'labs',
    defaults: { limit: 1000, item_types: ['organic'] },
    unorderedArrays: ['item_types'],
    price: (request) => 0.012 + 0.00012 * (request.limit ?? 1000),
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(RankedKeywordsResult).parse(task.result ?? []),
});
