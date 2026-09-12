import { z } from 'zod';

import { defineQuery } from '../queries/types.js';
import { buildPlan } from './build.js';

export const planPagesQuery = defineQuery({
    name: 'plan-pages',
    description:
        'every planned page with its type, locales, primary and supporting keywords, demand per locale, referrers, build tier, status and notes',
    params: z.object({ type: z.string().optional(), status: z.string().optional() }),
    run(context, params) {
        const plan = buildPlan(context.db, context.config, context.reference);
        const rows = plan.pages
            .filter((p) => !params.type || p.type === params.type)
            .filter((p) => !params.status || p.status === params.status)
            .map((p) => ({
                key: p.translationKey,
                type: p.type,
                tier: p.buildTier,
                status: p.status,
                service: p.serviceKey,
                place: p.placeSlug,
                ...Object.fromEntries(
                    Object.entries(p.locales).flatMap(([l, locale]) => [
                        [`${l}_path`, locale.path],
                        [`${l}_primary`, locale.primaryKeyword],
                        [`${l}_supporting`, locale.supportingKeywords.length],
                        [`${l}_demand`, locale.demand],
                    ]),
                ),
                linked_from: p.linkedFrom.join(','),
                angle: p.angle,
                notes: p.notes.join('; '),
            }));
        const byStatus: Record<string, number> = {};
        for (const p of plan.pages) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;
        return {
            meta: {
                query: 'plan-pages',
                site: context.site,
                generated_at: plan.site.generatedAt,
                count: rows.length,
                budget: plan.site.pageBudget,
                by_status: byStatus,
                not_written: plan.notWritten,
            },
            rows,
        };
    },
});

export const planQueries = [planPagesQuery];
