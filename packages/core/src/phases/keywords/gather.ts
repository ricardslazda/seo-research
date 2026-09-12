import { and, eq } from 'drizzle-orm';

import {
    ADS_KEYWORDS_FOR_KEYWORDS_MAX_SEEDS,
    adsKeywordsForKeywordsEndpoint,
    adsSearchVolume,
    chunk,
    isAdsSafeKeyword,
    keywordKey,
    labsBulkKeywordDifficultyEndpoint,
    labsKeywordIdeasEndpoint,
    labsKeywordSuggestionsEndpoint,
    labsSearchIntentEndpoint,
    normalizeKeyword,
    type AdsSearchVolumeRow,
    type DfsClient,
    type LabsExpansionItem,
} from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywordMetrics, keywordOrigins, keywords } from '../../db/schema.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import { labsLanguageFor } from '../competitors/gather.js';
import { seriesHash, volumeStatus, type PlannedCall } from '../screen/gather.js';
import {
    collectSeeds,
    mentionsService,
    serviceStemsAll,
    type Seed,
    type SeedOptions,
} from './seeds.js';

export interface KeywordsContext extends SeedOptions {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    refresh?: boolean;
    suggestionsLimit?: number;
    ideasLimit?: number;
    ideasTopicality?: number;
    log?: (line: string) => void;
    now?: () => Date;
}

export interface KeywordsSummary {
    runId: number;
    seeds: Record<string, number>;
    suggestions: number;
    ideas: number;
    ideasAbandoned: boolean;
    ideasTopicality: number | null;
    adsIdeas: number;
    volumesFetched: number;
    difficulties: number;
    intents: number;
    failures: string[];
    cost: number;
    cachedCalls: number;
}

export function planKeywords(
    seeds: Seed[],
    config: SiteConfig,
    reference: Reference,
    options: { suggestionsLimit?: number; ideasLimit?: number } = {},
): { calls: PlannedCall[]; total: number } {
    const labs = labsLanguageFor(config, reference);
    const calls: PlannedCall[] = [];
    const byLanguage = new Map<string, Seed[]>();
    for (const seed of seeds)
        byLanguage.set(seed.language, [...(byLanguage.get(seed.language) ?? []), seed]);
    if (labs) {
        const serviceSeeds = (byLanguage.get(labs.language) ?? []).filter(
            (s) => s.origin === 'service',
        ).length;
        const suggestPrice = 0.0101 + 0.00012 * (options.suggestionsLimit ?? 300);
        calls.push({
            endpoint: 'labs.keyword_suggestions',
            count: serviceSeeds,
            unitPrice: suggestPrice,
            cost: serviceSeeds * suggestPrice,
        });
        const ideasPrice = 0.0103 + 0.00012 * (options.ideasLimit ?? 500);
        calls.push({
            endpoint: 'labs.keyword_ideas',
            count: 1,
            unitPrice: ideasPrice,
            cost: ideasPrice,
        });
        calls.push({
            endpoint: 'labs.bulk_keyword_difficulty',
            count: 2,
            unitPrice: 0.13,
            cost: 0.26,
        });
    }
    let adsCalls = 0;
    for (const list of byLanguage.values())
        adsCalls += Math.ceil(
            list.filter((s) => s.origin !== 'question').length /
                ADS_KEYWORDS_FOR_KEYWORDS_MAX_SEEDS,
        );
    calls.push({
        endpoint: 'ads.keywords_for_keywords',
        count: adsCalls,
        unitPrice: 0.09,
        cost: adsCalls * 0.09,
    });
    calls.push({ endpoint: 'ads.search_volume', count: 2, unitPrice: 0.09, cost: 0.18 });
    calls.push({ endpoint: 'labs.search_intent', count: 1, unitPrice: 0.0014, cost: 0.0014 });
    return { calls, total: calls.reduce((sum, c) => sum + c.cost, 0) };
}

function upsertKeyword(
    db: Db,
    text: string,
    language: string,
    locationCode: number,
    role: string,
    rawId: number | null,
): number {
    const normalized = normalizeKeyword(text).toLowerCase();
    db.insert(keywords)
        .values({ text: normalized, language, locationCode, role, firstRawId: rawId })
        .onConflictDoNothing()
        .run();
    const row = db
        .select({ id: keywords.id })
        .from(keywords)
        .where(
            and(
                eq(keywords.text, normalized),
                eq(keywords.language, language),
                eq(keywords.locationCode, locationCode),
            ),
        )
        .get();
    if (!row) throw new Error(`keyword "${normalized}" was not stored`);
    return row.id;
}

