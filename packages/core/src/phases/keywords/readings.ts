import { desc } from 'drizzle-orm';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywordMetrics, keywordOrigins, keywords } from '../../db/schema.js';
import { currentDecisions, decisionKey, type Decision } from '../../decisions.js';
import {
    attributeServices,
    exclusionFor,
    formKey,
    modifiersFor,
    placeStemsFor,
    serviceFormsByKey,
    vocabularyOf,
    type ExclusionReason,
    type Modifier,
} from './rules.js';

export interface KeywordReading {
    keywordId: number;
    text: string;
    language: string;
    locationCode: number;
    role: string;
    volumeCity: number | null;
    volumeCityStatus: string;
    volumeCountry: number | null;
    cpc: number | null;
    bidHigh: number | null;
    difficulty: number | null;
    intent: string | null;
    intentProbability: number | null;
    sources: string[];
    seeds: string[];
    services: string[];
    primaryService: string | null;
    modifiers: Modifier[];
    formKey: string;
    formPrimary: boolean;
    formMembers: number;
    aggregatedWith: string[];
    excluded: ExclusionReason | string | null;
    excludedBy: string | null;
    shortlisted: boolean;
}

export interface KeywordsBatch {
    languages: string[];
    thresholds: Record<string, Record<string, string>>;
    counts: Record<
        string,
        {
            total: number;
            measuredCity: number;
            excluded: Record<string, number>;
            forms: number;
            bySource: Record<string, number>;
        }
    >;
    rows: KeywordReading[];
}

const CITY_SOURCES = ['ads', 'ads_idea', 'ads_site'];
const COUNTRY_SOURCES = ['labs_suggest', 'labs_idea', 'labs'];

