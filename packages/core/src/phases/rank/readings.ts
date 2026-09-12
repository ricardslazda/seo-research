import { desc } from 'drizzle-orm';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { keywords, rankReadings } from '../../db/schema.js';
import type { Reference } from '../../reference/index.js';
import { trackedKeywords } from './gather.js';

export type Ladder = 'top' | 'first_page' | 'edge' | 'second_page' | 'absent' | 'unread';

export interface RankRow {
    keyword: string;
    language: string;
    pageKey: string;
    role: 'primary' | 'supporting';
    claimedPath: string;
    position: number | null;
    url: string | null;
    pathMatches: boolean | null;
    ownPages: number;
    packPresent: boolean | null;
    packHasBusiness: boolean | null;
    ladder: Ladder;
    readAt: string | null;
    meaning: string;
}

export interface RankBatch {
    domain: string | null;
    readAt: string | null;
    rows: RankRow[];
    counts: Record<Ladder, number>;
    mismatches: number;
    byPageType: Record<string, { tracked: number; firstPage: number }>;
}

export function ladderOf(position: number | null, read: boolean): Ladder {
    if (!read) return 'unread';
    if (position === null) return 'absent';
    if (position <= 3) return 'top';
    if (position <= 10) return 'first_page';
    if (position <= 15) return 'edge';
    return 'second_page';
}

export function meaningOf(ladder: Ladder, pathMatches: boolean | null): string {
    if (ladder === 'unread') return 'no result page read yet';
    if (ladder === 'absent')
        return 'not in the first twenty: check indexing and citations before touching the page';
    if (pathMatches === false)
        return 'the search engine picked a different page than the plan; the cluster or the plan is wrong, not the copy';
    if (ladder === 'second_page')
        return 'not yet competing; look at what the field has that this page lacks before rewriting';
    if (ladder === 'edge') return 'the band where a rewrite pays; work these first';
    if (ladder === 'first_page')
        return 'competing; watch impressions and clicks before changing anything';
    return 'holding; leave it alone';
}

export function readRank(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    domain?: string,
): RankBatch {
    const tracked = trackedKeywords(db, config, reference);
    const readings = db
        .select()
        .from(rankReadings)
        .orderBy(desc(rankReadings.id))
        .all()
        .filter((r) => !domain || r.domain === domain);
    const usedDomain = domain ?? readings[0]?.domain ?? config.domain ?? null;
    const keywordText = new Map(
        db
            .select({ id: keywords.id, text: keywords.text, language: keywords.language })
            .from(keywords)
            .all()
            .map((k) => [k.id, `${k.language}|${k.text}`]),
    );
    const latest = new Map<string, (typeof readings)[number]>();
    for (const r of readings) {
        if (usedDomain && r.domain !== usedDomain) continue;
        const key = keywordText.get(r.keywordId);
        if (key && !latest.has(key)) latest.set(key, r);
    }
    const rows: RankRow[] = tracked.map((t) => {
        const r = latest.get(`${t.language}|${t.text}`);
        const ladder = ladderOf(r?.position ?? null, r !== undefined);
        return {
            keyword: t.text,
            language: t.language,
            pageKey: t.pageKey,
            role: t.role,
            claimedPath: t.path,
            position: r?.position ?? null,
            url: r?.url ?? null,
            pathMatches: r?.pathMatches ?? null,
            ownPages: r ? (JSON.parse(r.ownPagesJson ?? '[]') as unknown[]).length : 0,
            packPresent: r?.packPresent ?? null,
            packHasBusiness: r?.packHasBusiness ?? null,
            ladder,
            readAt: r?.readAt ?? null,
            meaning: meaningOf(ladder, r?.pathMatches ?? null),
        };
    });
    const counts: Record<Ladder, number> = {
        top: 0,
        first_page: 0,
        edge: 0,
        second_page: 0,
        absent: 0,
        unread: 0,
    };
    for (const row of rows) counts[row.ladder]++;
    const byPageType: RankBatch['byPageType'] = {};
    const plan = new Map<string, string>();
    for (const t of tracked)
        plan.set(
            t.pageKey,
            t.pageKey.startsWith('guide-')
                ? 'guide'
                : t.pageKey === 'home'
                  ? 'home'
                  : config.services.some((s) => s.key === t.pageKey)
                    ? 'service'
                    : 'area',
        );
    for (const row of rows) {
        const type = plan.get(row.pageKey) ?? 'other';
        const entry = byPageType[type] ?? { tracked: 0, firstPage: 0 };
        entry.tracked++;
        if (row.ladder === 'top' || row.ladder === 'first_page') entry.firstPage++;
        byPageType[type] = entry;
    }
    return {
        domain: usedDomain,
        readAt: rows.find((r) => r.readAt)?.readAt ?? null,
        rows,
        counts,
        mismatches: rows.filter((r) => r.pathMatches === false).length,
        byPageType,
    };
}
