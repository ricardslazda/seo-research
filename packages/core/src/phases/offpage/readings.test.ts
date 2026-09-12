import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    backlinksReferringDomainsEndpoint,
    businessListingsEndpoint,
    fixtureTransport,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { marketOf } from '../../config/market.js';
import { parseSiteConfig } from '../../config/site-config.js';
import { SqliteCacheStore } from '../../db/cache-store.js';
import { openDatabase } from '../../db/open.js';
import { decide } from '../../decide.js';
import { domains, places } from '../../db/schema.js';
import type { Reference } from '../../reference/index.js';
import { renderOffpageReport } from '../../report/offpage-report.js';
import { planOffpage, runOffpage } from './gather.js';
import { applyOffpageRules, readOffpage, sift } from './readings.js';

const fixturesDir = fileURLToPath(
    new URL('../../../../dfs-client/test/fixtures/', import.meta.url),
);
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            name: { en: { nom: 'Northbridge' } },
            coordinates: { lat: 1, lng: 1 },
        },
    ],
    services: [{ key: 'plumber', head: { en: { term: 'plumber' } } }],
    head_forms: { en: [{ term: 'term', place: 'nom' }] },
    market: { ignore_countries: ['XX'] },
    service_area: {
        base: 'northbridge',
        listing_categories: ['plumber'],
        listing_radius_km: 25,
        listing_match: 'plumb|heating|drain',
    },
    business_name: 'Northbridge Plumbing Co',
});
const reference: Reference = {
    locations: {
        '1001001': {
            code: 1001001,
            name: 'Northbridge,Testland',
            type: 'City',
            parent: null,
            countryIso: 'ZZ',
            sources: ['serp', 'ads'],
        },
    },
    support: { global: {}, countries: {}, intentLanguages: [] },
    prices: null,
    domains: {
        ZZ: {
            directory: ['directory-one.example'],
            government: ['northbridge-council.example'],
            social: ['social-network.example'],
        },
        XX: { directory: ['link-farm.example'] },
    },
};

const setup = () => {
    const { transport, sent } = fixtureTransport({
        [backlinksReferringDomainsEndpoint.path]: fixture('backlinks-referring-domains-example'),
        [businessListingsEndpoint.path]: fixture('business-listings-example'),
    });
    const { db, close } = openDatabase(':memory:');
    db.insert(places)
        .values({ slug: 'northbridge', locationCode: 1001001, kind: 'city', nameJson: '{}' })
        .run();
    db.insert(domains)
        .values({ domain: 'plumbers-r-us.example', referringDomains: 82, fetchedAt: 'x' })
        .run();
    decide(db, {
        subjectType: 'domain',
        subjectId: 'plumbers-r-us.example',
        decisions: [
            { kind: 'competitor', value: 'true' },
            { kind: 'strongest', value: 'true' },
        ],
        reason: 't',
        madeBy: 'human',
    });
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    return { db, close, client, sent };
};

describe('offpage phase', () => {
    it('reads the strongest profile and the listings, sifts citations and summarizes the pack landscape', async () => {
        const { db, close, client } = setup();
        const plan = planOffpage(db, config);
        expect(plan.targets).toEqual(['plumbers-r-us.example']);
        expect(plan.calls.map((c) => [c.endpoint, c.count])).toEqual([
            ['backlinks.referring_domains', 1],
            ['business.listings', 1],
        ]);
        const summary = await runOffpage({ db, client, config, reference });
        expect(summary.referringDomains).toBe(10);
        expect(summary.listings).toBe(6);
        expect(summary.failures).toEqual([]);
        const written = applyOffpageRules(db, config, reference, summary.runId);
        expect(written).toBe(10);

        const batch = readOffpage(db, config, reference);
        const verdicts = Object.fromEntries(batch.citations.map((c) => [c.domain, c.verdict]));
        expect(verdicts).toEqual({
            'directory-one.example': 'pursue',
            'northbridge-council.example': 'pursue',
            'social-network.example': 'pursue',
            'northbridge-news.example': 'pursue',
            'tender-aggregator.example': 'review',
            'eastfield-school.example': 'review',
            'link-farm.example': 'ignore',
            'blog-network.example': 'ignore',
            'cheap-links.example': 'ignore',
            '203.0.113.7': 'ignore',
        });
        expect(batch.counts).toEqual({ pursue: 4, review: 2, ignore: 4 });
        expect(batch.citations.find((c) => c.domain === 'link-farm.example')?.kind).toBe('unknown');

        const northbridge = batch.listings[0]!;
        expect(northbridge.total).toBe(6);
        expect(northbridge.matching).toBe(5);
        expect(northbridge.claimedShare).toBe(0.6);
        expect(northbridge.medianVotes).toBe(17);
        expect(northbridge.top[0]).toMatchObject({ title: 'Plumbers R Us', competitor: true });
        expect(northbridge.own?.title).toBe('Northbridge Plumbing Co');
        expect(northbridge.competitorsListed).toEqual(['plumbers-r-us.example']);

        decide(db, {
            subjectType: 'citation',
            subjectId: 'tender-aggregator.example',
            decisions: [{ kind: 'verdict', value: 'ignore' }],
            reason: 'tender aggregator',
            madeBy: 'human',
        });
        expect(applyOffpageRules(db, config, reference, null)).toBe(0);
        expect(
            readOffpage(db, config, reference).citations.find(
                (c) => c.domain === 'tender-aggregator.example',
            )?.verdictBy,
        ).toBe('human');

        const report = renderOffpageReport(batch);
        expect(report).toContain('| directory-one.example | directory |');
        expect(report).toContain('| northbridge | 6 |');
        close();
    });

    it('sifts by the documented rules', () => {
        const known = new Map([['directory-one.example', 'directory' as const]]);
        const market = marketOf(config, reference);
        const verdict = (
            domain: string,
            item: { rank: number; spamScore: number; countries: string[]; platforms?: string[] },
        ) => sift(domain, { platforms: [], nofollow: null, ...item }, known, market).verdict;
        expect(
            verdict('directory-one.example', { rank: 65, spamScore: 8, countries: ['ZZ'] }),
        ).toBe('pursue');
        expect(verdict('spam.example', { rank: 0, spamScore: 70, countries: [] })).toBe('ignore');
        expect(verdict('link-farm.example', { rank: 51, spamScore: 0, countries: ['XX'] })).toBe(
            'ignore',
        );
        expect(
            verdict('town-club.example', {
                rank: 21,
                spamScore: 0,
                countries: ['ZZ'],
                platforms: ['organization'],
            }),
        ).toBe('pursue');
        expect(verdict('bakery.zz', { rank: 15, spamScore: 0, countries: ['XX'] })).toBe('pursue');
        expect(verdict('small-blog.example', { rank: 3, spamScore: 0, countries: ['ZZ'] })).toBe(
            'review',
        );
        expect(verdict('far-away.example', { rank: 30, spamScore: 0, countries: ['XY'] })).toBe(
            'review',
        );
    });
});
