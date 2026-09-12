import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const ReferringDomainItem = z.looseObject({
    domain: z.string(),
    rank: z.number().nullable().optional(),
    backlinks: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    lost_date: z.string().nullable().optional(),
    backlinks_spam_score: z.number().nullable().optional(),
    broken_backlinks: z.number().nullable().optional(),
    broken_pages: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
    referring_links_tld: z.record(z.string(), z.number()).nullable().optional(),
    referring_links_types: z.record(z.string(), z.number()).nullable().optional(),
    referring_links_attributes: z.record(z.string(), z.number()).nullable().optional(),
    referring_links_platform_types: z.record(z.string(), z.number()).nullable().optional(),
    referring_links_semantic_locations: z.record(z.string(), z.number()).nullable().optional(),
    referring_links_countries: z.record(z.string(), z.number()).nullable().optional(),
});
export type ReferringDomainItem = z.infer<typeof ReferringDomainItem>;

export const ReferringDomainsResult = z.looseObject({
    target: z.string().nullable().optional(),
    total_count: z.number().nullable().optional(),
    items_count: z.number().nullable().optional(),
    items: z.array(ReferringDomainItem).nullable().optional(),
});
export type ReferringDomainsResult = z.infer<typeof ReferringDomainsResult>;

export interface ReferringDomainsRequest {
    target: string;
    limit?: number;
    offset?: number;
    order_by?: string[];
    filters?: unknown[];
    backlinks_status_type?: 'all' | 'live' | 'lost';
    include_subdomains?: boolean;
    exclude_internal_backlinks?: boolean;
}

export const backlinksReferringDomainsEndpoint = defineEndpoint<
    ReferringDomainsRequest,
    ReferringDomainsResult
>({
    name: 'backlinks.referring_domains',
    path: '/v3/backlinks/referring_domains/live',
    method: 'POST',
    family: 'backlinks',
    defaults: {
        limit: 300,
        backlinks_status_type: 'live',
        include_subdomains: true,
        exclude_internal_backlinks: true,
        order_by: ['rank,desc'],
    },
    unorderedArrays: [],
    price: (request) => 0.024 + 0.000036 * (request.limit ?? 300),
    gate: () => null,
    parse: (task) => z.array(ReferringDomainsResult).parse(task.result ?? []),
});
