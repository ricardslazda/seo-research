import { marketOf, type Market } from '../../config/market.js';
import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { listings, referringDomains } from '../../db/schema.js';
import { currentDecisions, decisionKey, writeDecision } from '../../decisions.js';
import { domainsFor, type Reference } from '../../reference/index.js';
import { knownKind, knownKinds, median, type DomainKind } from '../screen/rules.js';

export type CitationVerdict = 'pursue' | 'review' | 'ignore';

export interface CitationReading {
    domain: string;
    target: string;
    rank: number | null;
    backlinks: number | null;
    spamScore: number | null;
    firstSeen: string | null;
    nofollow: boolean | null;
    countries: string[];
    platforms: string[];
    kind: DomainKind | 'organization' | 'blog' | 'unknown';
    verdict: CitationVerdict;
    verdictBy: string;
    reason: string;
}

export interface ListingSummary {
    place: string;
    total: number;
    matching: number;
    claimedShare: number | null;
    medianVotes: number | null;
    top: {
        title: string;
        category: string | null;
        rating: number | null;
        votes: number | null;
        domain: string | null;
        competitor: boolean;
    }[];
    own: { title: string; rating: number | null; votes: number | null } | null;
    competitorsListed: string[];
}

export interface OffpageBatch {
    citations: CitationReading[];
    listings: ListingSummary[];
    counts: Record<CitationVerdict, number>;
}

const SPAM_IGNORE = 30;

export function sift(
    domain: string,
    item: {
        rank: number | null;
        spamScore: number | null;
        countries: string[];
        platforms: string[];
        nofollow: boolean | null;
    },
    known: Map<string, DomainKind>,
    market: Market,
): { kind: CitationReading['kind']; verdict: CitationVerdict; reason: string } {
    const listed = knownKind(known, domain);
    const isIp = /^\d+\.\d+\.\d+\.\d+$/.test(domain);
    const homeTld = market.homeTlds.some((tld) => domain.endsWith(tld));
    const homeCountry = item.countries.includes(market.country) || homeTld;
    const foreignOnly =
        item.countries.length > 0 &&
        item.countries.every((c) => market.ignoreCountries.has(c)) &&
        !homeTld;
    const kind: CitationReading['kind'] =
        listed ??
        (item.platforms.includes('organization')
            ? 'organization'
            : item.platforms.some((p) => p === 'blogs' || p === 'cms')
              ? 'blog'
              : 'unknown');
    if (isIp) return { kind, verdict: 'ignore', reason: 'bare IP address' };
    if ((item.spamScore ?? 0) > SPAM_IGNORE)
        return { kind, verdict: 'ignore', reason: `spam score ${item.spamScore}` };
    if (foreignOnly)
        return { kind, verdict: 'ignore', reason: `links only from ${item.countries.join(', ')}` };
    if (listed === 'directory' || listed === 'government' || listed === 'classifieds')
        return {
            kind,
            verdict: 'pursue',
            reason: `${listed} in the home market; a listing is available to any business`,
        };
    if (listed === 'social')
        return { kind, verdict: 'pursue', reason: 'profile on a social platform' };
    if (homeCountry && (item.rank ?? 0) >= 10)
        return { kind, verdict: 'pursue', reason: `home-market site with rank ${item.rank}` };
    if (homeCountry)
        return {
            kind,
            verdict: 'review',
            reason: 'home-market site with a weak rank; check whether a listing or mention is open to others',
        };
    if (kind === 'blog' && !homeCountry)
        return { kind, verdict: 'ignore', reason: 'foreign blog network' };
    return { kind, verdict: 'review', reason: 'no signal either way' };
}

