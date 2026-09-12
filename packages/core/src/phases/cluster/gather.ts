import { and, desc, eq } from 'drizzle-orm';

import { serpOrganicEndpoint, type DfsClient } from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywords, serps } from '../../db/schema.js';
import { currentDecisions, decisionKey } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import { storeSerp, type PlannedCall } from '../screen/gather.js';

export interface ClusterContext {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    refresh?: boolean;
    languages?: string[];
    log?: (line: string) => void;
    now?: () => Date;
}

export interface ClusterSummary {
    runId: number;
    languages: string[];
    shortlisted: number;
    serpsFetched: number;
    serpsCached: number;
    failures: string[];
    cost: number;
}

export interface ShortlistedKeyword {
    id: number;
    text: string;
    language: string;
}

export function researchedLanguages(db: Db, config: SiteConfig): string[] {
    const thresholds = currentDecisions(db, 'threshold');
    return config.languages.filter(
        (language) =>
            thresholds.get(decisionKey(`keywords:${language}`, 'second_language'))?.value !==
            'leave',
    );
}

export function shortlistedKeywords(db: Db, languages: string[]): ShortlistedKeyword[] {
    const decisions = currentDecisions(db, 'keyword');
    const ids = new Set(
        [...decisions.values()]
            .filter((d) => d.kind === 'shortlist' && d.value === 'true')
            .map((d) => Number(d.subjectId)),
    );
    const out: ShortlistedKeyword[] = [];
    const seen = new Set<string>();
    for (const row of db.select().from(keywords).all()) {
        if (!ids.has(row.id) || !languages.includes(row.language)) continue;
        const key = `${row.language}|${row.text}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ id: row.id, text: row.text, language: row.language });
    }
    return out.sort((a, b) => a.language.localeCompare(b.language) || a.text.localeCompare(b.text));
}

export function planCluster(
    db: Db,
    config: SiteConfig,
    options: { languages?: string[] } = {},
): { keywords: ShortlistedKeyword[]; calls: PlannedCall[]; total: number } {
    const languages = options.languages ?? researchedLanguages(db, config);
    const list = shortlistedKeywords(db, languages);
    const city = config.places[0]?.location_code ?? 0;
    const pending = list.filter((keyword) => !latestCitySerp(db, keyword.id, city));
    const price = serpOrganicEndpoint.price({
        keyword: '',
        location_code: city,
        language_code: '',
    });
    const calls: PlannedCall[] = [
        {
            endpoint: 'serp.google.organic',
            count: pending.length,
            unitPrice: price,
            cost: pending.length * price,
        },
    ];
    return { keywords: list, calls, total: pending.length * price };
}

export function latestCitySerp(
    db: Db,
    keywordId: number,
    city: number,
): { id: number } | undefined {
    return db
        .select({ id: serps.id })
        .from(serps)
        .where(and(eq(serps.keywordId, keywordId), eq(serps.locationCode, city)))
        .orderBy(desc(serps.id))
        .limit(1)
        .get();
}

export async function runCluster(context: ClusterContext): Promise<ClusterSummary> {
    const { db, client, config } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const languages = context.languages ?? researchedLanguages(db, config);
    const list = shortlistedKeywords(db, languages);
    const first = config.places[0];
    if (!first) throw new Error('the site config has no places');
    const runId = startRun(db, 'cluster', { languages, shortlisted: list.length }, now());
    const summary: ClusterSummary = {
        runId,
        languages,
        shortlisted: list.length,
        serpsFetched: 0,
        serpsCached: 0,
        failures: [],
        cost: 0,
    };
    const settled = await Promise.allSettled(
        list.map(async (keyword) => {
            if (!context.refresh && latestCitySerp(db, keyword.id, first.location_code))
                return { keyword, result: null };
            const result = await client.call(
                serpOrganicEndpoint,
                {
                    keyword: keyword.text,
                    location_code: first.location_code,
                    language_code: keyword.language,
                },
                { refresh: context.refresh ?? false, runId },
            );
            return { keyword, result };
        }),
    );
    for (const [index, outcome] of settled.entries()) {
        const keyword = list[index]!;
        if (outcome.status === 'rejected') {
            const message =
                outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
            summary.failures.push(`${keyword.language} "${keyword.text}": ${message}`);
            log(`failed: ${keyword.text} (${message})`);
            continue;
        }
        const { result } = outcome.value;
        if (!result) continue;
        summary.cost += result.cost;
        if (result.cached) summary.serpsCached++;
        const serp = result.rows[0];
        if (!serp) continue;
        const stored = storeSerp(
            db,
            { id: keyword.id, language: keyword.language, locationCode: first.location_code },
            serp,
            result.rawId,
            now().toISOString(),
        );
        if (stored !== null) summary.serpsFetched++;
    }
    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
