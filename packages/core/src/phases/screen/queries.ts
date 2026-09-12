import { z } from 'zod';

import { costSummary } from '../../cost.js';
import { defineQuery, type QueryContext } from '../../queries/types.js';
import { loadScreen } from './load.js';
import { readScreen } from './readings.js';

function meta(
    context: QueryContext,
    name: string,
    extra: Record<string, unknown>,
): Record<string, unknown> {
    const cost = costSummary(context.db).reduce((sum, row) => sum + row.cost, 0);
    return {
        query: name,
        site: context.site,
        generated_at: new Date().toISOString(),
        cost_usd: Math.round(cost * 10000) / 10000,
        ...extra,
    };
}

export const screenBatchQuery = defineQuery({
    name: 'screen-batch',
    description:
        'every candidate with its per-language readings, plus the batch distribution the cut lines come from',
    params: z.object({}),
    run(context) {
        const batch = readScreen(loadScreen(context.db, context.config, context.reference));
        return {
            meta: meta(context, 'screen-batch', {
                languages: batch.languages,
                count: batch.rows.length,
                thresholds: batch.thresholds,
                distribution: batch.distribution,
            }),
            rows: batch.rows as unknown as Record<string, unknown>[],
        };
    },
});

export const screenDomainsQuery = defineQuery({
    name: 'screen-domains',
    description:
        'every domain seen in the top twenty, with its kind, who decided it, and its referring domains',
    params: z.object({}),
    run(context) {
        const data = loadScreen(context.db, context.config, context.reference);
        const batch = readScreen(data);
        const seen = new Map<
            string,
            {
                domain: string;
                kind: string;
                kind_by: string | null;
                referring_domains: number | null;
                appearances: number;
                services: number;
                places: number;
                best_rank: number;
                pages: Set<string>;
            }
        >();
        for (const row of batch.rows) {
            for (const [language, reading] of Object.entries(row.languages)) {
                for (const item of reading?.top10 ?? []) {
                    const entry = seen.get(item.domain) ?? {
                        domain: item.domain,
                        kind: item.kind,
                        kind_by: item.kindBy,
                        referring_domains: item.referringDomains,
                        appearances: 0,
                        services: item.servicesRanked,
                        places: item.placesRanked,
                        best_rank: item.rank,
                        pages: new Set<string>(),
                    };
                    entry.pages.add(`${row.candidateId}|${language}`);
                    entry.appearances = entry.pages.size;
                    entry.best_rank = Math.min(entry.best_rank, item.rank);
                    seen.set(item.domain, entry);
                }
            }
        }
        const rows = [...seen.values()]
            .map(({ pages: _pages, ...entry }) => entry)
            .sort((a, b) => b.appearances - a.appearances || a.best_rank - b.best_rank);
        return { meta: meta(context, 'screen-domains', { count: rows.length }), rows };
    },
});

export const screenKeywordsQuery = defineQuery({
    name: 'screen-keywords',
    description:
        'every composed keyword with its volume row and role, for checking forms and aggregation',
    params: z.object({ language: z.string().optional() }),
    run(context, params) {
        const data = loadScreen(context.db, context.config, context.reference);
        const rows = [...data.keywords.values()]
            .filter((k) => !params.language || k.language === params.language)
            .map((k) => ({
                keyword_id: k.id,
                text: k.text,
                language: k.language,
                role: k.role,
                variant_kind: k.variantKind,
                candidate_id: k.candidateId,
                volume: k.metric?.volume ?? null,
                volume_status: k.metric?.volumeStatus ?? 'missing',
                cpc: k.metric?.cpc ?? null,
                bid_high: k.metric?.bidHigh ?? null,
                series_hash: k.metric?.seriesHash ?? null,
            }))
            .sort(
                (a, b) =>
                    a.language.localeCompare(b.language) ||
                    (a.candidate_id ?? 0) - (b.candidate_id ?? 0) ||
                    a.role.localeCompare(b.role),
            );
        return { meta: meta(context, 'screen-keywords', { count: rows.length }), rows };
    },
});

export const screenQueries = [screenBatchQuery, screenDomainsQuery, screenKeywordsQuery];