export function readOffpage(db: Db, config: SiteConfig, reference: Reference): OffpageBatch {
    const market = marketOf(config, reference);
    const known = knownKinds(domainsFor(reference, market.country));
    const decisions = currentDecisions(db, 'citation');
    const domainDecisions = currentDecisions(db, 'domain');
    const competitors = new Set(
        [...domainDecisions.values()]
            .filter((d) => d.kind === 'competitor' && d.value === 'true')
            .map((d) => d.subjectId),
    );

    const citations: CitationReading[] = db
        .select()
        .from(referringDomains)
        .all()
        .map((row) => {
            const countries = JSON.parse(row.countriesJson ?? '[]') as string[];
            const platforms = JSON.parse(row.platformsJson ?? '[]') as string[];
            const rule = sift(
                row.domain,
                {
                    rank: row.rank,
                    spamScore: row.spamScore,
                    countries,
                    platforms,
                    nofollow: row.nofollow,
                },
                known,
                market,
            );
            const decision = decisions.get(decisionKey(row.domain, 'verdict'));
            return {
                domain: row.domain,
                target: row.target,
                rank: row.rank,
                backlinks: row.backlinks,
                spamScore: row.spamScore,
                firstSeen: row.firstSeen,
                nofollow: row.nofollow,
                countries,
                platforms,
                kind: rule.kind,
                verdict: (decision?.value as CitationVerdict | undefined) ?? rule.verdict,
                verdictBy: decision?.madeBy ?? 'rule',
                reason: decision?.reason ?? rule.reason,
            };
        })
        .sort(
            (a, b) =>
                ['pursue', 'review', 'ignore'].indexOf(a.verdict) -
                    ['pursue', 'review', 'ignore'].indexOf(b.verdict) ||
                (b.rank ?? 0) - (a.rank ?? 0),
        );

    const own = config.business_name?.toLowerCase() ?? null;
    const ownDomain = config.domain ?? null;
    const listingMatch = config.service_area?.listing_match
        ? new RegExp(config.service_area.listing_match, 'i')
        : null;
    const summaries: ListingSummary[] = [];
    for (const place of config.places) {
        const rows = db
            .select()
            .from(listings)
            .all()
            .filter((row) => row.placeSlug === place.slug);
        if (rows.length === 0) continue;
        const matching = listingMatch
            ? rows.filter((row) => listingMatch.test(row.category ?? ''))
            : rows;
        const claimed = rows.filter((row) => row.claimed !== null);
        const ownRow = rows.find(
            (row) =>
                (own && (row.title ?? '').toLowerCase().includes(own)) ||
                (ownDomain && row.domain === ownDomain),
        );
        summaries.push({
            place: place.slug,
            total: rows.length,
            matching: matching.length,
            claimedShare:
                claimed.length > 0
                    ? Math.round(
                          (claimed.filter((row) => row.claimed).length / claimed.length) * 100,
                      ) / 100
                    : null,
            medianVotes: median(matching.map((row) => row.votes)),
            top: [...matching]
                .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
                .slice(0, 5)
                .map((row) => ({
                    title: row.title ?? '',
                    category: row.category,
                    rating: row.rating,
                    votes: row.votes,
                    domain: row.domain,
                    competitor: row.domain ? competitors.has(row.domain) : false,
                })),
            own: ownRow
                ? { title: ownRow.title ?? '', rating: ownRow.rating, votes: ownRow.votes }
                : null,
            competitorsListed: [
                ...new Set(
                    rows
                        .map((row) => row.domain)
                        .filter((d): d is string => d !== null && competitors.has(d)),
                ),
            ],
        });
    }
    const counts: Record<CitationVerdict, number> = { pursue: 0, review: 0, ignore: 0 };
    for (const c of citations) counts[c.verdict]++;
    return { citations, listings: summaries, counts };
}

export function applyOffpageRules(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    runId: number | null,
): number {
    const batch = readOffpage(db, config, reference);
    const decisions = currentDecisions(db, 'citation');
    let written = 0;
    for (const c of batch.citations) {
        const current = decisions.get(decisionKey(c.domain, 'verdict'));
        if (current && current.madeBy !== 'rule') continue;
        if (current?.value === c.verdict) continue;
        writeDecision(db, {
            runId,
            subjectType: 'citation',
            subjectId: c.domain,
            kind: 'verdict',
            value: c.verdict,
            reason: c.reason,
            madeBy: 'rule',
        });
        written++;
    }
    return written;
}
