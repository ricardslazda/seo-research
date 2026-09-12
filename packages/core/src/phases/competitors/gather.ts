import { and, eq } from 'drizzle-orm';

import {
    adsKeywordsForSiteEndpoint,
    keywordKey,
    labsRankedKeywordsEndpoint,
    labsRelevantPagesEndpoint,
    normalizeKeyword,
    onPageContentParsingEndpoint,
    parsePageContent,
    stripWww,
    type AdsSearchVolumeRow,
    type DfsClient,
    type LabsKeywordData,
} from '@seo/dfs-client';

import { countryIsoFor, marketOf } from '../../config/market.js';
import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import {
    domainKeywords,
    domainPages,
    domains,
    keywordMetrics,
    keywords,
    pageAnatomy,
} from '../../db/schema.js';
import { decisionKey, currentDecisions, writeDecision } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import { seriesHash, volumeStatus, type PlannedCall } from '../screen/gather.js';
import { readAnatomy } from './anatomy.js';
import { selectCompetitors, type CompetitorCandidate, type SelectOptions } from './select.js';

export interface CompetitorsContext extends SelectOptions {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    refresh?: boolean;
    pagesPerDomain?: number;
    siteIdeasCap?: number;
    log?: (line: string) => void;
    now?: () => Date;
}

export interface CompetitorsSummary {
    runId: number;
    competitors: string[];
    labsLanguage: string | null;
    rankedKeywords: number;
    relevantPages: number;
    siteIdeas: number;
    pagesParsed: number;
    failures: string[];
    cost: number;
    cachedCalls: number;
}

export function labsLanguageFor(
    config: SiteConfig,
    reference: Reference,
): { language: string; countryCode: number } | null {
    const iso = countryIsoFor(config, reference);
    const country = Object.values(reference.locations).find(
        (l) => l.type === 'Country' && l.countryIso === iso,
    );
    const supported = reference.support.countries[iso]?.labs ?? [];
    const language = config.languages.find((l) => supported.includes(l));
    if (!country || !language) return null;
    return { language, countryCode: country.code };
}

export function planCompetitors(
    candidates: CompetitorCandidate[],
    config: SiteConfig,
    reference: Reference,
    pagesPerDomain = 3,
): { calls: PlannedCall[]; total: number } {
    const n = candidates.length;
    const labs = labsLanguageFor(config, reference);
    const calls: PlannedCall[] = [];
    if (labs) {
        calls.push({
            endpoint: 'labs.ranked_keywords',
            count: n,
            unitPrice: 0.132,
            cost: n * 0.132,
        });
        calls.push({
            endpoint: 'labs.relevant_pages',
            count: n,
            unitPrice: 0.0223,
            cost: n * 0.0223,
        });
    }
    calls.push({ endpoint: 'ads.keywords_for_site', count: n, unitPrice: 0.09, cost: n * 0.09 });
    const parsed = n * (pagesPerDomain + 1);
    calls.push({
        endpoint: 'onpage.content_parsing',
        count: parsed,
        unitPrice: 0.00015,
        cost: parsed * 0.00015,
    });
    return { calls, total: calls.reduce((sum, c) => sum + c.cost, 0) };
}

