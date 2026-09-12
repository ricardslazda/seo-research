import { desc } from 'drizzle-orm';

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
import { currentDecisions, decisionKey, type Decision } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { loadScreen } from '../screen/load.js';
import { readScreen } from '../screen/readings.js';
import {
    NON_BUSINESS_KINDS,
    domainBreadth,
    foldAscii,
    placeTokens,
    serviceTokens,
    withExtra,
    type DomainKind,
} from '../screen/rules.js';

export type PageType = 'home' | 'service' | 'place' | 'intersection' | 'guide' | 'other';

const GUIDE_PATH = /(blog|news|guide|guides|faq|price|prices|cost|how-|why-|what-|tips|articles?)/i;

// What a URL path is read against: the service and place stems, the root or a language root of
// the site's languages as home, and the guide words the config adds to the English defaults.
export interface Tokens {
    service: string[];
    place: string[];
    home: RegExp;
    guide: RegExp;
}

export function tokensFor(config: SiteConfig): Tokens {
    return {
        service: serviceTokens({ config }),
        place: placeTokens({ config }),
        home: new RegExp(`^/(?:(?:${config.languages.join('|')})/?)?$`),
        guide: withExtra(GUIDE_PATH, config.vocabulary?.guide_paths),
    };
}

export function guessPageType(url: string, tokens: Tokens): PageType {
    let path: string;
    try {
        path = foldAscii(decodeURIComponent(new URL(url).pathname));
    } catch {
        return 'other';
    }
    if (tokens.home.test(path)) return 'home';
    const service = tokens.service.some((t) => path.includes(t));
    const place = tokens.place.some((t) => path.includes(t));
    if (tokens.guide.test(path) && !place) return 'guide';
    if (service && place) return 'intersection';
    if (place) return 'place';
    if (service) return 'service';
    return 'other';
}

export interface CompetitorRow {
    domain: string;
    kind: DomainKind;
    kindBy: string | null;
    competitor: boolean;
    strongest: boolean;
    pages: number;
    services: number;
    places: number;
    referringDomains: number | null;
    labsKeywords: number | null;
    labsEtv: number | null;
    earningPages: number;
    siteIdeas: number;
    topPageUrl: string | null;
    topPageType: PageType | null;
    topPageValuePerKeyword: number | null;
    homeWords: number | null;
    homeHeadings: number | null;
    homeQuestions: number | null;
    homePhones: number | null;
    homePrices: boolean | null;
    homeRating: number | null;
    homeRatingCount: number | null;
    menuItems: number | null;
}

export interface EarningPage {
    domain: string;
    url: string;
    pageType: PageType;
    keywordsCount: number | null;
    etv: number | null;
    valuePerKeyword: number | null;
    parsed: boolean;
    wordCount: number | null;
    questionsCount: number | null;
    hasPrices: boolean | null;
}

export interface SeedKeyword {
    keywordId: number;
    text: string;
    language: string;
    source: string;
    volume: number | null;
    volumeStatus: string;
    cpc: number | null;
    bidHigh: number | null;
    difficulty: number | null;
    intent: string | null;
    domains: number;
    bestPosition: number | null;
}

export interface MenuItem {
    domain: string;
    text: string;
    url: string;
    pageType: PageType;
}

export interface CoverageCell {
    service: string;
    place: string;
    language: string;
    competitorsWithPage: string[];
    servicePagesAnywhere: number;
    packPresent: boolean;
    firstOrganicRank: number | null;
    gap: boolean;
}

function placeStems(config: SiteConfig, slug: string): string[] {
    const place = config.places.find((p) => p.slug === slug);
    if (!place) return [];
    return placeTokens({ config: { ...config, places: [place] } });
}

function pathOf(url: string | null): string | null {
    if (!url) return null;
    try {
        return foldAscii(decodeURIComponent(new URL(url).pathname));
    } catch {
        return null;
    }
}

