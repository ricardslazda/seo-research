import { eq } from 'drizzle-orm';

import {
    backlinksReferringDomainsEndpoint,
    businessListingsEndpoint,
    stripWww,
    type DfsClient,
} from '@seo/dfs-client';

import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { domains, listings, referringDomains } from '../../db/schema.js';
import { currentDecisions } from '../../decisions.js';
import type { Reference } from '../../reference/index.js';
import { finishRun, startRun } from '../../runs.js';
import type { PlannedCall } from '../screen/gather.js';

export interface OffpageContext {
    db: Db;
    client: DfsClient;
    config: SiteConfig;
    reference: Reference;
    targets?: string[];
    refresh?: boolean;
    limit?: number;
    log?: (line: string) => void;
    now?: () => Date;
}

export interface OffpageSummary {
    runId: number;
    targets: string[];
    referringDomains: number;
    listingsPlaces: number;
    listings: number;
    failures: string[];
    cost: number;
    cachedCalls: number;
}

export function citationTargets(db: Db, explicit?: string[]): string[] {
    if (explicit && explicit.length > 0) return explicit.map(stripWww);
    const decisions = currentDecisions(db, 'domain');
    const strongest = [...decisions.values()]
        .filter((d) => d.kind === 'strongest' && d.value === 'true')
        .map((d) => d.subjectId);
    if (strongest.length > 0) return strongest;
    const competitors = new Set(
        [...decisions.values()]
            .filter((d) => d.kind === 'competitor' && d.value === 'true')
            .map((d) => d.subjectId),
    );
    const rows = db
        .select()
        .from(domains)
        .all()
        .filter((row) => competitors.has(row.domain));
    rows.sort((a, b) => (b.referringDomains ?? 0) - (a.referringDomains ?? 0));
    return rows.slice(0, 1).map((row) => row.domain);
}

export function planOffpage(
    db: Db,
    config: SiteConfig,
    options: { targets?: string[]; limit?: number } = {},
): { targets: string[]; calls: PlannedCall[]; total: number } {
    const targets = citationTargets(db, options.targets);
    const limit = options.limit ?? 300;
    const refPrice = backlinksReferringDomainsEndpoint.price({ target: '', limit });
    const calls: PlannedCall[] = [
        {
            endpoint: 'backlinks.referring_domains',
            count: targets.length,
            unitPrice: refPrice,
            cost: targets.length * refPrice,
        },
    ];
    const placesWithCoordinates = config.service_area?.listing_categories?.length
        ? config.places.filter((p) => p.coordinates).length
        : 0;
    calls.push({
        endpoint: 'business.listings',
        count: placesWithCoordinates,
        unitPrice: 0.0109,
        cost: placesWithCoordinates * 0.0109,
    });
    return { targets, calls, total: calls.reduce((sum, c) => sum + c.cost, 0) };
}

export async function runOffpage(context: OffpageContext): Promise<OffpageSummary> {
    const { db, client, config } = context;
    const log = context.log ?? (() => {});
    const now = context.now ?? (() => new Date());
    const stamp = () => now().toISOString();
    const callOptions = { refresh: context.refresh ?? false };
    const targets = citationTargets(db, context.targets);
    const runId = startRun(db, 'offpage', { targets }, now());
    const summary: OffpageSummary = {
        runId,
        targets,
        referringDomains: 0,
        listingsPlaces: 0,
        listings: 0,
        failures: [],
        cost: 0,
        cachedCalls: 0,
    };

    for (const target of targets) {
        try {
            log(`referring domains: ${target}`);
            const result = await client.call(
                backlinksReferringDomainsEndpoint,
                { target, limit: context.limit ?? 300 },
                { ...callOptions, runId },
            );
            summary.cost += result.cost;
            if (result.cached) summary.cachedCalls++;
            for (const item of result.rows[0]?.items ?? []) {
                const values = {
                    target,
                    domain: stripWww(item.domain),
                    rank: item.rank ?? null,
                    backlinks: item.backlinks ?? null,
                    spamScore: item.backlinks_spam_score ?? null,
                    firstSeen: item.first_seen ?? null,
                    nofollow: (item.referring_links_attributes?.['nofollow'] ?? 0) > 0,
                    countriesJson: JSON.stringify(
                        Object.keys(item.referring_links_countries ?? {}).filter(Boolean),
                    ),
                    platformsJson: JSON.stringify(
                        Object.keys(item.referring_links_platform_types ?? {}),
                    ),
                    fetchedAt: stamp(),
                    rawId: result.rawId,
                };
                db.insert(referringDomains)
                    .values(values)
                    .onConflictDoUpdate({
                        target: [referringDomains.target, referringDomains.domain],
                        set: values,
                    })
                    .run();
                summary.referringDomains++;
            }
        } catch (error) {
            summary.failures.push(
                `${target}: ${error instanceof Error ? error.message : String(error)}`,
            );
        }
    }

    const categories = config.service_area?.listing_categories ?? [];
    if (categories.length > 0) {
        for (const place of config.places) {
            if (!place.coordinates) continue;
            try {
                log(`listings: ${place.slug}`);
                const radius = config.service_area?.listing_radius_km ?? 10;
                const result = await client.call(
                    businessListingsEndpoint,
                    {
                        categories,
                        location_coordinate: `${place.coordinates.lat},${place.coordinates.lng},${radius}`,
                    },
                    { ...callOptions, runId },
                );
                summary.cost += result.cost;
                if (result.cached) summary.cachedCalls++;
                summary.listingsPlaces++;
                for (const item of result.rows[0]?.items ?? []) {
                    const cid =
                        item.cid ?? item.place_id ?? `${item.title ?? ''}|${item.address ?? ''}`;
                    if (!cid) continue;
                    const values = {
                        placeSlug: place.slug,
                        cid,
                        title: item.title ?? null,
                        category: item.category ?? null,
                        rating: item.rating?.value ?? null,
                        votes: item.rating?.votes_count ?? null,
                        claimed: item.is_claimed ?? null,
                        domain: item.domain ? stripWww(item.domain) : null,
                        address: item.address ?? null,
                        lat: item.latitude ?? null,
                        lng: item.longitude ?? null,
                        fetchedAt: stamp(),
                        rawId: result.rawId,
                    };
                    db.insert(listings)
                        .values(values)
                        .onConflictDoUpdate({
                            target: [listings.placeSlug, listings.cid],
                            set: values,
                        })
                        .run();
                    summary.listings++;
                }
            } catch (error) {
                summary.failures.push(
                    `listings ${place.slug}: ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        }
    }
    const _unused = eq;
    void _unused;
    finishRun(db, runId, JSON.stringify(summary), now());
    return summary;
}
