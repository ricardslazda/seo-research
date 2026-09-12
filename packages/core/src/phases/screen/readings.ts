import { decisionKey } from '../../decisions.js';
import type { ScreenData, ScreenKeyword, ScreenSerp } from './load.js';
import {
    NON_BUSINESS_KINDS,
    aboveTheFold,
    domainBreadth,
    isPurposeBuilt,
    median,
    packReading,
    placeTokens,
    quantile,
    questionsFrom,
    serviceTokens,
    type DomainKind,
    type PackReading,
    type Probe,
} from './rules.js';

export interface TopItem {
    rank: number;
    domain: string;
    kind: DomainKind;
    kindBy: string | null;
    referringDomains: number | null;
    url: string | null;
    purposeBuilt: boolean;
    servicesRanked: number;
    placesRanked: number;
}

export interface LanguageReading {
    keywordId: number;
    keyword: string;
    volume: number | null;
    volumeStatus: string;
    probe: Probe | null;
    controlVolume: number | null;
    cpc: number | null;
    bidHigh: number | null;
    valueProxy: number | null;
    aggregatedWith: string[];
    bestForm: { text: string; volume: number } | null;
    serpId: number | null;
    firstOrganicRank: number | null;
    above: Record<string, number>;
    pack: PackReading | null;
    directoriesTop10: number;
    rdMedianTop5: number | null;
    rdMedianBusinesses: number | null;
    top10: TopItem[];
    paa: string[];
    related: string[];
    demandEvidence: string[];
}

export interface CandidateReading {
    candidateId: number;
    service: string;
    place: string;
    localFacts: string | null;
    verdict: string | null;
    verdictReason: string | null;
    chosen: boolean;
    flags: string[];
    languages: Record<string, LanguageReading | null>;
}

export interface Distribution {
    measured: number;
    belowFloor: number;
    missing: number;
    formSuspect: number;
    volume: Quartiles | null;
    rdMedianTop5: Quartiles | null;
    rdMedianBusinesses: Quartiles | null;
    packMedianReviews: Quartiles | null;
    bidHigh: Quartiles | null;
}

export interface Quartiles {
    p25: number;
    p50: number;
    p75: number;
    max: number;
}

export interface ScreenBatch {
    languages: string[];
    thresholds: Record<string, Record<string, string>>;
    distribution: Record<string, Distribution>;
    rows: CandidateReading[];
}

function quartiles(values: number[]): Quartiles | null {
    if (values.length === 0) return null;
    return {
        p25: quantile(values, 0.25)!,
        p50: quantile(values, 0.5)!,
        p75: quantile(values, 0.75)!,
        max: Math.max(...values),
    };
}

function domainKind(data: ScreenData, domain: string): { kind: DomainKind; kindBy: string | null } {
    const decision = data.decisions.domain.get(decisionKey(domain, 'kind'));
    return {
        kind: (decision?.value as DomainKind | undefined) ?? 'unknown',
        kindBy: decision?.madeBy ?? null,
    };
}

export function readLanguage(
    data: ScreenData,
    head: ScreenKeyword,
    control: ScreenKeyword | undefined,
    variants: ScreenKeyword[],
    serp: ScreenSerp | undefined,
    tokens: { service: string[]; place: string[] },
    breadth: Map<string, { services: number; places: number; pages: number }>,
): LanguageReading {
    const probeDecision = data.decisions.keyword.get(decisionKey(String(head.id), 'probe'));
    const volume = head.metric?.volume ?? null;
    const bidHigh = head.metric?.bidHigh ?? null;
    const aggregatedWith = head.metric?.seriesHash
        ? variants
              .filter((v) => v.metric?.seriesHash === head.metric?.seriesHash)
              .map((v) => v.text)
        : [];
    const best = variants
        .filter(
            (v) =>
                typeof v.metric?.volume === 'number' &&
                (volume === null || v.metric.volume > volume),
        )
        .sort((a, b) => (b.metric?.volume ?? 0) - (a.metric?.volume ?? 0))[0];

    const reading: LanguageReading = {
        keywordId: head.id,
        keyword: head.text,
        volume,
        volumeStatus: head.metric?.volumeStatus ?? 'missing',
        probe: (probeDecision?.value as Probe | undefined) ?? null,
        controlVolume: control?.metric?.volume ?? null,
        cpc: head.metric?.cpc ?? null,
        bidHigh,
        valueProxy:
            volume !== null && bidHigh !== null ? Math.round(volume * bidHigh * 100) / 100 : null,
        aggregatedWith,
        bestForm: best ? { text: best.text, volume: best.metric!.volume! } : null,
        serpId: serp?.id ?? null,
        firstOrganicRank: serp?.firstOrganicRank ?? null,
        above: serp ? aboveTheFold(serp) : {},
        pack: serp ? packReading(serp.items) : null,
        directoriesTop10: 0,
        rdMedianTop5: null,
        rdMedianBusinesses: null,
        top10: [],
        paa: serp ? questionsFrom(serp, 'people_also_ask') : [],
        related: serp
            ? [
                  ...questionsFrom(serp, 'people_also_search'),
                  ...questionsFrom(serp, 'related_searches'),
              ]
            : [],
        demandEvidence: [],
    };
    if (serp) {
        const organic = serp.items
            .filter((item) => item.type === 'organic' && item.domain)
            .slice(0, 10);
        reading.top10 = organic.map((item) => {
            const { kind, kindBy } = domainKind(data, item.domain!);
            return {
                rank: item.rankAbsolute,
                domain: item.domain!,
                kind,
                kindBy,
                referringDomains: data.domains.get(item.domain!)?.referringDomains ?? null,
                url: item.url,
                purposeBuilt:
                    !NON_BUSINESS_KINDS.includes(kind) && isPurposeBuilt(item.url, tokens),
                servicesRanked: breadth.get(item.domain!)?.services ?? 0,
                placesRanked: breadth.get(item.domain!)?.places ?? 0,
            };
        });
        reading.directoriesTop10 = reading.top10.filter((item) =>
            NON_BUSINESS_KINDS.includes(item.kind),
        ).length;
        reading.rdMedianTop5 = median(
            reading.top10.slice(0, 5).map((item) => item.referringDomains),
        );
        reading.rdMedianBusinesses = median(
            reading.top10
                .filter((item) => !NON_BUSINESS_KINDS.includes(item.kind))
                .map((item) => item.referringDomains),
        );
    }
    if (typeof volume === 'number' && volume > 0) reading.demandEvidence.push('volume');
    if (reading.top10.some((item) => item.purposeBuilt))
        reading.demandEvidence.push('purpose_built');
    if (reading.paa.length > 0) reading.demandEvidence.push('paa');
    if (reading.related.some((term) => tokens.service.some((t) => foldContains(term, t))))
        reading.demandEvidence.push('related');
    if (reading.pack) reading.demandEvidence.push('pack');
    return reading;
}

