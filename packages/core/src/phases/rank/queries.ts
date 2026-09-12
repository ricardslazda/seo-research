import { z } from 'zod';

import { defineQuery } from '../../queries/types.js';
import { readRank } from './readings.js';

export const rankQuery = defineQuery({
    name: 'rank',
    description:
        'where the site sits for every tracked keyword: position and ranking URL against the page the plan claims, the pack, and what the reading means',
    params: z.object({ domain: z.string().optional(), ladder: z.string().optional() }),
    run(context, params) {
        const batch = readRank(context.db, context.config, context.reference, params.domain);
        const rows = batch.rows.filter((r) => !params.ladder || r.ladder === params.ladder);
        return {
            meta: {
                query: 'rank',
                site: context.site,
                generated_at: new Date().toISOString(),
                domain: batch.domain,
                read_at: batch.readAt,
                count: rows.length,
                counts: batch.counts,
                mismatches: batch.mismatches,
                by_page_type: batch.byPageType,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const rankQueries = [rankQuery];
