import { countryIsoFor } from '../../config/market.js';
import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { decisionKey, writeDecision, type MadeBy } from '../../decisions.js';
import { domainsFor, type KnownDomains } from '../../reference/index.js';
import type { ScreenData, ScreenItem, ScreenKeyword, ScreenSerp } from './load.js';

export type DomainKind =
    | 'business'
    | 'directory'
    | 'classifieds'
    | 'jobs'
    | 'social'
    | 'marketplace'
    | 'government'
    | 'directory_suspect'
    | 'unknown';

export const NON_BUSINESS_KINDS: DomainKind[] = [
    'directory',
    'classifieds',
    'jobs',
    'social',
    'marketplace',
    'government',
    'directory_suspect',
];

export type Probe = 'measured' | 'below_floor' | 'form_suspect' | 'missing';

export const DIRECTORY_PATH =
    /(category|categories|catalog|catalogue|directory|companies|company\/|listing)/i;

// A default pattern extended by the site's own alternatives, when it states any.
export function withExtra(base: RegExp, extra?: string): RegExp {
    return extra ? new RegExp(`${base.source}|(?:${extra})`, base.flags) : base;
}

export function directoryPathFor(config: SiteConfig): RegExp {
    return withExtra(DIRECTORY_PATH, config.vocabulary?.directory_paths);
}