export interface CompetitorsData {
    rows: CompetitorRow[];
    pages: EarningPage[];
    seeds: SeedKeyword[];
    menus: MenuItem[];
    coverage: CoverageCell[];
    labsLanguage: string | null;
}

export function readCompetitors(db: Db, config: SiteConfig, reference: Reference): CompetitorsData {
    const tokens = tokensFor(config);
    const decisions: Map<string, Decision> = currentDecisions(db, 'domain');
    const screen = loadScreen(db, config, reference);
    const breadth = domainBreadth(screen);
    const competitorDomains = [...decisions.values()]
        .filter((d) => d.kind === 'competitor' && d.value === 'true')
        .map((d) => d.subjectId);

    const domainRows = new Map(
        db
            .select()
            .from(domains)
            .all()
            .map((row) => [row.domain, row]),
    );
    const pageRows = db.select().from(domainPages).all();
    const anatomyRows = db.select().from(pageAnatomy).all();
    const anatomyByUrl = new Map(anatomyRows.map((row) => [row.url.replace(/\/$/, ''), row]));
    const linkRows = db.select().from(domainKeywords).all();
    const keywordRows = new Map(
        db
            .select()
            .from(keywords)
            .all()
            .map((row) => [row.id, row]),
    );
    const metricRows = db.select().from(keywordMetrics).orderBy(desc(keywordMetrics.id)).all();
    const latestMetric = new Map<string, (typeof metricRows)[number]>();
    for (const metric of metricRows) {
        const key = `${metric.keywordId}|${metric.source}`;
        if (!latestMetric.has(key)) latestMetric.set(key, metric);
    }

    const pages: EarningPage[] = pageRows
        .filter((row) => competitorDomains.includes(row.domain))
        .map((row) => {
            const anatomy = anatomyByUrl.get(row.url.replace(/\/$/, ''));
            const valuePerKeyword =
                row.etv !== null && row.keywordsCount
                    ? Math.round((row.etv / row.keywordsCount) * 1000) / 1000
                    : null;
            return {
                domain: row.domain,
                url: row.url,
                pageType: guessPageType(row.url, tokens),
                keywordsCount: row.keywordsCount,
                etv: row.etv,
                valuePerKeyword,
                parsed: anatomy !== undefined,
                wordCount: anatomy?.wordCount ?? null,
                questionsCount: anatomy?.questionsCount ?? null,
                hasPrices: anatomy?.hasPrices ?? null,
            };
        })
        .sort(
            (a, b) =>
                (b.valuePerKeyword ?? -1) - (a.valuePerKeyword ?? -1) ||
                (b.etv ?? 0) - (a.etv ?? 0),
        );

    const menus: MenuItem[] = [];
    for (const row of anatomyRows) {
        if (!competitorDomains.includes(row.domain)) continue;
        if (guessPageType(row.url, tokens) !== 'home') continue;
        const links = JSON.parse(row.navLinksJson ?? '[]') as { text: string; url: string }[];
        const seen = new Set<string>();
        for (const link of links) {
            const key = `${link.url.replace(/\/$/, '')}|${link.text.toLowerCase()}`;
            if (seen.has(key) || seen.has(link.text.toLowerCase()) || !link.text) continue;
            seen.add(key);
            seen.add(link.text.toLowerCase());
            menus.push({
                domain: row.domain,
                text: link.text,
                url: link.url,
                pageType: guessPageType(link.url, tokens),
            });
        }
    }

    const rows: CompetitorRow[] = competitorDomains.map((domain) => {
        const row = domainRows.get(domain);
        const kindDecision = decisions.get(decisionKey(domain, 'kind'));
        const b = breadth.get(domain);
        const own = pages.filter((page) => page.domain === domain);
        const top = own[0] ?? null;
        const home = anatomyRows.find(
            (a) => a.domain === domain && guessPageType(a.url, tokens) === 'home',
        );
        return {
            domain,
            kind: (kindDecision?.value as DomainKind | undefined) ?? 'unknown',
            kindBy: kindDecision?.madeBy ?? null,
            competitor: true,
            strongest: decisions.get(decisionKey(domain, 'strongest'))?.value === 'true',
            pages: b?.pages ?? 0,
            services: b?.services ?? 0,
            places: b?.places ?? 0,
            referringDomains: row?.referringDomains ?? null,
            labsKeywords: row?.labsKeywords ?? null,
            labsEtv: row?.labsEtv ?? null,
            earningPages: own.length,
            siteIdeas: linkRows.filter(
                (l) => l.domain === domain && keywordRows.get(l.keywordId)?.role === 'site_idea',
            ).length,
            topPageUrl: top?.url ?? null,
            topPageType: top?.pageType ?? null,
            topPageValuePerKeyword: top?.valuePerKeyword ?? null,
            homeWords: home?.wordCount ?? null,
            homeHeadings: home?.headingsCount ?? null,
            homeQuestions: home?.questionsCount ?? null,
            homePhones: home?.phoneCount ?? null,
            homePrices: home?.hasPrices ?? null,
            homeRating: home?.ratingValue ?? null,
            homeRatingCount: home?.ratingCount ?? null,
            menuItems: home ? menus.filter((m) => m.domain === domain).length : null,
        };
    });

    const byKeyword = new Map<number, { domains: Set<string>; best: number | null }>();
    for (const link of linkRows) {
        if (!competitorDomains.includes(link.domain)) continue;
        const entry = byKeyword.get(link.keywordId) ?? { domains: new Set<string>(), best: null };
        entry.domains.add(link.domain);
        if (link.position !== null && (entry.best === null || link.position < entry.best))
            entry.best = link.position;
        byKeyword.set(link.keywordId, entry);
    }
    const seeds: SeedKeyword[] = [];
    for (const [keywordId, entry] of byKeyword) {
        const keyword = keywordRows.get(keywordId);
        if (!keyword) continue;
        const source = keyword.role === 'ranked' ? 'labs' : 'ads_site';
        const metric =
            latestMetric.get(`${keywordId}|${source}`) ??
            latestMetric.get(`${keywordId}|ads`) ??
            null;
        seeds.push({
            keywordId,
            text: keyword.text,
            language: keyword.language,
            source: keyword.role,
            volume: metric?.volume ?? null,
            volumeStatus: metric?.volumeStatus ?? 'missing',
            cpc: metric?.cpc ?? null,
            bidHigh: metric?.bidHigh ?? null,
            difficulty: metric?.difficulty ?? null,
            intent: metric?.intentEndpoint ?? null,
            domains: entry.domains.size,
            bestPosition: entry.best,
        });
    }
    seeds.sort(
        (a, b) =>
            (b.volume ?? -1) - (a.volume ?? -1) ||
            b.domains - a.domains ||
            a.text.localeCompare(b.text),
    );

    const batch = readScreen(screen);
    const coverage: CoverageCell[] = [];
    for (const row of batch.rows) {
        const stems = placeStems(config, row.place);
        for (const [language, reading] of Object.entries(row.languages)) {
            if (!reading) continue;
            const businessItems = reading.top10.filter(
                (item) => !NON_BUSINESS_KINDS.includes(item.kind),
            );
            const withPage = businessItems
                .filter((item) => {
                    const path = pathOf(item.url);
                    return (
                        path !== null &&
                        item.purposeBuilt &&
                        stems.some((stem) => path.includes(stem))
                    );
                })
                .map((item) => item.domain);
            coverage.push({
                service: row.service,
                place: row.place,
                language,
                competitorsWithPage: [...new Set(withPage)],
                servicePagesAnywhere: new Set(
                    businessItems.filter((item) => item.purposeBuilt).map((item) => item.domain),
                ).size,
                packPresent: reading.pack !== null,
                firstOrganicRank: reading.firstOrganicRank,
                gap: withPage.length === 0,
            });
        }
    }

    return { rows, pages, seeds, menus, coverage, labsLanguage: null };
}
