import { createHash } from 'node:crypto';

import { and, eq, isNull } from 'drizzle-orm';

import {
    adsSearchVolume,
    bulkReferringDomains,
    keywordKey,
    serpOrganicEndpoint,
    stripWww,
    type AdsSearchVolumeRow,
    type DfsClient,
    type SerpItem,
    type SerpOrganicRequest,
    type SerpResult,
} from '@seo/dfs-client';

import { countryIsoFor } from '../../config/market.js';
import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import {
    candidates,
    domains,
    keywordMetrics,
    keywords,
    places,
    serpItems,
    serps,
    services,
} from '../../db/schema.js';
import { currentDecisions, decisionKey } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import { composeKeywords, type ComposedKeyword } from './compose.js';

export interface ScreenContext {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    refresh?: boolean;
    log?: (line: string) => void;
    now?: () => Date;
}

export interface ScreenSummary {
    runId: number;
    candidates: number;
    keywords: number;
    volumeCalls: number;
    serps: number;
    serpsSkipped: number;
    serpsFailed: number;
    failures: string[];
    domains: number;
    cost: number;
    cachedCalls: number;
}

export type VolumeStatus = 'measured' | 'below_floor' | 'missing';

export interface PlannedCall {
    endpoint: string;
    count: number;
    unitPrice: number;
    cost: number;
}

export interface ScreenPlan {
    calls: PlannedCall[];
    total: number;
}

export class UnknownPlaceError extends Error {
    constructor(readonly problems: string[]) {
        super(`places not usable for the screen:\n  ${problems.join('\n  ')}`);
        this.name = 'UnknownPlaceError';
    }
}

export function validatePlaces(config: SiteConfig, reference: Reference): void {
    const problems: string[] = [];
    for (const place of config.places) {
        const entry = reference.locations[String(place.location_code)];
        if (!entry) {
            problems.push(
                `${place.slug}: location ${place.location_code} is not in reference/locations.json`,
            );
            continue;
        }
        for (const source of ['serp', 'ads']) {
            if (!entry.sources.includes(source)) {
                problems.push(
                    `${place.slug}: location ${place.location_code} (${entry.name}) is missing from the ${source} location list`,
                );
            }
        }
    }
    if (problems.length > 0) throw new UnknownPlaceError(problems);
}

export function countryCodeFor(config: SiteConfig, reference: Reference): number | undefined {
    const iso = countryIsoFor(config, reference);
    return Object.values(reference.locations).find(
        (l) => l.type === 'Country' && l.countryIso === iso,
    )?.code;
}

export function planScreen(config: SiteConfig, reference?: Reference): ScreenPlan {
    const composed = composeKeywords(
        config,
        reference ? countryCodeFor(config, reference) : undefined,
    );
    const groups = new Set(composed.map((k) => `${k.language}|${k.locationCode}`));
    const candidateCount = config.services.length * config.places.length;
    const serpCount = candidateCount * config.languages.length;
    const serpPrice = serpOrganicEndpoint.price({
        keyword: '',
        location_code: 0,
        language_code: '',
    });
    const domainEstimate = Math.min(1000, serpCount * 10);
    const backlinksPrice = 0.02 + 0.00004 * domainEstimate;
    const calls: PlannedCall[] = [
        {
            endpoint: 'ads.search_volume',
            count: groups.size,
            unitPrice: 0.09,
            cost: groups.size * 0.09,
        },
        {
            endpoint: 'serp.google.organic',
            count: serpCount,
            unitPrice: serpPrice,
            cost: serpCount * serpPrice,
        },
        {
            endpoint: 'backlinks.bulk_referring_domains',
            count: 1,
            unitPrice: backlinksPrice,
            cost: backlinksPrice,
        },
    ];
    return { calls, total: calls.reduce((sum, call) => sum + call.cost, 0) };
}

export function seriesHash(monthly: AdsSearchVolumeRow['monthly_searches']): string | null {
    if (!monthly || monthly.length === 0) return null;
    const ordered = [...monthly].sort((a, b) => a.year - b.year || a.month - b.month);
    if (ordered.every((m) => m.search_volume === 0)) return null;
    return createHash('sha1')
        .update(ordered.map((m) => `${m.year}-${m.month}:${m.search_volume}`).join(','))
        .digest('hex');
}

