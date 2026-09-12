import { desc } from 'drizzle-orm';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywordMetrics, serpItems, serps } from '../../db/schema.js';
import { currentDecisions, decisionKey } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { guessPageType, tokensFor, type PageType } from '../competitors/readings.js';
import { readKeywords, type KeywordReading } from '../keywords/readings.js';
import { foldedLatin } from '../keywords/rules.js';
import {
    NON_BUSINESS_KINDS,
    isPurposeBuilt,
    questionsFrom,
    stem,
    type DomainKind,
} from '../screen/rules.js';
import type { ScreenItem, ScreenSerp } from '../screen/load.js';
import { researchedLanguages, shortlistedKeywords } from './gather.js';

export interface OverlapPair {
    language: string;
    a: number;
    b: number;
    aText: string;
    bText: string;
    sharedUrls: number;
    sharedDomains: number;
    sharedPack: number;
    packDiffers: boolean;
    purposeBuiltNarrow: string | null;
    samePage: boolean;
}

export interface ClusterReading {
    id: number;
    language: string;
    primaryKeywordId: number;
    primaryKeyword: string;
    members: {
        keywordId: number;
        text: string;
        volumeCity: number | null;
        volumeCountry: number | null;
        role: 'primary' | 'member';
    }[];
    volumeSum: number;
    intentEndpoint: string | null;
    intentSerp: string;
    intentFinal: string;
    pageType: PageType;
    service: string | null;
    firstOrganicRank: number | null;
    packPresent: boolean;
    topDomains: { domain: string; kind: DomainKind; purposeBuilt: boolean }[];
    questions: string[];
    serpId: number | null;
}

export interface ClustersBatch {
    languages: string[];
    degenerate: Record<
        string,
        { pairs: number; samePage: number; share: number; flagged: boolean }
    >;
    clusters: ClusterReading[];
    pairs: OverlapPair[];
}

const GUIDE_MODIFIERS = new Set(['price', 'question', 'comparison']);

