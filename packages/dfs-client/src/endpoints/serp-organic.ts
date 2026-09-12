import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const SerpRating = z.looseObject({
    value: z.number().nullable().optional(),
    votes_count: z.number().nullable().optional(),
});

export const SerpItem = z.looseObject({
    type: z.string(),
    rank_group: z.number(),
    rank_absolute: z.number(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    rating: SerpRating.nullable().optional(),
    items: z.array(z.unknown()).nullable().optional(),
});
export type SerpItem = z.infer<typeof SerpItem>;

export const SerpResult = z.looseObject({
    keyword: z.string(),
    type: z.string(),
    se_domain: z.string(),
    location_code: z.number(),
    language_code: z.string(),
    check_url: z.string(),
    datetime: z.string(),
    item_types: z.array(z.string()),
    se_results_count: z.number().nullable(),
    items_count: z.number(),
    items: z.array(SerpItem),
});
export type SerpResult = z.infer<typeof SerpResult>;

export interface SerpOrganicRequest {
    keyword: string;
    location_code: number;
    language_code: string;
    device?: 'desktop' | 'mobile';
    os?: 'windows' | 'macos' | 'android' | 'ios';
    depth?: number;
}

export const SERP_FIXED_ARGS = { device: 'mobile', os: 'android', depth: 20 } as const;

export const serpOrganicEndpoint = defineEndpoint<SerpOrganicRequest, SerpResult>({
    name: 'serp.google.organic',
    path: '/v3/serp/google/organic/live/advanced',
    method: 'POST',
    family: 'serp',
    defaults: { ...SERP_FIXED_ARGS },
    unorderedArrays: [],
    price: (request) => 0.002 * Math.ceil((request.depth ?? SERP_FIXED_ARGS.depth) / 10),
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(SerpResult).parse(task.result ?? []),
});
