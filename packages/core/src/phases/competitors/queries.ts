import { z } from 'zod';

import { defineQuery } from '../../queries/types.js';
import { readCompetitors } from './readings.js';

export const competitorsQuery = defineQuery({
    name: 'competitors',
    description:
        'every domain marked as a competitor: breadth on the screen, referring domains, keyword-database totals, earning pages, site keywords and the anatomy of its home page',
    params: z.object({}),
    run(context) {
        const data = readCompetitors(context.db, context.config, context.reference);
        return {
            meta: {
                query: 'competitors',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: data.rows.length,
            },
            rows: data.rows as unknown as Record<string, unknown>[],
        };
    },
});

export const competitorPagesQuery = defineQuery({
    name: 'competitor-pages',
    description:
        'earning pages of the competitors ranked by traffic value per keyword, with a page type guess and anatomy where parsed',
    params: z.object({
        domain: z.string().optional(),
        limit: z.coerce.number().int().positive().optional(),
    }),
    run(context, params) {
        const data = readCompetitors(context.db, context.config, context.reference);
        const rows = data.pages
            .filter((page) => !params.domain || page.domain === params.domain)
            .slice(0, params.limit ?? 200);
        const byType: Record<string, number> = {};
        for (const page of data.pages) byType[page.pageType] = (byType[page.pageType] ?? 0) + 1;
        return {
            meta: {
                query: 'competitor-pages',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
                by_type: byType,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const competitorKeywordsQuery = defineQuery({
    name: 'competitor-keywords',
    description:
        'the seed set: every keyword a competitor ranks for or that Google Ads derives from its site, with volume, difficulty, intent and how many competitors share it',
    params: z.object({
        language: z.string().optional(),
        source: z.enum(['ranked', 'site_idea']).optional(),
        min_volume: z.coerce.number().optional(),
        limit: z.coerce.number().int().positive().optional(),
    }),
    run(context, params) {
        const data = readCompetitors(context.db, context.config, context.reference);
        const rows = data.seeds
            .filter((seed) => !params.language || seed.language === params.language)
            .filter((seed) => !params.source || seed.source === params.source)
            .filter(
                (seed) =>
                    params.min_volume === undefined || (seed.volume ?? 0) >= params.min_volume,
            )
            .slice(0, params.limit ?? 500);
        const measured = data.seeds.filter((seed) => seed.volumeStatus === 'measured').length;
        return {
            meta: {
                query: 'competitor-keywords',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
                total: data.seeds.length,
                measured,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const competitorMenusQuery = defineQuery({
    name: 'competitor-menus',
    description:
        'the navigation links on each competitor home page: their service inventory, with a page type guess per link',
    params: z.object({ domain: z.string().optional() }),
    run(context, params) {
        const data = readCompetitors(context.db, context.config, context.reference);
        const rows = data.menus.filter((item) => !params.domain || item.domain === params.domain);
        return {
            meta: {
                query: 'competitor-menus',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const coverageQuery = defineQuery({
    name: 'coverage',
    description:
        'service by place by language: which competitors hold a purpose-built page in the top ten, whether a pack exists, and where nobody holds a page',
    params: z.object({ language: z.string().optional(), gaps: z.coerce.boolean().optional() }),
    run(context, params) {
        const data = readCompetitors(context.db, context.config, context.reference);
        const rows = data.coverage
            .filter((cell) => !params.language || cell.language === params.language)
            .filter((cell) => !params.gaps || cell.gap);
        const gaps: Record<string, number> = {};
        for (const cell of data.coverage)
            if (cell.gap) gaps[cell.language] = (gaps[cell.language] ?? 0) + 1;
        return {
            meta: {
                query: 'coverage',
                site: context.site,
                generated_at: new Date().toISOString(),
                count: rows.length,
                gaps,
            },
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const competitorQueries = [
    competitorsQuery,
    competitorPagesQuery,
    competitorKeywordsQuery,
    competitorMenusQuery,
    coverageQuery,
];
