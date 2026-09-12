import { desc } from 'drizzle-orm';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import {
    candidates,
    domains,
    keywordMetrics,
    keywords,
    serpItems,
    serps,
} from '../../db/schema.js';
import { currentDecisions, type Decision } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';

export interface ScreenMetric {
    volume: number | null;
    volumeStatus: string;
    cpc: number | null;
    bidLow: number | null;
    bidHigh: number | null;
    seriesHash: string | null;
    rawId: number | null;
}

export interface ScreenKeyword {
    id: number;
    text: string;
    language: string;
    locationCode: number;
    candidateId: number | null;
    role: string;
    variantOf: number | null;
    variantKind: string | null;
    metric: ScreenMetric | null;
}

export interface ScreenItem {
    rankAbsolute: number;
    rankGroup: number;
    type: string;
    domain: string | null;
    url: string | null;
    title: string | null;
    payload: Record<string, unknown> | null;
}

export interface ScreenSerp {
    id: number;
    keywordId: number;
    language: string;
    firstOrganicRank: number | null;
    itemTypes: string[];
    rawId: number | null;
    items: ScreenItem[];
}

export interface ScreenCandidate {
    id: number;
    serviceKey: string;
    placeSlug: string;
}

export interface ScreenData {
    config: SiteConfig;
    reference: Reference;
    candidates: ScreenCandidate[];
    keywords: Map<number, ScreenKeyword>;
    serps: ScreenSerp[];
    domains: Map<string, { referringDomains: number | null }>;
    decisions: Record<'candidate' | 'domain' | 'keyword' | 'threshold', Map<string, Decision>>;
}

export function loadScreen(db: Db, config: SiteConfig, reference: Reference): ScreenData {
    const keywordMap = new Map<number, ScreenKeyword>();
    for (const row of db.select().from(keywords).all()) {
        keywordMap.set(row.id, { ...row, metric: null });
    }
    for (const row of db.select().from(keywordMetrics).orderBy(desc(keywordMetrics.id)).all()) {
        const keyword = keywordMap.get(row.keywordId);
        if (keyword && keyword.metric === null && row.source === 'ads') {
            keyword.metric = {
                volume: row.volume,
                volumeStatus: row.volumeStatus,
                cpc: row.cpc,
                bidLow: row.bidLow,
                bidHigh: row.bidHigh,
                seriesHash: row.seriesHash,
                rawId: row.rawId,
            };
        }
    }

    const serpMap = new Map<number, ScreenSerp>();
    for (const row of db.select().from(serps).orderBy(desc(serps.id)).all()) {
        if ([...serpMap.values()].some((serp) => serp.keywordId === row.keywordId)) continue;
        serpMap.set(row.id, {
            id: row.id,
            keywordId: row.keywordId,
            language: row.language,
            firstOrganicRank: row.firstOrganicRank,
            itemTypes: JSON.parse(row.itemTypesJson) as string[],
            rawId: row.rawId,
            items: [],
        });
    }
    for (const row of db.select().from(serpItems).all()) {
        const serp = serpMap.get(row.serpId);
        if (!serp) continue;
        serp.items.push({
            rankAbsolute: row.rankAbsolute,
            rankGroup: row.rankGroup,
            type: row.type,
            domain: row.domain,
            url: row.url,
            title: row.title,
            payload: row.payloadJson
                ? (JSON.parse(row.payloadJson) as Record<string, unknown>)
                : null,
        });
    }
    for (const serp of serpMap.values()) serp.items.sort((a, b) => a.rankAbsolute - b.rankAbsolute);

    const domainMap = new Map<string, { referringDomains: number | null }>();
    for (const row of db.select().from(domains).all()) {
        domainMap.set(row.domain, { referringDomains: row.referringDomains });
    }

    return {
        config,
        reference,
        candidates: db.select().from(candidates).all(),
        keywords: keywordMap,
        serps: [...serpMap.values()],
        domains: domainMap,
        decisions: {
            candidate: currentDecisions(db, 'candidate'),
            domain: currentDecisions(db, 'domain'),
            keyword: currentDecisions(db, 'keyword'),
            threshold: currentDecisions(db, 'threshold'),
        },
    };
}
