import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const PageMetrics = z.looseObject({
    count: z.number().nullable().optional(),
    etv: z.number().nullable().optional(),
    estimated_paid_traffic_cost: z.number().nullable().optional(),
    pos_1: z.number().nullable().optional(),
    pos_2_3: z.number().nullable().optional(),
    pos_4_10: z.number().nullable().optional(),
});

export const RelevantPageItem = z.looseObject({
    page_address: z.string(),
    metrics: z
        .looseObject({
            organic: PageMetrics.nullable().optional(),
            paid: PageMetrics.nullable().optional(),
        })
        .nullable()
        .optional(),
});
export type RelevantPageItem = z.infer<typeof RelevantPageItem>;

export const RelevantPagesResult = z.looseObject({
    target: z.string().nullable().optional(),
    total_count: z.number().nullable().optional(),
    items_count: z.number().nullable().optional(),
    items: z.array(RelevantPageItem).nullable().optional(),
});
export type RelevantPagesResult = z.infer<typeof RelevantPagesResult>;

export interface RelevantPagesRequest {
    target: string;
    location_code: number;
    language_code: string;
    limit?: number;
    order_by?: string[];
    item_types?: string[];
}

export const labsRelevantPagesEndpoint = defineEndpoint<RelevantPagesRequest, RelevantPagesResult>({
    name: 'labs.relevant_pages',
    path: '/v3/dataforseo_labs/google/relevant_pages/live',
    method: 'POST',
    family: 'labs',
    defaults: { limit: 100, item_types: ['organic'], order_by: ['metrics.organic.etv,desc'] },
    unorderedArrays: ['item_types'],
    price: (request) => 0.0103 + 0.00012 * (request.limit ?? 100),
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(RelevantPagesResult).parse(task.result ?? []),
});
