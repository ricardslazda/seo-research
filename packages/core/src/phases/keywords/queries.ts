import { z } from 'zod';

import { defineQuery, type QueryContext } from '../../queries/types.js';
import { readKeywords, type KeywordsBatch } from './readings.js';

function meta(
    context: QueryContext,
    name: string,
    batch: KeywordsBatch,
    extra: Record<string, unknown>,
): Record<string, unknown> {
    return {
        query: name,
        site: context.site,
        generated_at: new Date().toISOString(),
        languages: batch.languages,
        thresholds: batch.thresholds,
        counts: batch.counts,
        ...extra,
    };
}

const common = z.object({
    language: z.string().optional(),
    service: z.string().optional(),
    min_volume: z.coerce.number().optional(),
    include_excluded: z.coerce.boolean().optional(),
    limit: z.coerce.number().int().positive().optional(),
});

export const keywordsExpandedQuery = defineQuery({
    name: 'keywords-expanded',
    description:
        'every expanded keyword with city and country volume, bid, difficulty, intent, sources, seeds, the service it belongs to, its modifiers, its form group and any exclusion',
    params: common,
    run(context, params) {
        const batch = readKeywords(context.db, context.config);
        const rows = batch.rows
            .filter((r) => !params.language || r.language === params.language)
            .filter((r) => !params.service || r.services.includes(params.service))
            .filter((r) => params.include_excluded || !r.excluded)
            .filter(
                (r) =>
                    params.min_volume === undefined ||
                    (r.volumeCity ?? r.volumeCountry ?? 0) >= params.min_volume,
            )
            .slice(0, params.limit ?? 1000);
        return {
            meta: meta(context, 'keywords-expanded', batch, { count: rows.length }),
            rows: rows as unknown as Record<string, unknown>[],
        };
    },
});

export const keywordFormsQuery = defineQuery({
    name: 'keyword-forms',
    description:
        'form groups: keywords that are inflections, spellings or word orders of one another, with the primary form and any silently aggregated series',
    params: z.object({
        language: z.string().optional(),
        min_members: z.coerce.number().int().optional(),
    }),
    run(context, params) {
        const batch = readKeywords(context.db, context.config);
        const groups = new Map<string, typeof batch.rows>();
        for (const r of batch.rows) {
            if (params.language && r.language !== params.language) continue;
            const key = `${r.language}|${r.formKey}`;
            groups.set(key, [...(groups.get(key) ?? []), r]);
        }
        const rows = [...groups.entries()]
            .filter(([, members]) => members.length >= (params.min_members ?? 2))
            .map(([key, members]) => ({
                language: key.split('|')[0],
                form_key: key.split('|')[1],
                primary: members.find((m) => m.formPrimary)?.text ?? members[0]!.text,
                members: members.map(
                    (m) => `${m.text} (${m.volumeCity ?? m.volumeCountry ?? '-'})`,
                ),
                aggregated: members.some((m) => m.aggregatedWith.length > 0),
            }))
            .sort((a, b) => b.members.length - a.members.length);
        return { meta: meta(context, 'keyword-forms', batch, { count: rows.length }), rows };
    },
});

export const keywordExclusionsQuery = defineQuery({
    name: 'keyword-exclusions',
    description:
        'keywords the rules or a person excluded, with the reason and who decided, for review',
    params: z.object({ language: z.string().optional(), reason: z.string().optional() }),
    run(context, params) {
        const batch = readKeywords(context.db, context.config);
        const rows = batch.rows
            .filter(
                (r) =>
                    r.excluded &&
                    (!params.language || r.language === params.language) &&
                    (!params.reason || r.excluded === params.reason),
            )
            .map((r) => ({
                keyword_id: r.keywordId,
                text: r.text,
                language: r.language,
                reason: r.excluded,
                by: r.excludedBy,
                volume_city: r.volumeCity,
                volume_country: r.volumeCountry,
            }));
        return { meta: meta(context, 'keyword-exclusions', batch, { count: rows.length }), rows };
    },
});

export const keywordShortlistQuery = defineQuery({
    name: 'keyword-shortlist',
    description:
        "the keywords that could be some page's primary keyword: not excluded, the primary form of their group, with measured demand or a shortlist decision, grouped by service",
    params: z.object({ language: z.string().optional(), min_volume: z.coerce.number().optional() }),
    run(context, params) {
        const batch = readKeywords(context.db, context.config);
        const rows = batch.rows
            .filter(
                (r) =>
                    !r.excluded &&
                    r.formPrimary &&
                    (!params.language || r.language === params.language),
            )
            .filter(
                (r) =>
                    r.shortlisted ||
                    (r.volumeCity ?? r.volumeCountry ?? 0) >= (params.min_volume ?? 10),
            )
            .map((r) => ({
                keyword_id: r.keywordId,
                text: r.text,
                language: r.language,
                service: r.primaryService,
                volume_city: r.volumeCity,
                volume_country: r.volumeCountry,
                bid: r.bidHigh,
                difficulty: r.difficulty,
                intent: r.intent,
                modifiers: r.modifiers.join(','),
                shortlisted: r.shortlisted,
            }));
        const byService: Record<string, number> = {};
        for (const r of rows)
            byService[r.service ?? 'none'] = (byService[r.service ?? 'none'] ?? 0) + 1;
        return {
            meta: meta(context, 'keyword-shortlist', batch, {
                count: rows.length,
                by_service: byService,
            }),
            rows,
        };
    },
});

export const keywordQueries = [
    keywordsExpandedQuery,
    keywordFormsQuery,
    keywordExclusionsQuery,
    keywordShortlistQuery,
];