export function volumeStatus(row: AdsSearchVolumeRow | undefined): VolumeStatus {
    if (!row) return 'missing';
    return row.search_volume === null ? 'below_floor' : 'measured';
}

function upsertMarket(db: Db, config: SiteConfig): Map<string, number> {
    for (const service of config.services) {
        const headJson = JSON.stringify(service.head);
        db.insert(services)
            .values({ key: service.key, headJson })
            .onConflictDoUpdate({ target: services.key, set: { headJson } })
            .run();
    }
    for (const place of config.places) {
        const values = {
            slug: place.slug,
            locationCode: place.location_code,
            kind: place.kind,
            parentSlug: place.parent ?? null,
            nameJson: JSON.stringify(place.name),
        };
        db.insert(places)
            .values(values)
            .onConflictDoUpdate({ target: places.slug, set: values })
            .run();
    }
    const ids = new Map<string, number>();
    for (const service of config.services) {
        for (const place of config.places) {
            db.insert(candidates)
                .values({ serviceKey: service.key, placeSlug: place.slug })
                .onConflictDoNothing()
                .run();
            const row = db
                .select({ id: candidates.id })
                .from(candidates)
                .where(
                    and(
                        eq(candidates.serviceKey, service.key),
                        eq(candidates.placeSlug, place.slug),
                    ),
                )
                .get();
            if (row) ids.set(`${service.key}|${place.slug}`, row.id);
        }
    }
    return ids;
}

interface StoredKeyword extends ComposedKeyword {
    id: number;
    candidateId: number | null;
}

function upsertKeywords(
    db: Db,
    composed: ComposedKeyword[],
    candidateIds: Map<string, number>,
): StoredKeyword[] {
    const stored: StoredKeyword[] = [];
    const idByText = new Map<string, number>();
    const lookup = (text: string, language: string, locationCode: number): number => {
        const key = `${language}|${locationCode}|${keywordKey(text)}`;
        const known = idByText.get(key);
        if (known) return known;
        const row = db
            .select({ id: keywords.id })
            .from(keywords)
            .where(
                and(
                    eq(keywords.text, text),
                    eq(keywords.language, language),
                    eq(keywords.locationCode, locationCode),
                ),
            )
            .get();
        if (!row) throw new Error(`keyword "${text}" was not stored`);
        idByText.set(key, row.id);
        return row.id;
    };
    const heads = composed.filter((k) => k.role !== 'variant');
    const variants = composed.filter((k) => k.role === 'variant');
    for (const keyword of [...heads, ...variants]) {
        const candidateId = keyword.placeSlug
            ? (candidateIds.get(`${keyword.serviceKey}|${keyword.placeSlug}`) ?? null)
            : null;
        const variantOf = keyword.headText
            ? lookup(keyword.headText, keyword.language, keyword.locationCode)
            : null;
        const set = {
            candidateId,
            role: keyword.role,
            variantOf,
            variantKind: keyword.variantKind,
        };
        db.insert(keywords)
            .values({
                text: keyword.text,
                language: keyword.language,
                locationCode: keyword.locationCode,
                ...set,
            })
            .onConflictDoUpdate({
                target: [keywords.text, keywords.language, keywords.locationCode],
                set,
            })
            .run();
        stored.push({
            ...keyword,
            id: lookup(keyword.text, keyword.language, keyword.locationCode),
            candidateId,
        });
    }
    return stored;
}

function hasMetricsFor(db: Db, rawId: number): boolean {
    return (
        db
            .select({ id: keywordMetrics.id })
            .from(keywordMetrics)
            .where(eq(keywordMetrics.rawId, rawId))
            .limit(1)
            .get() !== undefined
    );
}

function hasSerpFor(db: Db, rawId: number): boolean {
    return (
        db.select({ id: serps.id }).from(serps).where(eq(serps.rawId, rawId)).limit(1).get() !==
        undefined
    );
}

function payloadFor(item: SerpItem): string | null {
    const payload: Record<string, unknown> = {};
    if (item.rating) payload['rating'] = item.rating;
    if (item.items) payload['items'] = item.items;
    return Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;
}