export function readKeywords(db: Db, config: SiteConfig): KeywordsBatch {
    const formsByKey = serviceFormsByKey(config);
    const placeStems = placeStemsFor(config);
    const vocabulary = vocabularyOf(config);
    const decisions: Map<string, Decision> = currentDecisions(db, 'keyword');
    const thresholdDecisions = currentDecisions(db, 'threshold');

    const SCREEN_ROLES = new Set(['head', 'variant', 'control']);
    const EXPANSION_SOURCES = new Set([
        'ads_idea',
        'labs_suggest',
        'labs_idea',
        'ads_site',
        'labs',
        'labs_kd',
        'labs_intent',
    ]);
    const expanded = new Set(
        db
            .select({ keywordId: keywordMetrics.keywordId, source: keywordMetrics.source })
            .from(keywordMetrics)
            .all()
            .filter((m) => EXPANSION_SOURCES.has(m.source))
            .map((m) => m.keywordId),
    );
    const shortlistedIds = new Set(
        [...decisions.values()]
            .filter((d) => d.kind === 'shortlist' && d.value === 'true')
            .map((d) => Number(d.subjectId)),
    );
    const rows = db
        .select()
        .from(keywords)
        .all()
        .filter(
            (row) =>
                !SCREEN_ROLES.has(row.role) || expanded.has(row.id) || shortlistedIds.has(row.id),
        );
    const metricsByKeyword = new Map<number, (typeof keywordMetrics.$inferSelect)[]>();
    for (const metric of db.select().from(keywordMetrics).orderBy(desc(keywordMetrics.id)).all()) {
        metricsByKeyword.set(metric.keywordId, [
            ...(metricsByKeyword.get(metric.keywordId) ?? []),
            metric,
        ]);
    }
    const originsByKeyword = new Map<number, (typeof keywordOrigins.$inferSelect)[]>();
    for (const origin of db.select().from(keywordOrigins).all()) {
        originsByKeyword.set(origin.keywordId, [
            ...(originsByKeyword.get(origin.keywordId) ?? []),
            origin,
        ]);
    }

    const readings: KeywordReading[] = rows.map((row) => {
        const metrics = metricsByKeyword.get(row.id) ?? [];
        const city = metrics.find(
            (m) => CITY_SOURCES.includes(m.source) && m.volumeStatus !== 'missing',
        );
        const country = metrics.find((m) => COUNTRY_SOURCES.includes(m.source));
        const withIntent = metrics.find((m) => m.intentEndpoint !== null);
        const withDifficulty = metrics.find((m) => m.difficulty !== null);
        const priced = city ?? country ?? null;
        const attribution = attributeServices(row.text, formsByKey, vocabulary.nonDistinctive);
        const ruleExclusion = exclusionFor(row.text, placeStems, vocabulary, attribution.fullMatch);
        const decision = decisions.get(decisionKey(String(row.id), 'exclude'));
        const excluded = decision
            ? decision.value === 'none'
                ? null
                : decision.value
            : ruleExclusion;
        return {
            keywordId: row.id,
            text: row.text,
            language: row.language,
            locationCode: row.locationCode,
            role: row.role,
            volumeCity: city?.volume ?? null,
            volumeCityStatus: city?.volumeStatus ?? 'missing',
            volumeCountry: country?.volume ?? null,
            cpc: priced?.cpc ?? null,
            bidHigh: priced?.bidHigh ?? null,
            difficulty: withDifficulty?.difficulty ?? null,
            intent: withIntent?.intentEndpoint ?? null,
            intentProbability: withIntent?.intentProbability ?? null,
            sources: [...new Set(metrics.map((m) => m.source))],
            seeds: [...new Set((originsByKeyword.get(row.id) ?? []).map((o) => o.seed))],
            services: attribution.services,
            primaryService:
                decisions.get(decisionKey(String(row.id), 'service'))?.value ?? attribution.primary,
            modifiers: modifiersFor(row.text, placeStems, vocabulary),
            formKey: formKey(row.text),
            formPrimary: false,
            formMembers: 1,
            aggregatedWith: [],
            excluded,
            excludedBy: decision?.madeBy ?? (ruleExclusion ? 'rule' : null),
            shortlisted: decisions.get(decisionKey(String(row.id), 'shortlist'))?.value === 'true',
        };
    });

    const groups = new Map<string, KeywordReading[]>();
    for (const reading of readings) {
        const key = `${reading.language}|${reading.formKey}`;
        groups.set(key, [...(groups.get(key) ?? []), reading]);
    }
    for (const members of groups.values()) {
        const volume = (r: KeywordReading) => r.volumeCity ?? r.volumeCountry ?? -1;
        const primary = [...members].sort(
            (a, b) => volume(b) - volume(a) || a.text.length - b.text.length,
        )[0]!;
        const seriesOf = (r: KeywordReading) =>
            (metricsByKeyword.get(r.keywordId) ?? []).find((m) => m.seriesHash !== null)
                ?.seriesHash ?? null;
        for (const member of members) {
            member.formMembers = members.length;
            member.formPrimary =
                member === primary ||
                decisions.get(decisionKey(String(member.keywordId), 'form_primary'))?.value ===
                    'true';
            const hash = seriesOf(member);
            member.aggregatedWith = hash
                ? members
                      .filter(
                          (other) =>
                              other !== member &&
                              seriesOf(other) === hash &&
                              other.locationCode === member.locationCode,
                      )
                      .map((other) => other.text)
                : [];
        }
    }

    const counts: KeywordsBatch['counts'] = {};
    const thresholds: KeywordsBatch['thresholds'] = {};
    for (const language of config.languages) {
        const own = readings.filter((r) => r.language === language);
        const excluded: Record<string, number> = {};
        const bySource: Record<string, number> = {};
        for (const r of own) {
            if (r.excluded) excluded[r.excluded] = (excluded[r.excluded] ?? 0) + 1;
            bySource[r.role] = (bySource[r.role] ?? 0) + 1;
        }
        counts[language] = {
            total: own.length,
            measuredCity: own.filter(
                (r) => r.volumeCityStatus === 'measured' && (r.volumeCity ?? 0) > 0,
            ).length,
            excluded,
            forms: new Set(own.map((r) => r.formKey)).size,
            bySource,
        };
        thresholds[language] = {};
        for (const [key, decision] of thresholdDecisions) {
            if (key.startsWith(`keywords:${language}::`))
                thresholds[language]![decision.kind] = decision.value;
        }
    }
    readings.sort(
        (a, b) =>
            a.language.localeCompare(b.language) ||
            (b.volumeCity ?? -1) - (a.volumeCity ?? -1) ||
            (b.volumeCountry ?? -1) - (a.volumeCountry ?? -1) ||
            a.text.localeCompare(b.text),
    );
    return { languages: config.languages, thresholds, counts, rows: readings };
}