function ensureDomain(db: Db, domain: string, now: string): void {
    db.insert(domains).values({ domain, fetchedAt: now }).onConflictDoNothing().run();
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

function storeLabsMetric(
    db: Db,
    keywordId: number,
    data: LabsKeywordData,
    rawId: number,
    now: string,
): void {
    if (hasMetric(db, keywordId, 'labs', rawId)) return;
    const info = data.keyword_info ?? null;
    const monthly = info?.monthly_searches ?? null;
    db.insert(keywordMetrics)
        .values({
            keywordId,
            source: 'labs',
            volume: info?.search_volume ?? null,
            volumeStatus: typeof info?.search_volume === 'number' ? 'measured' : 'below_floor',
            cpc: info?.cpc ?? null,
            competitionIndex:
                typeof info?.competition === 'number' ? Math.round(info.competition * 100) : null,
            bidLow: info?.low_top_of_page_bid ?? null,
            bidHigh: info?.high_top_of_page_bid ?? null,
            monthlyJson: monthly ? JSON.stringify(monthly) : null,
            seriesHash: seriesHash(monthly),
            difficulty: data.keyword_properties?.keyword_difficulty ?? null,
            intentEndpoint: data.search_intent_info?.main_intent ?? null,
            fetchedAt: now,
            rawId,
        })
        .run();
}

function storeAdsMetric(
    db: Db,
    keywordId: number,
    row: AdsSearchVolumeRow,
    source: string,
    rawId: number,
    now: string,
): void {
    if (hasMetric(db, keywordId, source, rawId)) return;
    db.insert(keywordMetrics)
        .values({
            keywordId,
            source,
            volume: row.search_volume,
            volumeStatus: volumeStatus(row),
            cpc: row.cpc,
            competitionIndex: row.competition_index,
            bidLow: row.low_top_of_page_bid,
            bidHigh: row.high_top_of_page_bid,
            monthlyJson: row.monthly_searches ? JSON.stringify(row.monthly_searches) : null,
            seriesHash: seriesHash(row.monthly_searches),
            fetchedAt: now,
            rawId,
        })
        .run();
}

export async function runCompetitors(context: CompetitorsContext): Promise<CompetitorsSummary> {
    const { db, client, config, reference } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const callOptions = { refresh: context.refresh ?? false };
    const pagesPerDomain = context.pagesPerDomain ?? 3;
    const siteIdeasCap = context.siteIdeasCap ?? 500;
    const candidates = selectCompetitors(db, config, reference, context);
    const labs = labsLanguageFor(config, reference);
    const market = marketOf(config, reference);
    const language = config.languages[0]!;
    const firstPlace = config.places[0];
    if (!firstPlace) throw new Error('the site config has no places');

    const runId = startRun(
        db,
        'competitors',
        { domains: candidates.map((c) => c.domain), labs },
        now(),
    );
    const summary: CompetitorsSummary = {
        runId,
        competitors: candidates.map((c) => c.domain),
        labsLanguage: labs?.language ?? null,
        rankedKeywords: 0,
        relevantPages: 0,
        siteIdeas: 0,
        pagesParsed: 0,
        failures: [],
        cost: 0,
        cachedCalls: 0,
    };
    const existing = currentDecisions(db, 'domain');
    const stamp = () => now().toISOString();

    for (const candidate of candidates) {
        const domain = stripWww(candidate.domain);
        ensureDomain(db, domain, stamp());
        if (existing.get(decisionKey(domain, 'competitor'))?.value !== 'true') {
            writeDecision(db, {
                runId,
                subjectType: 'domain',
                subjectId: domain,
                kind: 'competitor',
                value: 'true',
                reason: candidate.explicit
                    ? 'named on the command line'
                    : `appears on ${candidate.pages} result pages of the screen`,
                madeBy: candidate.explicit ? 'human' : 'rule',
            });
        }
        log(`competitor: ${domain}`);
        const pagesToParse = new Set<string>([`https://${domain}/`]);

        if (labs) {
            try {
                const ranked = await client.call(
                    labsRankedKeywordsEndpoint,
                    {
                        target: domain,
                        location_code: labs.countryCode,
                        language_code: labs.language,
                        order_by: ['ranked_serp_element.serp_item.etv,desc'],
                    },
                    { ...callOptions, runId },
                );
                summary.cost += ranked.cost;
                if (ranked.cached) summary.cachedCalls++;
                const result = ranked.rows[0];
                const organic =
                    (result?.metrics?.['organic'] as { etv?: number } | undefined) ?? undefined;
                db.update(domains)
                    .set({
                        labsKeywords: result?.total_count ?? 0,
                        labsEtv: organic?.etv ?? null,
                        labsFetchedAt: stamp(),
                        labsRawId: ranked.rawId,
                    })
                    .where(eq(domains.domain, domain))
                    .run();
                for (const item of result?.items ?? []) {
                    const keywordId = upsertKeyword(
                        db,
                        item.keyword_data.keyword,
                        labs.language,
                        labs.countryCode,
                        'ranked',
                        ranked.rawId,
                    );
                    storeLabsMetric(db, keywordId, item.keyword_data, ranked.rawId, stamp());
                    const serp = item.ranked_serp_element?.serp_item ?? null;
                    db.insert(domainKeywords)
                        .values({
                            domain,
                            keywordId,
                            position: serp?.rank_absolute ?? null,
                            url: serp?.url ?? null,
                            etv: serp?.etv ?? null,
                            rawId: ranked.rawId,
                        })
                        .onConflictDoUpdate({
                            target: [domainKeywords.domain, domainKeywords.keywordId],
                            set: {
                                position: serp?.rank_absolute ?? null,
                                url: serp?.url ?? null,
                                etv: serp?.etv ?? null,
                                rawId: ranked.rawId,
                            },
                        })
                        .run();
                    summary.rankedKeywords++;
                }
            } catch (error) {
                summary.failures.push(
                    `${domain} ranked keywords: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
            try {
                const pages = await client.call(
                    labsRelevantPagesEndpoint,
                    {
                        target: domain,
                        location_code: labs.countryCode,
                        language_code: labs.language,
                    },
                    { ...callOptions, runId },
                );
                summary.cost += pages.cost;
                if (pages.cached) summary.cachedCalls++;
                const items = pages.rows[0]?.items ?? [];
                for (const item of items) {
                    const organic = item.metrics?.organic ?? null;
                    const values = {
                        domain,
                        url: item.page_address,
                        keywordsCount: organic?.count ?? null,
                        etv: organic?.etv ?? null,
                        pos1: organic?.pos_1 ?? null,
                        pos2to3: organic?.pos_2_3 ?? null,
                        pos4to10: organic?.pos_4_10 ?? null,
                        fetchedAt: stamp(),
                        rawId: pages.rawId,
                    };
                    db.insert(domainPages)
                        .values(values)
                        .onConflictDoUpdate({
                            target: [domainPages.domain, domainPages.url],
                            set: values,
                        })
                        .run();
                    summary.relevantPages++;
                }
                for (const item of [...items]
                    .sort((a, b) => (b.metrics?.organic?.etv ?? 0) - (a.metrics?.organic?.etv ?? 0))
                    .slice(0, pagesPerDomain)) {
                    pagesToParse.add(item.page_address);
                }
            } catch (error) {
                summary.failures.push(
                    `${domain} relevant pages: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }

        try {
            const ideas = await client.call(
                adsKeywordsForSiteEndpoint,
                {
                    target: domain,
                    location_code: firstPlace.location_code,
                    language_code: language,
                },
                { ...callOptions, runId },
            );
            summary.cost += ideas.cost;
            if (ideas.cached) summary.cachedCalls++;
            const ranked = [...ideas.rows]
                .sort((a, b) => (b.search_volume ?? -1) - (a.search_volume ?? -1))
                .slice(0, siteIdeasCap);
            const seen = new Set<string>();
            for (const row of ranked) {
                const key = keywordKey(row.keyword);
                if (seen.has(key)) continue;
                seen.add(key);
                const keywordId = upsertKeyword(
                    db,
                    row.keyword,
                    language,
                    firstPlace.location_code,
                    'site_idea',
                    ideas.rawId,
                );
                storeAdsMetric(db, keywordId, row, 'ads_site', ideas.rawId, stamp());
                db.insert(domainKeywords)
                    .values({
                        domain,
                        keywordId,
                        position: null,
                        url: null,
                        etv: null,
                        rawId: ideas.rawId,
                    })
                    .onConflictDoNothing()
                    .run();
                summary.siteIdeas++;
            }
        } catch (error) {
            summary.failures.push(
                `${domain} site keywords: ${error instanceof Error ? error.message : String(error)}`,
            );
        }

        for (const url of pagesToParse) {
            try {
                const parsed = await client.call(
                    onPageContentParsingEndpoint,
                    { url },
                    { ...callOptions, runId },
                );
                summary.cost += parsed.cost;
                if (parsed.cached) summary.cachedCalls++;
                const item = parsed.rows[0]?.items?.[0];
                const page = parsePageContent(
                    item?.page_content ?? null,
                    item?.page_as_markdown ?? null,
                );
                const anatomy = readAnatomy(page, domain, market);
                const values = {
                    domain,
                    url,
                    httpStatus: item?.status_code ?? null,
                    title: anatomy.title,
                    wordCount: anatomy.wordCount,
                    headingsCount: anatomy.headingsCount,
                    questionsCount: anatomy.questionsCount,
                    phoneCount: anatomy.phoneCount,
                    hasPrices: anatomy.hasPrices,
                    ratingValue: anatomy.ratingValue,
                    ratingCount: anatomy.ratingCount,
                    navLinksJson: JSON.stringify(anatomy.navLinks),
                    bodyLinksJson: JSON.stringify(anatomy.bodyLinks),
                    headingsJson: JSON.stringify(anatomy.headings),
                    fetchedAt: stamp(),
                    rawId: parsed.rawId,
                };
                db.insert(pageAnatomy)
                    .values(values)
                    .onConflictDoUpdate({ target: pageAnatomy.url, set: values })
                    .run();
                summary.pagesParsed++;
            } catch (error) {
                summary.failures.push(
                    `${domain} parse ${url}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }

    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
