import { z } from 'zod';

import { defineQuery } from '../../queries/types.js';
import { readClusters } from './readings.js';

export const clustersQuery = defineQuery({
    name: 'clusters',
    description:
        'one row per cluster: the primary keyword, its members, summed volume, intent from the result page against the endpoint label, a page type guess, the service, and what the page held',
    params: z.object({
        language: z.string().optional(),
        threshold: z.coerce.number().int().optional(),
    }),
    run(context, params) {
        const batch = readClusters(context.db, context.config, context.reference, {
            threshold: params.threshold,
        });
        const rows = batch.clusters.filter(
            (c) => !params.language || c.language === params.language,
        );
        return {
            meta: {
                query: 'clusters',
                site: context.site,
                generated_at: new Date().toISOString(),
                languages: batch.languages,
                count: rows.length,
                degenerate: batch.degenerate,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const serpOverlapQuery = defineQuery({
    name: 'serp-overlap',
    description:
        'every pair of shortlisted keywords with shared top-ten results, shared domains, shared pack occupants, and the tie-breakers that keep two queries apart',
    params: z.object({
        language: z.string().optional(),
        min_shared: z.coerce.number().int().optional(),
    }),
    run(context, params) {
        const batch = readClusters(context.db, context.config, context.reference);
        const rows = batch.pairs
            .filter((p) => !params.language || p.language === params.language)
            .filter((p) => params.min_shared === undefined || p.sharedUrls >= params.min_shared)
            .sort((a, b) => b.sharedUrls - a.sharedUrls);
        return {
            meta: {
                query: 'serp-overlap',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
                degenerate: batch.degenerate,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const clusterQueries = [clustersQuery, serpOverlapQuery];