export function storeSerp(
    db: Db,
    keyword: { id: number; language: string; locationCode: number },
    serp: SerpResult,
    rawId: number,
    fetchedAt: string,
): number | null {
    if (hasSerpFor(db, rawId)) return null;
    const organic = serp.items.filter((item) => item.type === 'organic');
    const serpRow = db
        .insert(serps)
        .values({
            keywordId: keyword.id,
            locationCode: keyword.locationCode,
            language: keyword.language,
            device: 'mobile',
            depth: 20,
            firstOrganicRank:
                organic.length > 0 ? Math.min(...organic.map((item) => item.rank_absolute)) : null,
            itemTypesJson: JSON.stringify(serp.item_types),
            fetchedAt,
            rawId,
        })
        .returning({ id: serps.id })
        .get();
    if (!serpRow) throw new Error('serp insert returned no id');
    for (const item of serp.items) {
        db.insert(serpItems)
            .values({
                serpId: serpRow.id,
                rankAbsolute: item.rank_absolute,
                rankGroup: item.rank_group,
                type: item.type,
                domain: item.domain ? stripWww(item.domain) : null,
                url: item.url ?? null,
                title: item.title ?? null,
                payloadJson: payloadFor(item),
            })
            .run();
    }
    return serpRow.id;
}

export async function runScreen(context: ScreenContext): Promise<ScreenSummary> {
    const { db, client, config, reference } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const callOptions = { refresh: context.refresh ?? false };
    validatePlaces(config, reference);

    const runId = startRun(
        db,
        'screen',
        { refresh: callOptions.refresh, languages: config.languages },
        now(),
    );
    const summary: ScreenSummary = {
        runId,
        candidates: 0,
        keywords: 0,
        volumeCalls: 0,
        serps: 0,
        serpsSkipped: 0,
        serpsFailed: 0,
        failures: [],
        domains: 0,
        cost: 0,
        cachedCalls: 0,
    };

    const candidateIds = upsertMarket(db, config);
    summary.candidates = candidateIds.size;
    const stored = upsertKeywords(
        db,
        composeKeywords(config, countryCodeFor(config, reference)),
        candidateIds,
    );
    summary.keywords = stored.length;

    const groups = new Map<string, StoredKeyword[]>();
    for (const keyword of stored) {
        const key = `${keyword.language}|${keyword.locationCode}`;
        groups.set(key, [...(groups.get(key) ?? []), keyword]);
    }
    for (const [group, members] of groups) {
        const [language, locationCode] = group.split('|') as [string, string];
        log(`volume: ${members.length} keywords, ${language} at ${locationCode}`);
        const result = await adsSearchVolume(
            client,
            {
                keywords: members.map((k) => k.text),
                location_code: Number(locationCode),
                language_code: language,
            },
            { ...callOptions, runId },
        );
        summary.volumeCalls += result.rawIds.length;
        summary.cost += result.cost;
        summary.cachedCalls += result.cachedCalls;
        const rawId = result.rawIds[0] ?? null;
        if (rawId !== null && hasMetricsFor(db, rawId)) continue;
        const byKey = new Map(result.rows.map((row) => [keywordKey(row.keyword), row]));
        for (const keyword of members) {
            const row = byKey.get(keywordKey(keyword.text));
            db.insert(keywordMetrics)
                .values({
                    keywordId: keyword.id,
                    source: 'ads',
                    volume: row?.search_volume ?? null,
                    volumeStatus: volumeStatus(row),
                    cpc: row?.cpc ?? null,
                    competitionIndex: row?.competition_index ?? null,
                    bidLow: row?.low_top_of_page_bid ?? null,
                    bidHigh: row?.high_top_of_page_bid ?? null,
                    monthlyJson: row?.monthly_searches
                        ? JSON.stringify(row.monthly_searches)
                        : null,
                    seriesHash: seriesHash(row?.monthly_searches ?? null),
                    fetchedAt: now().toISOString(),
                    rawId,
                })
                .run();
            if (rawId !== null) {
                db.update(keywords)
                    .set({ firstRawId: rawId })
                    .where(and(eq(keywords.id, keyword.id), isNull(keywords.firstRawId)))
                    .run();
            }
        }
    }

    const skip = new Set<number>();
    const current = currentDecisions(db, 'candidate');
    for (const [key, id] of candidateIds) {
        if (current.get(decisionKey(String(id), 'local_facts'))?.value === 'no') {
            skip.add(id);
            log(`skip: ${key} (local facts answered no)`);
        }
    }

    const placeLocation = (keyword: StoredKeyword): number =>
        config.places.find((p) => p.slug === keyword.placeSlug)?.location_code ??
        keyword.locationCode;
    const headsAll = stored.filter((k) => k.role === 'head' && k.candidateId !== null);
    const heads = headsAll.filter((k) => !skip.has(k.candidateId as number));
    summary.serpsSkipped = headsAll.length - heads.length;
    const seenDomains = new Set<string>();
    const settled = await Promise.allSettled(
        heads.map(async (keyword) => {
            const result = await client.call(
                serpOrganicEndpoint,
                {
                    keyword: keyword.text,
                    location_code: placeLocation(keyword),
                    language_code: keyword.language,
                },
                { ...callOptions, runId },
            );
            return { keyword, result };
        }),
    );
    const results: {
        keyword: StoredKeyword;
        result: Awaited<ReturnType<typeof client.call<SerpOrganicRequest, SerpResult>>>;
    }[] = [];
    for (const [index, outcome] of settled.entries()) {
        if (outcome.status === 'fulfilled') {
            results.push(outcome.value);
            continue;
        }
        const keyword = heads[index]!;
        const message =
            outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason);
        summary.serpsFailed++;
        summary.failures.push(`${keyword.language} "${keyword.text}": ${message}`);
        log(`failed: ${keyword.language} "${keyword.text}" (${message})`);
    }
    for (const { keyword, result } of results) {
        summary.cost += result.cost;
        if (result.cached) summary.cachedCalls++;
        const serp = result.rows[0];
        if (!serp) continue;
        for (const item of serp.items) {
            if (item.type === 'organic' && item.rank_absolute <= 20 && item.domain) {
                seenDomains.add(stripWww(item.domain));
            }
        }
        if (hasSerpFor(db, result.rawId)) continue;
        const organic = serp.items.filter((item) => item.type === 'organic');
        const serpRow = db
            .insert(serps)
            .values({
                keywordId: keyword.id,
                locationCode: placeLocation(keyword),
                language: keyword.language,
                device: 'mobile',
                depth: 20,
                firstOrganicRank:
                    organic.length > 0
                        ? Math.min(...organic.map((item) => item.rank_absolute))
                        : null,
                itemTypesJson: JSON.stringify(serp.item_types),
                fetchedAt: now().toISOString(),
                rawId: result.rawId,
            })
            .returning({ id: serps.id })
            .get();
        if (!serpRow) throw new Error('serp insert returned no id');
        for (const item of serp.items) {
            db.insert(serpItems)
                .values({
                    serpId: serpRow.id,
                    rankAbsolute: item.rank_absolute,
                    rankGroup: item.rank_group,
                    type: item.type,
                    domain: item.domain ? stripWww(item.domain) : null,
                    url: item.url ?? null,
                    title: item.title ?? null,
                    payloadJson: payloadFor(item),
                })
                .run();
        }
        summary.serps++;
    }

    if (seenDomains.size > 0) {
        log(`referring domains: ${seenDomains.size} domains`);
        const result = await bulkReferringDomains(client, [...seenDomains], {
            ...callOptions,
            runId,
        });
        summary.cost += result.cost;
        summary.cachedCalls += result.cachedCalls;
        const rawId = result.rawIds[0] ?? null;
        for (const row of result.rows) {
            const values = {
                domain: stripWww(row.target),
                referringDomains: row.referring_domains ?? null,
                backlinks: row.backlinks ?? null,
                referringMainDomains: row.referring_main_domains ?? null,
                fetchedAt: now().toISOString(),
                rawId,
            };
            db.insert(domains)
                .values(values)
                .onConflictDoUpdate({ target: domains.domain, set: values })
                .run();
            summary.domains++;
        }
    }

    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
