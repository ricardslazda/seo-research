import { z } from 'zod';

import { defineQuery } from '../../queries/types.js';
import { readOffpage } from './readings.js';

export const citationsQuery = defineQuery({
    name: 'citations',
    description:
        'the referring domains of the strongest competitor sorted into pursue, review and ignore, with the reason for each',
    params: z.object({ verdict: z.enum(['pursue', 'review', 'ignore']).optional() }),
    run(context, params) {
        const batch = readOffpage(context.db, context.config, context.reference);
        const rows = batch.citations.filter((c) => !params.verdict || c.verdict === params.verdict);
        return {
            meta: {
                query: 'citations',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
                counts: batch.counts,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const listingsQuery = defineQuery({
    name: 'listings',
    description:
        'per place: how many businesses are listed in the category, how many match the trade, the claimed share, the median review count, the top listings and which competitors appear',
    params: z.object({ place: z.string().optional() }),
    run(context, params) {
        const batch = readOffpage(context.db, context.config, context.reference);
        const rows = batch.listings.filter((l) => !params.place || l.place === params.place);
        return {
            meta: {
                query: 'listings',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const offpageQueries = [citationsQuery, listingsQuery];