function recordOrigin(
    db: Db,
    keywordId: number,
    source: string,
    seed: string,
    rawId: number | null,
): void {
    db.insert(keywordOrigins)
        .values({ keywordId, source, seed, rawId })
        .onConflictDoNothing()
        .run();
}

function hasMetric(db: Db, keywordId: number, source: string, rawId: number | null): boolean {
    if (rawId === null) return false;
    return (
        db
            .select({ id: keywordMetrics.id })
            .from(keywordMetrics)
            .where(
                and(
                    eq(keywordMetrics.keywordId, keywordId),
                    eq(keywordMetrics.source, source),
                    eq(keywordMetrics.rawId, rawId),
                ),
            )
            .limit(1)
            .get() !== undefined
    );
}

function storeLabsItem(
    db: Db,
    keywordId: number,
    item: LabsExpansionItem,
    source: string,
    rawId: number,
    now: string,
): void {
    if (hasMetric(db, keywordId, source, rawId)) return;
    const info = item.keyword_info ?? null;
    const monthly = info?.monthly_searches ?? null;
    db.insert(keywordMetrics)
        .values({
            keywordId,
            source,
            volume: info?.search_volume ?? null,
            volumeStatus: typeof info?.search_volume === 'number' ? 'measured' : 'below_floor',
            cpc: info?.cpc ?? null,
            competitionIndex:
                typeof info?.competition === 'number' ? Math.round(info.competition * 100) : null,
            bidLow: info?.low_top_of_page_bid ?? null,
            bidHigh: info?.high_top_of_page_bid ?? null,
            monthlyJson: monthly ? JSON.stringify(monthly) : null,
            seriesHash: seriesHash(monthly),
            difficulty: item.keyword_properties?.keyword_difficulty ?? null,
            intentEndpoint: item.search_intent_info?.main_intent ?? null,
            fetchedAt: now,
            rawId,
        })
        .run();
}

function storeAdsRow(
    db: Db,
    keywordId: number,
    row: AdsSearchVolumeRow | undefined,
    source: string,
    rawId: number | null,
    now: string,
): void {
    if (hasMetric(db, keywordId, source, rawId)) return;
    db.insert(keywordMetrics)
        .values({
            keywordId,
            source,
            volume: row?.search_volume ?? null,
            volumeStatus: volumeStatus(row),
            cpc: row?.cpc ?? null,
            competitionIndex: row?.competition_index ?? null,
            bidLow: row?.low_top_of_page_bid ?? null,
            bidHigh: row?.high_top_of_page_bid ?? null,
            monthlyJson: row?.monthly_searches ? JSON.stringify(row.monthly_searches) : null,
            seriesHash: seriesHash(row?.monthly_searches ?? null),
            fetchedAt: now,
            rawId,
        })
        .run();
}

export function topicality(
    items: { keyword: string }[],
    stems: string[],
    sample = 40,
): number | null {
    const top = items.slice(0, sample);
    if (top.length === 0) return null;
    return top.filter((item) => mentionsService(item.keyword, stems)).length / top.length;
}