export function foldAscii(text: string): string {
    return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

export function median(values: (number | null | undefined)[]): number | null {
    const sorted = values.filter((v): v is number => typeof v === 'number').sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function quantile(values: number[], q: number): number | null {
    const sorted = [...values].sort((a, b) => a - b);
    if (sorted.length === 0) return null;
    const position = (sorted.length - 1) * q;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    const weight = position - lower;
    return sorted[lower]! * (1 - weight) + sorted[upper]! * weight;
}

export function knownKinds(known: KnownDomains): Map<string, DomainKind> {
    const map = new Map<string, DomainKind>();
    for (const kind of [
        'directory',
        'classifieds',
        'jobs',
        'social',
        'marketplace',
        'government',
    ] as const) {
        for (const domain of known[kind] ?? []) map.set(domain.toLowerCase(), kind);
    }
    return map;
}

const CYRILLIC: Record<string, string> = {
    а: 'a',
    б: 'b',
    в: 'v',
    г: 'g',
    д: 'd',
    е: 'e',
    ё: 'e',
    ж: 'zh',
    з: 'z',
    и: 'i',
    й: 'j',
    к: 'k',
    л: 'l',
    м: 'm',
    н: 'n',
    о: 'o',
    п: 'p',
    р: 'r',
    с: 's',
    т: 't',
    у: 'u',
    ф: 'f',
    х: 'h',
    ц: 'c',
    ч: 'ch',
    ш: 'sh',
    щ: 'sch',
    ъ: '',
    ы: 'y',
    ь: '',
    э: 'e',
    ю: 'ju',
    я: 'ja',
};

export function transliterate(text: string): string {
    return [...text.toLowerCase()].map((char) => CYRILLIC[char] ?? char).join('');
}

export function stem(word: string): string {
    return word.slice(0, Math.max(4, word.length - 2));
}

function stemsOf(form: string): string[] {
    const out: string[] = [];
    for (const word of foldAscii(form).split(/\s+/)) {
        if (word.length < 4) continue;
        out.push(stem(word));
        const latin = transliterate(word);
        if (latin !== word) out.push(stem(latin));
    }
    return out;
}

export function knownKind(known: Map<string, DomainKind>, domain: string): DomainKind | undefined {
    const parts = domain.toLowerCase().split('.');
    for (let i = 0; i < parts.length - 1; i++) {
        const kind = known.get(parts.slice(i).join('.'));
        if (kind) return kind;
    }
    return undefined;
}

export function serviceTokens(data: Pick<ScreenData, 'config'>): string[] {
    const tokens = new Set<string>();
    for (const service of data.config.services) {
        for (const forms of Object.values(service.head)) {
            for (const form of Object.values(forms))
                for (const token of stemsOf(form)) tokens.add(token);
        }
    }
    return [...tokens];
}

export function placeTokens(data: Pick<ScreenData, 'config'>): string[] {
    const tokens = new Set<string>();
    for (const place of data.config.places) {
        tokens.add(stem(place.slug));
        for (const forms of Object.values(place.name)) {
            for (const form of Object.values(forms))
                for (const token of stemsOf(form)) tokens.add(token);
        }
    }
    return [...tokens];
}

export interface DomainBreadth {
    services: number;
    places: number;
    pages: number;
}

export function domainBreadth(data: ScreenData): Map<string, DomainBreadth> {
    const services = new Map<string, Set<string>>();
    const places = new Map<string, Set<string>>();
    const pages = new Map<string, number>();
    const candidateById = new Map(data.candidates.map((c) => [c.id, c]));
    for (const serp of data.serps) {
        const keyword = data.keywords.get(serp.keywordId);
        const candidate = keyword?.candidateId ? candidateById.get(keyword.candidateId) : undefined;
        const seen = new Set<string>();
        for (const item of serp.items) {
            if (item.type !== 'organic' || !item.domain || item.rankAbsolute > 20) continue;
            if (candidate) {
                services.set(
                    item.domain,
                    (services.get(item.domain) ?? new Set()).add(candidate.serviceKey),
                );
                places.set(
                    item.domain,
                    (places.get(item.domain) ?? new Set()).add(candidate.placeSlug),
                );
            }
            if (!seen.has(item.domain)) {
                seen.add(item.domain);
                pages.set(item.domain, (pages.get(item.domain) ?? 0) + 1);
            }
        }
    }
    const out = new Map<string, DomainBreadth>();
    for (const domain of pages.keys()) {
        out.set(domain, {
            services: services.get(domain)?.size ?? 0,
            places: places.get(domain)?.size ?? 0,
            pages: pages.get(domain) ?? 0,
        });
    }
    return out;
}

export function classifyDomains(
    data: ScreenData,
): Map<string, { kind: DomainKind; reason: string }> {
    const known = knownKinds(
        domainsFor(data.reference, countryIsoFor(data.config, data.reference)),
    );
    const directoryPath = directoryPathFor(data.config);
    const paths = new Map<string, string[]>();
    for (const serp of data.serps) {
        for (const item of serp.items) {
            if (item.type !== 'organic' || !item.domain || item.rankAbsolute > 20) continue;
            if (item.url) paths.set(item.domain, [...(paths.get(item.domain) ?? []), item.url]);
        }
    }
    const out = new Map<string, { kind: DomainKind; reason: string }>();
    for (const domain of paths.keys()) {
        const listed = knownKind(known, domain);
        if (listed) {
            out.set(domain, { kind: listed, reason: 'listed in reference/domains' });
            continue;
        }
        const path = (paths.get(domain) ?? []).find((url) =>
            directoryPath.test(new URL(url).pathname),
        );
        if (path) {
            out.set(domain, {
                kind: 'directory_suspect',
                reason: `path looks like a listing: ${new URL(path).pathname}`,
            });
            continue;
        }
        out.set(domain, { kind: 'unknown', reason: 'no rule matched' });
    }
    return out;
}

export function probeFor(head: ScreenKeyword, control: ScreenKeyword | undefined): Probe {
    const status = head.metric?.volumeStatus ?? 'missing';
    if (status === 'measured') return 'measured';
    if (status === 'missing') return 'missing';
    const controlStatus = control?.metric?.volumeStatus;
    return controlStatus === 'measured' ? 'below_floor' : 'form_suspect';
}

export interface PackReading {
    rank: number;
    size: number;
    medianReviews: number | null;
}

export function packReading(items: ScreenItem[]): PackReading | null {
    const pack = items.filter((item) => item.type === 'local_pack');
    if (pack.length === 0) return null;
    const votes = pack.map((item) => {
        const rating = item.payload?.['rating'] as { votes_count?: number | null } | undefined;
        return rating?.votes_count ?? null;
    });
    return {
        rank: Math.min(...pack.map((i) => i.rankAbsolute)),
        size: pack.length,
        medianReviews: median(votes),
    };
}

export function aboveTheFold(serp: ScreenSerp): Record<string, number> {
    const above: Record<string, number> = {};
    if (serp.firstOrganicRank === null) return above;
    for (const item of serp.items) {
        if (item.rankAbsolute < serp.firstOrganicRank)
            above[item.type] = (above[item.type] ?? 0) + 1;
    }
    return above;
}

export function questionsFrom(
    serp: ScreenSerp,
    type: 'people_also_ask' | 'people_also_search' | 'related_searches',
): string[] {
    const out: string[] = [];
    for (const item of serp.items) {
        if (item.type !== type) continue;
        const nested = (item.payload?.['items'] as unknown[] | undefined) ?? [];
        for (const entry of nested) {
            if (typeof entry === 'string') out.push(entry);
            else if (
                entry &&
                typeof entry === 'object' &&
                'title' in entry &&
                typeof entry.title === 'string'
            )
                out.push(entry.title);
        }
    }
    return out;
}

export function isPurposeBuilt(
    url: string | null,
    tokens: { service: string[]; place: string[] },
): boolean {
    if (!url) return false;
    let path: string;
    try {
        path = foldAscii(decodeURIComponent(new URL(url).pathname));
    } catch {
        return false;
    }
    if (path === '/' || path === '') return false;
    return (
        tokens.service.some((t) => path.includes(t)) || tokens.place.some((t) => path.includes(t))
    );
}

export interface ApplyResult {
    domainDecisions: number;
    probeDecisions: number;
}

const RULE_OWNED: MadeBy[] = ['rule'];

export function applyScreenRules(db: Db, data: ScreenData, runId: number | null): ApplyResult {
    const result: ApplyResult = { domainDecisions: 0, probeDecisions: 0 };
    for (const [domain, verdict] of classifyDomains(data)) {
        const current = data.decisions.domain.get(decisionKey(domain, 'kind'));
        if (current && !RULE_OWNED.includes(current.madeBy as MadeBy)) continue;
        if (current?.value === verdict.kind) continue;
        writeDecision(db, {
            runId,
            subjectType: 'domain',
            subjectId: domain,
            kind: 'kind',
            value: verdict.kind,
            reason: verdict.reason,
            madeBy: 'rule',
        });
        result.domainDecisions++;
    }
    const byId = data.keywords;
    for (const keyword of byId.values()) {
        if (keyword.role !== 'head') continue;
        const control = [...byId.values()].find(
            (k) =>
                k.role === 'control' &&
                k.language === keyword.language &&
                k.locationCode === keyword.locationCode &&
                serviceOf(data, keyword) === serviceOf(data, k),
        );
        const probe = probeFor(keyword, control);
        const current = data.decisions.keyword.get(decisionKey(String(keyword.id), 'probe'));
        if (current?.value === probe) continue;
        writeDecision(db, {
            runId,
            subjectType: 'keyword',
            subjectId: String(keyword.id),
            kind: 'probe',
            value: probe,
            reason: control
                ? `control "${control.text}" is ${control.metric?.volumeStatus ?? 'missing'}`
                : 'no control keyword',
            madeBy: 'rule',
            evidenceRawId: keyword.metric?.rawId ?? null,
        });
        result.probeDecisions++;
    }
    return result;
}

export function serviceOf(data: ScreenData, keyword: ScreenKeyword): string | null {
    if (keyword.candidateId !== null) {
        return data.candidates.find((c) => c.id === keyword.candidateId)?.serviceKey ?? null;
    }
    for (const service of data.config.services) {
        const term = service.head[keyword.language]?.['term'];
        if (term && foldAscii(term) === foldAscii(keyword.text)) return service.key;
    }
    return null;
}
