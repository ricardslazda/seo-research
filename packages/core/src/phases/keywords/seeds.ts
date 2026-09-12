import { keywordKey, normalizeKeyword } from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywordMetrics, keywords, serpItems, serps } from '../../db/schema.js';
import { foldAscii, serviceTokens, transliterate } from '../screen/rules.js';

export interface Seed {
    text: string;
    language: string;
    origin: 'service' | 'competitor' | 'question';
}

export interface SeedOptions {
    maxCompetitorSeeds?: number;
    minCompetitorVolume?: number;
}

export function serviceStemsAll(config: SiteConfig): string[] {
    return serviceTokens({ config });
}

export function mentionsService(text: string, stems: string[]): boolean {
    const folded = foldAscii(text);
    const latin = transliterate(folded);
    return stems.some((stem) => folded.includes(stem) || latin.includes(stem));
}

export function collectSeeds(db: Db, config: SiteConfig, options: SeedOptions = {}): Seed[] {
    const stems = serviceStemsAll(config);
    const maxCompetitor = options.maxCompetitorSeeds ?? 60;
    const minVolume = options.minCompetitorVolume ?? 10;
    const out: Seed[] = [];
    const seen = new Set<string>();
    const push = (text: string, language: string, origin: Seed['origin']): void => {
        const normalized = normalizeKeyword(text).toLowerCase();
        const key = `${language}|${keywordKey(normalized)}`;
        if (!normalized || seen.has(key)) return;
        seen.add(key);
        out.push({ text: normalized, language, origin });
    };

    for (const language of config.languages) {
        for (const service of config.services) {
            const forms = service.head[language];
            if (forms?.['term']) push(forms['term'], language, 'service');
        }
    }

    const rows = db.select().from(keywords).all();
    const metrics = db.select().from(keywordMetrics).all();
    const bestVolume = new Map<number, number>();
    for (const metric of metrics) {
        if (metric.volume === null) continue;
        bestVolume.set(
            metric.keywordId,
            Math.max(bestVolume.get(metric.keywordId) ?? 0, metric.volume),
        );
    }
    const competitorRows = rows
        .filter(
            (row) =>
                (row.role === 'ranked' || row.role === 'site_idea') &&
                mentionsService(row.text, stems),
        )
        .map((row) => ({ row, volume: bestVolume.get(row.id) ?? 0 }))
        .filter((entry) => entry.volume >= minVolume)
        .sort((a, b) => b.volume - a.volume)
        .slice(0, maxCompetitor);
    for (const entry of competitorRows) push(entry.row.text, entry.row.language, 'competitor');

    const serpRows = db.select().from(serps).all();
    const serpLanguage = new Map(serpRows.map((row) => [row.id, row.language]));
    for (const item of db.select().from(serpItems).all()) {
        if (
            item.type !== 'people_also_ask' &&
            item.type !== 'people_also_search' &&
            item.type !== 'related_searches'
        )
            continue;
        const language = serpLanguage.get(item.serpId);
        if (!language || !item.payloadJson) continue;
        const payload = JSON.parse(item.payloadJson) as { items?: unknown[] };
        for (const entry of payload.items ?? []) {
            const text =
                typeof entry === 'string'
                    ? entry
                    : entry &&
                        typeof entry === 'object' &&
                        'title' in entry &&
                        typeof entry.title === 'string'
                      ? entry.title
                      : null;
            if (text && mentionsService(text, stems))
                push(text.replace(/[?？]+$/, ''), language, 'question');
        }
    }
    return out;
}