export async function runKeywords(context: KeywordsContext): Promise<KeywordsSummary> {
    const { db, client, config, reference } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const stamp = () => now().toISOString();
    const callOptions = { refresh: context.refresh ?? false };
    const stems = serviceStemsAll(config);
    const seeds = collectSeeds(db, config, context);
    const labs = labsLanguageFor(config, reference);
    const firstPlace = config.places[0];
    if (!firstPlace) throw new Error('the site config has no places');
    const city = firstPlace.location_code;

    const runId = startRun(db, 'keywords', { seeds: seeds.length, labs }, now());
    const summary: KeywordsSummary = {
        runId,
        seeds: {},
        suggestions: 0,
        ideas: 0,
        ideasAbandoned: false,
        ideasTopicality: null,
        adsIdeas: 0,
        volumesFetched: 0,
        difficulties: 0,
        intents: 0,
        failures: [],
        cost: 0,
        cachedCalls: 0,
    };
    for (const seed of seeds)
        summary.seeds[seed.language] = (summary.seeds[seed.language] ?? 0) + 1;
    const fail = (what: string, error: unknown): void => {
        summary.failures.push(`${what}: ${error instanceof Error ? error.message : String(error)}`);
        log(`failed: ${what}`);
    };
    const track = (result: { cost: number; cached: boolean }): void => {
        summary.cost += result.cost;
        if (result.cached) summary.cachedCalls++;
    };

    const needCityVolume = new Map<string, Set<string>>();
    const noteForVolume = (language: string, text: string): void => {
        needCityVolume.set(language, (needCityVolume.get(language) ?? new Set()).add(text));
    };

    if (labs) {
        const serviceSeeds = seeds.filter(
            (s) => s.language === labs.language && s.origin === 'service',
        );
        for (const seed of serviceSeeds) {
            try {
                log(`suggestions: ${seed.text}`);
                const result = await client.call(
                    labsKeywordSuggestionsEndpoint,
                    {
                        keyword: seed.text,
                        location_code: labs.countryCode,
                        language_code: labs.language,
                        limit: context.suggestionsLimit ?? 300,
                    },
                    { ...callOptions, runId },
                );
                track(result);
                for (const item of result.rows[0]?.items ?? []) {
                    const id = upsertKeyword(
                        db,
                        item.keyword,
                        labs.language,
                        labs.countryCode,
                        'suggestion',
                        result.rawId,
                    );
                    storeLabsItem(db, id, item, 'labs_suggest', result.rawId, stamp());
                    recordOrigin(db, id, 'labs_suggest', seed.text, result.rawId);
                    noteForVolume(labs.language, item.keyword);
                    summary.suggestions++;
                }
            } catch (error) {
                fail(`suggestions for "${seed.text}"`, error);
            }
        }
        try {
            log('ideas: all service terms');
            const result = await client.call(
                labsKeywordIdeasEndpoint,
                {
                    keywords: serviceSeeds.map((s) => s.text).slice(0, 200),
                    location_code: labs.countryCode,
                    language_code: labs.language,
                    limit: context.ideasLimit ?? 500,
                },
                { ...callOptions, runId },
            );
            track(result);
            const items = result.rows[0]?.items ?? [];
            const share = topicality(items, stems);
            summary.ideasTopicality = share;
            if (share !== null && share < (context.ideasTopicality ?? 0.5)) {
                summary.ideasAbandoned = true;
                log(
                    `ideas abandoned: only ${Math.round(share * 100)}% of the top rows concern the services`,
                );
            } else {
                for (const item of items) {
                    const id = upsertKeyword(
                        db,
                        item.keyword,
                        labs.language,
                        labs.countryCode,
                        'idea',
                        result.rawId,
                    );
                    storeLabsItem(db, id, item, 'labs_idea', result.rawId, stamp());
                    recordOrigin(db, id, 'labs_idea', 'service terms', result.rawId);
                    noteForVolume(labs.language, item.keyword);
                    summary.ideas++;
                }
            }
        } catch (error) {
            fail('ideas', error);
        }
    }

    for (const language of config.languages) {
        const own = seeds.filter((s) => s.language === language);
        const forIdeas = own.filter((s) => s.origin !== 'question' && isAdsSafeKeyword(s.text));
        for (const batch of chunk(forIdeas, ADS_KEYWORDS_FOR_KEYWORDS_MAX_SEEDS)) {
            try {
                log(`ads ideas: ${language}, ${batch.length} seeds`);
                const result = await client.call(
                    adsKeywordsForKeywordsEndpoint,
                    {
                        keywords: batch.map((s) => s.text),
                        location_code: city,
                        language_code: language,
                    },
                    { ...callOptions, runId },
                );
                track(result);
                for (const row of result.rows) {
                    const id = upsertKeyword(
                        db,
                        row.keyword,
                        language,
                        city,
                        'ads_idea',
                        result.rawId,
                    );
                    storeAdsRow(db, id, row, 'ads_idea', result.rawId, stamp());
                    recordOrigin(
                        db,
                        id,
                        'ads_idea',
                        batch.map((s) => s.text).join(' | '),
                        result.rawId,
                    );
                    summary.adsIdeas++;
                }
            } catch (error) {
                fail(`ads ideas for ${language}`, error);
            }
        }
        for (const seed of own.filter((s) => s.origin === 'question')) {
            const id = upsertKeyword(db, seed.text, language, city, 'question', null);
            recordOrigin(db, id, 'serp_question', seed.text, null);
            noteForVolume(language, seed.text);
        }
    }

    for (const [language, texts] of needCityVolume) {
        const existing = new Set(
            db
                .select({ text: keywords.text })
                .from(keywords)
                .innerJoin(keywordMetrics, eq(keywordMetrics.keywordId, keywords.id))
                .where(
                    and(
                        eq(keywords.language, language),
                        eq(keywords.locationCode, city),
                        eq(keywordMetrics.source, 'ads'),
                    ),
                )
                .all()
                .map((row) => keywordKey(row.text)),
        );
        const wanted = [...texts].filter((text) => !existing.has(keywordKey(text)));
        if (wanted.length === 0) continue;
        try {
            log(`city volume: ${language}, ${wanted.length} keywords`);
            const result = await adsSearchVolume(
                client,
                { keywords: wanted, location_code: city, language_code: language },
                { ...callOptions, runId },
            );
            summary.cost += result.cost;
            summary.cachedCalls += result.cachedCalls;
            const byKey = new Map(result.rows.map((row) => [keywordKey(row.keyword), row]));
            const rawId = result.rawIds[0] ?? null;
            for (const text of wanted) {
                const id = upsertKeyword(db, text, language, city, 'expansion', rawId);
                storeAdsRow(db, id, byKey.get(keywordKey(text)), 'ads', rawId, stamp());
                summary.volumesFetched++;
            }
        } catch (error) {
            fail(`city volume for ${language}`, error);
        }
    }

    if (labs) {
        const texts = db
            .select({ id: keywords.id, text: keywords.text })
            .from(keywords)
            .where(
                and(
                    eq(keywords.language, labs.language),
                    eq(keywords.locationCode, labs.countryCode),
                ),
            )
            .all();
        const missing = texts.filter((row) => {
            const metric = db
                .select({ difficulty: keywordMetrics.difficulty })
                .from(keywordMetrics)
                .where(eq(keywordMetrics.keywordId, row.id))
                .all();
            return !metric.some((m) => m.difficulty !== null);
        });
        for (const batch of chunk(missing, 1000)) {
            try {
                log(`difficulty: ${batch.length} keywords`);
                const result = await client.call(
                    labsBulkKeywordDifficultyEndpoint,
                    {
                        keywords: batch.map((row) => row.text),
                        location_code: labs.countryCode,
                        language_code: labs.language,
                    },
                    { ...callOptions, runId },
                );
                track(result);
                const byKey = new Map(
                    (result.rows[0]?.items ?? []).map((item) => [
                        keywordKey(item.keyword),
                        item.keyword_difficulty ?? null,
                    ]),
                );
                for (const row of batch) {
                    const difficulty = byKey.get(keywordKey(row.text));
                    if (difficulty === undefined || difficulty === null) continue;
                    db.insert(keywordMetrics)
                        .values({
                            keywordId: row.id,
                            source: 'labs_kd',
                            volumeStatus: 'missing',
                            difficulty,
                            fetchedAt: stamp(),
                            rawId: result.rawId,
                        })
                        .run();
                    summary.difficulties++;
                }
            } catch (error) {
                fail('difficulty', error);
            }
        }
    }

    for (const language of config.languages) {
        if (!reference.support.intentLanguages.includes(language)) continue;
        const rows = db
            .select({ id: keywords.id, text: keywords.text })
            .from(keywords)
            .where(eq(keywords.language, language))
            .all();
        const missing = rows.filter((row) => {
            const metric = db
                .select({ intent: keywordMetrics.intentEndpoint })
                .from(keywordMetrics)
                .where(eq(keywordMetrics.keywordId, row.id))
                .all();
            return !metric.some((m) => m.intent !== null);
        });
        const unique = new Map<string, { id: number; text: string }[]>();
        for (const row of missing)
            unique.set(keywordKey(row.text), [...(unique.get(keywordKey(row.text)) ?? []), row]);
        for (const batch of chunk([...unique.keys()], 1000)) {
            try {
                log(`intent: ${language}, ${batch.length} keywords`);
                const result = await client.call(
                    labsSearchIntentEndpoint,
                    { keywords: batch, language_code: language },
                    { ...callOptions, runId },
                );
                track(result);
                for (const item of result.rows[0]?.items ?? []) {
                    const label = item.keyword_intent?.label ?? null;
                    if (!label) continue;
                    for (const row of unique.get(keywordKey(item.keyword)) ?? []) {
                        db.insert(keywordMetrics)
                            .values({
                                keywordId: row.id,
                                source: 'labs_intent',
                                volumeStatus: 'missing',
                                intentEndpoint: label,
                                intentProbability: item.keyword_intent?.probability ?? null,
                                fetchedAt: stamp(),
                                rawId: result.rawId,
                            })
                            .run();
                        summary.intents++;
                    }
                }
            } catch (error) {
                fail(`intent for ${language}`, error);
            }
        }
    }

    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