function foldContains(haystack: string, needle: string): boolean {
    return haystack.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().includes(needle);
}

export function readScreen(data: ScreenData): ScreenBatch {
    const tokens = { service: serviceTokens(data), place: placeTokens(data) };
    const breadth = domainBreadth(data);
    const serpByKeyword = new Map(data.serps.map((serp) => [serp.keywordId, serp]));
    const keywordsByCandidate = new Map<number, ScreenKeyword[]>();
    const controls: ScreenKeyword[] = [];
    for (const keyword of data.keywords.values()) {
        if (keyword.role === 'control') controls.push(keyword);
        if (keyword.candidateId === null) continue;
        keywordsByCandidate.set(keyword.candidateId, [
            ...(keywordsByCandidate.get(keyword.candidateId) ?? []),
            keyword,
        ]);
    }
    const controlFor = (serviceKey: string, language: string, locationCode: number) => {
        const term = data.config.services.find((s) => s.key === serviceKey)?.head[language]?.[
            'term'
        ];
        if (!term) return undefined;
        const folded = term.normalize('NFC').toLowerCase();
        return controls.find(
            (c) => c.language === language && c.locationCode === locationCode && c.text === folded,
        );
    };

    const rows: CandidateReading[] = [];
    for (const candidate of data.candidates) {
        const decisions = data.decisions.candidate;
        const id = String(candidate.id);
        const row: CandidateReading = {
            candidateId: candidate.id,
            service: candidate.serviceKey,
            place: candidate.placeSlug,
            localFacts: decisions.get(decisionKey(id, 'local_facts'))?.value ?? null,
            verdict: decisions.get(decisionKey(id, 'verdict'))?.value ?? null,
            verdictReason: decisions.get(decisionKey(id, 'verdict'))?.reason ?? null,
            chosen: decisions.get(decisionKey(id, 'chosen'))?.value === 'true',
            flags: [],
            languages: {},
        };
        const mine = keywordsByCandidate.get(candidate.id) ?? [];
        for (const language of data.config.languages) {
            const head = mine.find((k) => k.language === language && k.role === 'head');
            if (!head) {
                row.languages[language] = null;
                continue;
            }
            const variants = mine.filter((k) => k.language === language && k.role === 'variant');
            const reading = readLanguage(
                data,
                head,
                controlFor(candidate.serviceKey, language, head.locationCode),
                variants,
                serpByKeyword.get(head.id),
                tokens,
                breadth,
            );
            row.languages[language] = reading;
            if (reading.probe === 'form_suspect') row.flags.push(`probe:form_suspect:${language}`);
            if (reading.bestForm)
                row.flags.push(`better_form:${language}:${reading.bestForm.text}`);
            if (reading.aggregatedWith.length > 0) row.flags.push(`aggregated:${language}`);
            if (reading.serpId === null) row.flags.push(`no_serp:${language}`);
        }
        rows.push(row);
    }

    const distribution: Record<string, Distribution> = {};
    const thresholds: Record<string, Record<string, string>> = {};
    for (const language of data.config.languages) {
        const readings = rows
            .map((row) => row.languages[language])
            .filter((r): r is LanguageReading => r !== null && r !== undefined);
        distribution[language] = {
            measured: readings.filter((r) => r.volumeStatus === 'measured').length,
            belowFloor: readings.filter((r) => r.volumeStatus === 'below_floor').length,
            missing: readings.filter((r) => r.volumeStatus === 'missing').length,
            formSuspect: readings.filter((r) => r.probe === 'form_suspect').length,
            volume: quartiles(readings.map((r) => r.volume).filter((v): v is number => v !== null)),
            rdMedianTop5: quartiles(
                readings.map((r) => r.rdMedianTop5).filter((v): v is number => v !== null),
            ),
            rdMedianBusinesses: quartiles(
                readings.map((r) => r.rdMedianBusinesses).filter((v): v is number => v !== null),
            ),
            packMedianReviews: quartiles(
                readings
                    .map((r) => r.pack?.medianReviews ?? null)
                    .filter((v): v is number => v !== null),
            ),
            bidHigh: quartiles(
                readings.map((r) => r.bidHigh).filter((v): v is number => v !== null),
            ),
        };
        thresholds[language] = {};
        for (const [key, decision] of data.decisions.threshold) {
            if (key.startsWith(`screen:${language}::`))
                thresholds[language]![decision.kind] = decision.value;
        }
    }
    return { languages: data.config.languages, thresholds, distribution, rows };
}