function normalizeUrl(url: string | null): string | null {
    if (!url) return null;
    try {
        const parsed = new URL(url);
        return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/$/, '')}`.toLowerCase();
    } catch {
        return null;
    }
}

function packTitles(items: ScreenItem[]): string[] {
    return items
        .filter((item) => item.type === 'local_pack')
        .map((item) => (item.title ?? '').toLowerCase())
        .filter(Boolean);
}

export function serpIntent(
    serp: ScreenSerp | null,
    kinds: Map<string, DomainKind>,
    tokens: ReturnType<typeof tokensFor>,
): string {
    if (!serp) return 'unknown';
    const organic = serp.items.filter((item) => item.type === 'organic').slice(0, 10);
    const first = organic[0];
    const pack = serp.items.some((item) => item.type === 'local_pack');
    const paa = questionsFrom(serp, 'people_also_ask').length;
    const firstIsBusinessPage = first?.domain
        ? !NON_BUSINESS_KINDS.includes(kinds.get(first.domain) ?? 'unknown') &&
          isPurposeBuilt(first.url, tokens)
        : false;
    const guides = organic.filter(
        (item) => item.url && guessPageType(item.url, tokens) === 'guide',
    ).length;
    if (pack || firstIsBusinessPage) return 'commercial';
    if (guides >= 3 || (paa >= 2 && !firstIsBusinessPage)) return 'informational';
    return 'commercial';
}

// An informational reading that carries one of the trade's own modifiers, a material or a
// situation, answers a question about it: a guide rather than the service page.
function pageTypeFor(
    primary: KeywordReading,
    intent: string,
    configuredModifiers: Set<string>,
): PageType {
    if (primary.modifiers.some((m) => GUIDE_MODIFIERS.has(m))) return 'guide';
    if (intent === 'informational' && primary.primaryService === null) return 'guide';
    if (primary.modifiers.includes('place'))
        return primary.primaryService ? 'intersection' : 'place';
    if (intent === 'informational' && primary.modifiers.some((m) => configuredModifiers.has(m)))
        return 'guide';
    return primary.primaryService ? 'service' : 'other';
}

export function readClusters(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    options: { threshold?: number; languages?: string[] } = {},
): ClustersBatch {
    const threshold = options.threshold ?? 3;
    const languages = options.languages ?? researchedLanguages(db, config);
    const shortlisted = shortlistedKeywords(db, languages);
    const readings = new Map(readKeywords(db, config).rows.map((r) => [r.keywordId, r]));
    const city = config.places[0]?.location_code ?? 0;
    const tokens = tokensFor(config);
    const configuredModifiers = new Set(Object.keys(config.vocabulary?.modifiers ?? {}));
    const kinds = new Map<string, DomainKind>();
    const domainKinds = kinds;
    for (const [key, decision] of currentDecisions(db, 'domain')) {
        if (decision.kind === 'kind')
            domainKinds.set(key.split('::')[0]!, decision.value as DomainKind);
    }
    const keywordDecisions = currentDecisions(db, 'keyword');

    const serpRows = db.select().from(serps).orderBy(desc(serps.id)).all();
    const itemRows = db.select().from(serpItems).all();
    const serpFor = new Map<number, ScreenSerp>();
    for (const row of serpRows) {
        if (row.locationCode !== city || serpFor.has(row.keywordId)) continue;
        serpFor.set(row.keywordId, {
            id: row.id,
            keywordId: row.keywordId,
            language: row.language,
            firstOrganicRank: row.firstOrganicRank,
            itemTypes: JSON.parse(row.itemTypesJson) as string[],
            rawId: row.rawId,
            items: [],
        });
    }
    const bySerp = new Map<number, ScreenSerp>();
    for (const serp of serpFor.values()) bySerp.set(serp.id, serp);
    for (const item of itemRows) {
        const serp = bySerp.get(item.serpId);
        if (!serp) continue;
        serp.items.push({
            rankAbsolute: item.rankAbsolute,
            rankGroup: item.rankGroup,
            type: item.type,
            domain: item.domain,
            url: item.url,
            title: item.title,
            payload: item.payloadJson
                ? (JSON.parse(item.payloadJson) as Record<string, unknown>)
                : null,
        });
    }
    for (const serp of serpFor.values()) serp.items.sort((a, b) => a.rankAbsolute - b.rankAbsolute);

    const metricsVolume = new Map<number, number | null>();
    for (const metric of db.select().from(keywordMetrics).orderBy(desc(keywordMetrics.id)).all()) {
        if (!metricsVolume.has(metric.keywordId) && metric.volume !== null)
            metricsVolume.set(metric.keywordId, metric.volume);
    }

    const topOf = (keywordId: number) => {
        const serp = serpFor.get(keywordId);
        const organic = (serp?.items ?? []).filter((item) => item.type === 'organic').slice(0, 10);
        return {
            urls: new Set(
                organic
                    .map((item) => normalizeUrl(item.url))
                    .filter((u): u is string => u !== null),
            ),
            domains: new Set(
                organic.map((item) => item.domain).filter((d): d is string => d !== null),
            ),
            pack: new Set(packTitles(serp?.items ?? [])),
            organic,
        };
    };

    const clusterOverride = (id: number): string | undefined =>
        keywordDecisions.get(decisionKey(String(id), 'cluster'))?.value;
    const ownIds = new Set(
        shortlisted.filter((k) => clusterOverride(k.id) === 'own').map((k) => k.id),
    );
    const movedIds = new Set(
        shortlisted.filter((k) => /^\d+$/.test(clusterOverride(k.id) ?? '')).map((k) => k.id),
    );
    const pinned = (id: number): boolean => ownIds.has(id) || movedIds.has(id);
    const pairs: OverlapPair[] = [];
    const parent = new Map<number, number>();
    const find = (id: number): number => {
        const p = parent.get(id) ?? id;
        if (p === id) return id;
        const root = find(p);
        parent.set(id, root);
        return root;
    };
    const union = (a: number, b: number): void => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };

    for (const language of languages) {
        const own = shortlisted.filter((k) => k.language === language);
        for (let i = 0; i < own.length; i++) {
            for (let j = i + 1; j < own.length; j++) {
                const a = own[i]!;
                const b = own[j]!;
                const ta = topOf(a.id);
                const tb = topOf(b.id);
                if (ta.urls.size === 0 || tb.urls.size === 0) continue;
                const sharedUrls = [...ta.urls].filter((u) => tb.urls.has(u)).length;
                const sharedDomains = [...ta.domains].filter((d) => tb.domains.has(d)).length;
                const sharedPack = [...ta.pack].filter((t) => tb.pack.has(t)).length;
                const packDiffers = ta.pack.size > 0 && tb.pack.size > 0 && sharedPack === 0;
                const distinguishing = (narrowText: string, broadText: string): string[] => {
                    const broad = new Set(foldedLatin(broadText).split(/\s+/));
                    return foldedLatin(narrowText)
                        .split(/\s+/)
                        .filter((word) => word.length >= 4 && !broad.has(word))
                        .map((word) => stem(word));
                };
                const narrow = (
                    from: typeof ta,
                    other: typeof tb,
                    stems: string[],
                ): string | null => {
                    if (stems.length === 0) return null;
                    const hit = from.organic.find((item) => {
                        if (!item.url || other.urls.has(normalizeUrl(item.url) ?? '')) return false;
                        const kind = kinds.get(item.domain ?? '') ?? 'unknown';
                        if (NON_BUSINESS_KINDS.includes(kind)) return false;
                        return isPurposeBuilt(item.url, { service: stems, place: [] });
                    });
                    return hit?.url ?? null;
                };
                const [narrowKw, broadKw, narrowTop, broadTop] =
                    a.text.length >= b.text.length ? [a, b, ta, tb] : [b, a, tb, ta];
                const purposeBuiltNarrow = narrow(
                    narrowTop,
                    broadTop,
                    distinguishing(narrowKw.text, broadKw.text),
                );
                const samePage =
                    sharedUrls >= threshold && !packDiffers && purposeBuiltNarrow === null;
                pairs.push({
                    language,
                    a: a.id,
                    b: b.id,
                    aText: a.text,
                    bText: b.text,
                    sharedUrls,
                    sharedDomains,
                    sharedPack,
                    packDiffers,
                    purposeBuiltNarrow,
                    samePage,
                });
                if (samePage && !pinned(a.id) && !pinned(b.id)) union(a.id, b.id);
            }
        }
    }
    const rootOf = (id: number, depth = 0): number => {
        if (depth > 20) return id;
        const override = clusterOverride(id);
        if (override === 'own') return id;
        if (override && /^\d+$/.test(override)) return rootOf(Number(override), depth + 1);
        return find(id);
    };

    const groups = new Map<number, typeof shortlisted>();
    for (const keyword of shortlisted) {
        const root = rootOf(keyword.id);
        groups.set(root, [...(groups.get(root) ?? []), keyword]);
    }

    const volumeOf = (id: number): number | null =>
        readings.get(id)?.volumeCity ??
        readings.get(id)?.volumeCountry ??
        metricsVolume.get(id) ??
        null;
    const clusters: ClusterReading[] = [];
    for (const members of groups.values()) {
        const sorted = [...members].sort(
            (a, b) =>
                (volumeOf(b.id) ?? -1) - (volumeOf(a.id) ?? -1) || a.text.length - b.text.length,
        );
        const primary = sorted[0]!;
        const reading = readings.get(primary.id);
        const serp = serpFor.get(primary.id) ?? null;
        const intentSerp = serpIntent(serp, domainKinds, tokens);
        const intentEndpoint = reading?.intent ?? null;
        const intentOverride = keywordDecisions.get(
            decisionKey(String(primary.id), 'intent'),
        )?.value;
        const intentFinal = intentOverride ?? (serp ? intentSerp : (intentEndpoint ?? 'unknown'));
        const pageTypeOverride = keywordDecisions.get(decisionKey(String(primary.id), 'page_type'))
            ?.value as PageType | undefined;
        const organic = (serp?.items ?? []).filter((item) => item.type === 'organic').slice(0, 10);
        clusters.push({
            id: primary.id,
            language: primary.language,
            primaryKeywordId: primary.id,
            primaryKeyword: primary.text,
            members: sorted.map((m) => ({
                keywordId: m.id,
                text: m.text,
                volumeCity: readings.get(m.id)?.volumeCity ?? null,
                volumeCountry: readings.get(m.id)?.volumeCountry ?? null,
                role: m.id === primary.id ? 'primary' : 'member',
            })),
            volumeSum: sorted.reduce((sum, m) => sum + (volumeOf(m.id) ?? 0), 0),
            intentEndpoint,
            intentSerp,
            intentFinal,
            pageType:
                pageTypeOverride ??
                (reading ? pageTypeFor(reading, intentFinal, configuredModifiers) : 'other'),
            service: reading?.primaryService ?? null,
            firstOrganicRank: serp?.firstOrganicRank ?? null,
            packPresent: (serp?.items ?? []).some((item) => item.type === 'local_pack'),
            topDomains: organic.map((item) => ({
                domain: item.domain ?? '',
                kind: domainKinds.get(item.domain ?? '') ?? 'unknown',
                purposeBuilt: isPurposeBuilt(item.url, tokens),
            })),
            questions: serp ? questionsFrom(serp, 'people_also_ask') : [],
            serpId: serp?.id ?? null,
        });
    }
    clusters.sort(
        (a, b) =>
            a.language.localeCompare(b.language) ||
            b.volumeSum - a.volumeSum ||
            a.primaryKeyword.localeCompare(b.primaryKeyword),
    );

    const degenerate: ClustersBatch['degenerate'] = {};
    for (const language of languages) {
        const own = pairs.filter((p) => p.language === language);
        const same = own.filter((p) => p.sharedUrls >= threshold).length;
        const share = own.length > 0 ? same / own.length : 0;
        degenerate[language] = {
            pairs: own.length,
            samePage: same,
            share,
            flagged: own.length > 0 && share > 0.6,
        };
    }
    return { languages, degenerate, clusters, pairs };
}
