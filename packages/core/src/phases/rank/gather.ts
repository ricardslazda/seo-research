import { and, desc, eq } from 'drizzle-orm';

import { serpOrganicEndpoint, stripWww, type DfsClient } from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywords, rankReadings, serpItems, serps } from '../../db/schema.js';
import { buildPlan } from '../../plan/build.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import { researchedLanguages } from '../cluster/gather.js';
import { storeSerp, type PlannedCall } from '../screen/gather.js';

export interface TrackedKeyword {
    text: string;
    language: string;
    pageKey: string;
    path: string;
    role: 'primary' | 'supporting';
    locationCode: number;
}

export interface RankContext {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    domain?: string;
    refresh?: boolean;
    fetchMissing?: boolean;
    log?: (line: string) => void;
    now?: () => Date;
}

export interface RankSummary {
    runId: number;
    domain: string;
    tracked: number;
    read: number;
    fetched: number;
    skipped: number;
    failures: string[];
    cost: number;
}

export function trackedKeywords(
    db: Db,
    config: SiteConfig,
    reference: Reference,
): TrackedKeyword[] {
    const plan = buildPlan(db, config, reference);
    const languages = researchedLanguages(db, config);
    const out: TrackedKeyword[] = [];
    const seen = new Set<string>();
    const firstPlace = config.places[0]?.location_code ?? 0;
    for (const page of plan.pages) {
        if (page.status === 'not-written') continue;
        const locationCode =
            (page.placeSlug &&
                config.places.find((p) => p.slug === page.placeSlug)?.location_code) ||
            firstPlace;
        for (const [language, locale] of Object.entries(page.locales)) {
            if (!languages.includes(language)) continue;
            const push = (text: string | null, role: TrackedKeyword['role']) => {
                if (!text) return;
                const key = `${language}|${text}`;
                if (seen.has(key)) return;
                seen.add(key);
                out.push({
                    text,
                    language,
                    pageKey: page.translationKey,
                    path: locale.path,
                    role,
                    locationCode,
                });
            };
            push(locale.primaryKeyword, 'primary');
            for (const s of locale.supportingKeywords) push(s, 'supporting');
        }
    }
    return out;
}

function keywordRow(db: Db, text: string, language: string, city: number): { id: number } {
    const rows = db
        .select({ id: keywords.id, locationCode: keywords.locationCode })
        .from(keywords)
        .where(and(eq(keywords.text, text), eq(keywords.language, language)))
        .all();
    const cityRow = rows.find((r) => r.locationCode === city) ?? rows[0];
    if (cityRow) return { id: cityRow.id };
    const inserted = db
        .insert(keywords)
        .values({ text, language, locationCode: city, role: 'tracked' })
        .returning({ id: keywords.id })
        .get();
    if (!inserted) throw new Error('keyword insert returned no id');
    return inserted;
}

function latestSerp(db: Db, keywordId: number, city: number) {
    return db
        .select()
        .from(serps)
        .where(and(eq(serps.keywordId, keywordId), eq(serps.locationCode, city)))
        .orderBy(desc(serps.id))
        .limit(1)
        .get();
}

export function planRank(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    options: { refresh?: boolean; fetchMissing?: boolean } = {},
): { tracked: TrackedKeyword[]; calls: PlannedCall[]; total: number } {
    const tracked = trackedKeywords(db, config, reference);
    const city = config.places[0]?.location_code ?? 0;
    const pending = tracked.filter((t) => {
        if (options.refresh) return true;
        if (options.fetchMissing === false) return false;
        const rows = db
            .select({ id: keywords.id })
            .from(keywords)
            .where(and(eq(keywords.text, t.text), eq(keywords.language, t.language)))
            .all();
        return !rows.some((r) => latestSerp(db, r.id, city));
    });
    const price = serpOrganicEndpoint.price({
        keyword: '',
        location_code: city,
        language_code: '',
    });
    return {
        tracked,
        calls: [
            {
                endpoint: 'serp.google.organic',
                count: pending.length,
                unitPrice: price,
                cost: pending.length * price,
            },
        ],
        total: pending.length * price,
    };
}

export async function runRank(context: RankContext): Promise<RankSummary> {
    const { db, client, config, reference } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const domain = stripWww(context.domain ?? config.domain ?? '');
    if (!domain)
        throw new Error('no domain to read: pass --domain or set domain in the site config');
    const city = config.places[0]?.location_code;
    if (!city) throw new Error('the site config has no places');
    const tracked = trackedKeywords(db, config, reference);
    const runId = startRun(db, 'rank', { domain, tracked: tracked.length }, now());
    const summary: RankSummary = {
        runId,
        domain,
        tracked: tracked.length,
        read: 0,
        fetched: 0,
        skipped: 0,
        failures: [],
        cost: 0,
    };
    const packNeedle = config.business_name?.toLowerCase() ?? null;

    for (const item of tracked) {
        const keyword = keywordRow(db, item.text, item.language, item.locationCode);
        let serp = latestSerp(db, keyword.id, item.locationCode);
        if (!serp || context.refresh) {
            if (context.fetchMissing === false && !context.refresh) {
                summary.skipped++;
                continue;
            }
            try {
                const result = await client.call(
                    serpOrganicEndpoint,
                    {
                        keyword: item.text,
                        location_code: item.locationCode,
                        language_code: item.language,
                    },
                    { refresh: context.refresh ?? false, runId },
                );
                summary.cost += result.cost;
                const page = result.rows[0];
                if (page) {
                    storeSerp(
                        db,
                        { id: keyword.id, language: item.language, locationCode: city },
                        page,
                        result.rawId,
                        now().toISOString(),
                    );
                    summary.fetched++;
                }
                serp = latestSerp(db, keyword.id, item.locationCode);
            } catch (error) {
                summary.failures.push(
                    `${item.language} "${item.text}": ${error instanceof Error ? error.message : String(error)}`,
                );
                log(`failed: ${item.text}`);
                continue;
            }
        }
        if (!serp) {
            summary.skipped++;
            continue;
        }
        const items = db.select().from(serpItems).where(eq(serpItems.serpId, serp.id)).all();
        const own = items
            .filter((i) => i.type === 'organic' && i.domain === domain)
            .sort((a, b) => a.rankAbsolute - b.rankAbsolute);
        const best = own[0] ?? null;
        const pathOf = (url: string | null): string | null => {
            if (!url) return null;
            try {
                return new URL(url).pathname.replace(/\/$/, '') || '/';
            } catch {
                return null;
            }
        };
        const claimed = item.path.replace(/\/$/, '') || '/';
        const pack = items.filter((i) => i.type === 'local_pack');
        db.insert(rankReadings)
            .values({
                keywordId: keyword.id,
                domain,
                position: best?.rankAbsolute ?? null,
                url: best?.url ?? null,
                pageKey: item.pageKey,
                pathMatches: best ? pathOf(best.url) === claimed : null,
                ownPagesJson: JSON.stringify(
                    own.map((i) => ({ position: i.rankAbsolute, url: i.url })),
                ),
                packPresent: pack.length > 0,
                packHasBusiness: packNeedle
                    ? pack.some((i) => (i.title ?? '').toLowerCase().includes(packNeedle))
                    : null,
                serpId: serp.id,
                readAt: now().toISOString(),
            })
            .run();
        summary.read++;
    }
    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
