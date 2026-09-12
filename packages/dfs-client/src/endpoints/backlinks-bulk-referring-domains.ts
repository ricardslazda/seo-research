import { z } from 'zod';

import { chunk, stripWww, type BatchResult } from '../batch.js';
import type { CallOptions, DfsClient } from '../client.js';
import { defineEndpoint } from '../endpoint.js';

export const ReferringDomainsRow = z.looseObject({
    target: z.string(),
    backlinks: z.number().nullable().optional(),
    referring_domains: z.number().nullable().optional(),
    referring_main_domains: z.number().nullable().optional(),
    referring_pages: z.number().nullable().optional(),
});
export type ReferringDomainsRow = z.infer<typeof ReferringDomainsRow>;

const Result = z.looseObject({
    items: z.array(ReferringDomainsRow).nullable().optional(),
});

export interface BulkReferringDomainsRequest {
    targets: string[];
}

export const BULK_REFERRING_DOMAINS_MAX_TARGETS = 1000;

export const bulkReferringDomainsEndpoint = defineEndpoint<
    BulkReferringDomainsRequest,
    ReferringDomainsRow
>({
    name: 'backlinks.bulk_referring_domains',
    path: '/v3/backlinks/bulk_referring_domains/live',
    method: 'POST',
    family: 'backlinks',
    defaults: {},
    unorderedArrays: ['targets'],
    price: (request) => 0.02 + 0.00004 * request.targets.length,
    gate: () => null,
    parse: (task) =>
        z
            .array(Result)
            .parse(task.result ?? [])
            .flatMap((result) => result.items ?? []),
});

export async function bulkReferringDomains(
    client: DfsClient,
    targets: readonly string[],
    options: CallOptions = {},
): Promise<BatchResult<ReferringDomainsRow>> {
    const sent = [...new Set(targets.map(stripWww).filter(Boolean))];
    const result: BatchResult<ReferringDomainsRow> = {
        rows: [],
        missing: [],
        rawIds: [],
        cost: 0,
        cachedCalls: 0,
    };
    for (const batch of chunk(sent, BULK_REFERRING_DOMAINS_MAX_TARGETS)) {
        const call = await client.call(bulkReferringDomainsEndpoint, { targets: batch }, options);
        result.rows.push(...call.rows);
        result.rawIds.push(call.rawId);
        result.cost += call.cost;
        if (call.cached) result.cachedCalls++;
    }
    const got = new Set(result.rows.map((row) => stripWww(row.target)));
    result.missing = sent.filter((target) => !got.has(target));
    return result;
}
