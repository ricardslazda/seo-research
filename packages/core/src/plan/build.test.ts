import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
    DfsClient,
    adsSearchVolumeEndpoint,
    bulkReferringDomainsEndpoint,
    fixtureTransport,
    okEnvelope,
    serpOrganicEndpoint,
    type DfsEnvelope,
} from '@seo/dfs-client';

import { parseSiteConfig } from '../config/site-config.js';
import { SqliteCacheStore } from '../db/cache-store.js';
import { openDatabase } from '../db/open.js';
import { decide } from '../decide.js';
import { keywordMetrics, keywords } from '../db/schema.js';
import { runCluster } from '../phases/cluster/gather.js';
import { runScreen } from '../phases/screen/gather.js';
import type { Reference } from '../reference/index.js';
import { renderPlanReport } from '../report/plan-report.js';
import { buildPlan, slugify } from './build.js';
import { Plan, planJsonSchema } from './schema.js';

const fixturesDir = fileURLToPath(new URL('../../../dfs-client/test/fixtures/', import.meta.url));
const fixture = (name: string): DfsEnvelope =>
    JSON.parse(readFileSync(join(fixturesDir, `${name}.json`), 'utf8')) as DfsEnvelope;

const config = parseSiteConfig({
    slug: 'northbridge-plumbing',
    languages: ['en', 'es'],
    places: [
        {
            slug: 'northbridge',
            location_code: 1001001,
            coordinates: { lat: 1, lng: 1 },
            name: {
                en: { nom: 'Northbridge' },
                es: { nom: 'Northbridge', loc: 'en Northbridge' },
            },
        },
        {
            slug: 'eastfield',
            location_code: 1001002,
            coordinates: { lat: 1, lng: 1.2 },
            name: {
                en: { nom: 'Eastfield' },
                es: { nom: 'Eastfield', loc: 'en Eastfield' },
            },
            slugs: { en: 'plumber-eastfield', es: 'fontanero-eastfield' },
        },
    ],
    services: [
        { key: 'plumber', head: { en: { term: 'plumber' }, es: { term: 'fontanero' } } },
        {
            key: 'emergency',
            head: { en: { term: 'emergency plumber' }, es: { term: 'fontanero urgente' } },
            slugs: { en: 'emergency-plumber', es: 'fontanero-urgente' },
        },
    ],
    head_forms: { en: [{ term: 'term', place: 'nom' }], es: [{ term: 'term', place: 'loc' }] },
    market: { currency: 'USD' },
    paths: { es: { services: 'servicios', guides: 'guias' } },
    service_area: {
        base: 'northbridge',
        free_km: 15,
        per_km: 0.5,
        response_promise: { en: 'we call back within 10 minutes', es: 'le llamamos en 10 minutos' },
    },
});

const city = (code: number, name: string) => ({
    code,
    name: `${name},Testland`,
    type: 'City',
    parent: null,
    countryIso: 'ZZ',
    sources: ['serp', 'ads'],
});

const reference: Reference = {
    locations: { '1001001': city(1001001, 'Northbridge'), '1001002': city(1001002, 'Eastfield') },
    support: {
        global: { ads: ['en', 'es'], serp: ['en', 'es'] },
        countries: { ZZ: { labs: ['en'] } },
        intentLanguages: ['en'],
    },
    prices: null,
    domains: {
        ZZ: { directory: ['directory-one.example'], classifieds: ['classifieds-hub.example'] },
    },
};

const setup = async () => {
    const { transport } = fixtureTransport({
        [adsSearchVolumeEndpoint.path]: fixture('ads-search-volume-en'),
        [serpOrganicEndpoint.path]: fixture('serp-organic-en'),
        [bulkReferringDomainsEndpoint.path]: okEnvelope(
            [{ items: [{ target: 'directory-one.example', referring_domains: 410 }] }],
            0.02,
        ),
    });
    const { db, close } = openDatabase(':memory:');
    const client = new DfsClient({ transport, store: new SqliteCacheStore(db) });
    await runScreen({ db, client, config, reference });
    const hub = db
        .insert(keywords)
        .values({ text: 'plumber', language: 'en', locationCode: 2999, role: 'suggestion' })
        .returning({ id: keywords.id })
        .get()!.id;
    const service = db
        .insert(keywords)
        .values({
            text: 'emergency plumber',
            language: 'en',
            locationCode: 2999,
            role: 'suggestion',
        })
        .returning({ id: keywords.id })
        .get()!.id;
    const guide = db
        .insert(keywords)
        .values({
            text: 'plumbing prices',
            language: 'en',
            locationCode: 2999,
            role: 'suggestion',
        })
        .returning({ id: keywords.id })
        .get()!.id;
    for (const [id, volume] of [
        [hub, 140],
        [service, 10],
        [guide, 10],
    ] as const)
        db.insert(keywordMetrics)
            .values({
                keywordId: id,
                source: 'ads_idea',
                volume,
                volumeStatus: 'measured',
                fetchedAt: 'x',
            })
            .run();
    for (const id of [hub, service, guide])
        decide(db, {
            subjectType: 'keyword',
            subjectId: String(id),
            decisions: [{ kind: 'shortlist', value: 'true' }],
            reason: 't',
            madeBy: 'human',
        });
    decide(db, {
        subjectType: 'keyword',
        subjectId: String(hub),
        decisions: [{ kind: 'page_type', value: 'home' }],
        reason: 'hub',
        madeBy: 'human',
    });
    decide(db, {
        subjectType: 'keyword',
        subjectId: String(service),
        decisions: [{ kind: 'cluster', value: 'own' }],
        reason: 'own page',
        madeBy: 'human',
    });
    decide(db, {
        subjectType: 'keyword',
        subjectId: String(guide),
        decisions: [
            { kind: 'cluster', value: 'own' },
            { kind: 'page_type', value: 'guide' },
        ],
        reason: 'guide',
        madeBy: 'human',
    });
    decide(db, {
        subjectType: 'threshold',
        subjectId: 'keywords:es',
        decisions: [{ kind: 'second_language', value: 'leave' }],
        reason: 'thin',
        madeBy: 'human',
    });
    decide(db, {
        subjectType: 'threshold',
        subjectId: 'keywords:en',
        decisions: [{ kind: 'page_budget', value: '12' }],
        reason: 'sized',
        madeBy: 'human',
    });
    await runCluster({ db, client, config, reference });
    return { db, close, client };
};

const shortlisted = (
    db: ReturnType<typeof openDatabase>['db'],
    text: string,
    language: string,
    decisions: { kind: string; value: string }[] = [],
): number => {
    const id = db
        .insert(keywords)
        .values({ text, language, locationCode: 2999, role: 'suggestion' })
        .returning({ id: keywords.id })
        .get()!.id;
    db.insert(keywordMetrics)
        .values({
            keywordId: id,
            source: 'ads_idea',
            volume: 10,
            volumeStatus: 'measured',
            fetchedAt: 'x',
        })
        .run();
    decide(db, {
        subjectType: 'keyword',
        subjectId: String(id),
        decisions: [{ kind: 'shortlist', value: 'true' }, ...decisions],
        reason: 't',
        madeBy: 'human',
    });
    return id;
};

describe('buildPlan', () => {
    it('turns clusters, services and places into a validated plan with a link mesh', async () => {
        const { db, close } = await setup();
        const plan = buildPlan(db, config, reference, {
            now: () => new Date('2026-09-03T00:00:00Z'),
        });
        expect(() => Plan.parse(plan)).not.toThrow();
        expect(plan.site.pageBudget).toEqual({ en: 12, es: null });
        const keys = plan.pages.map((p) => [p.translationKey, p.type, p.status]);
        expect(keys).toEqual([
            ['home', 'home', 'planned'],
            ['emergency', 'service', 'planned'],
            ['eastfield', 'area', 'planned'],
            ['guide-plumbing-prices', 'guide', 'planned'],
        ]);
        const home = plan.pages[0]!;
        expect(home.locales['en']?.path).toBe('/');
        expect(home.locales['es']?.path).toBe('/es/');
        expect(home.locales['en']?.primaryKeyword).toBe('plumber');
        const emergency = plan.pages[1]!;
        expect(emergency.locales['en']?.path).toBe('/services/emergency-plumber');
        expect(emergency.locales['es']?.path).toBe('/es/servicios/fontanero-urgente');
        expect(emergency.locales['en']?.primaryKeyword).toBe('emergency plumber');
        expect(emergency.linkedFrom).toEqual(['home', 'eastfield']);
        const eastfield = plan.pages[2]!;
        expect(eastfield.locales['en']?.path).toBe('/plumber-eastfield');
        expect(eastfield.locales['en']?.primaryKeyword).toBe('plumber eastfield');
        expect(eastfield.evidence?.level).toBe('derived');
        expect(eastfield.evidence?.derived).toMatchObject({
            distanceKm: 28,
            travelMinutes: 44,
            freeTravel: false,
            surchargePerKm: 0.5,
            currency: 'USD',
        });
        expect(eastfield.evidence?.localFacts.length).toBeGreaterThanOrEqual(3);
        expect(eastfield.evidence?.localFacts[0]).toBe(
            'Eastfield is about 28 km by road from Northbridge, roughly 44 minutes each way, and travel beyond 15 km is charged at 0.5 USD per km.',
        );
        expect(eastfield.angle).toMatch(/^Eastfield: \d+ km from base/);
        expect(emergency.angle).toMatch(/^The one page for "emergency plumber"/);
        expect(home.angle).toMatch(/hub for Northbridge/);
        expect(plan.pages[3]!.locales['en']?.path).toBe('/guides/plumbing-prices');
        expect(plan.pages[3]!.locales['es']?.path).toBe('/es/guias/plumbing-prices');

        decide(db, {
            subjectType: 'page',
            subjectId: 'eastfield',
            decisions: [
                {
                    kind: 'justification',
                    value: 'Eastfield is a commuter town of terraced houses whose ageing pipework keeps plumbers busy all year',
                },
                {
                    kind: 'fact_1',
                    value: 'Most houses in Eastfield were built before the war and still run on their original supply pipes',
                },
                {
                    kind: 'fact_2',
                    value: 'Hard water from the local reservoir scales boilers and taps within a few years of fitting',
                },
                {
                    kind: 'fact_3',
                    value: 'Parking on the high street is limited to permit holders, which adds time to every call-out',
                },
                { kind: 'source', value: 'the town housing survey and the crew log' },
                { kind: 'angle', value: 'terraced houses with their original pipework' },
            ],
            reason: 'evidence',
            madeBy: 'human',
        });
        const again = buildPlan(db, config, reference);
        const verified = again.pages.find((p) => p.translationKey === 'eastfield')!;
        expect(verified.status).toBe('planned');
        expect(verified.evidence?.level).toBe('verified');
        expect(verified.evidence?.localFacts.length).toBeGreaterThanOrEqual(6);
        expect(verified.angle).toBe('terraced houses with their original pipework');
        expect(renderPlanReport(again)).toContain(
            '| 3 | eastfield | area | /plumber-eastfield | `plumber eastfield` |',
        );
        expect(planJsonSchema()['$schema']).toContain('json-schema');
        close();
    });

    it('keeps a second language on its own locales and gives a town cluster to the town', async () => {
        const { db, close, client } = await setup();
        const esEmergency = shortlisted(db, 'fontanero urgente', 'es', [
            { kind: 'cluster', value: 'own' },
        ]);
        const enTown = shortlisted(db, 'emergency plumber eastfield', 'en', [
            { kind: 'cluster', value: 'own' },
            { kind: 'page_type', value: 'place' },
        ]);
        const enOnlyGuide = shortlisted(db, 'emergency plumber cost', 'en', [
            { kind: 'cluster', value: 'own' },
            { kind: 'page_type', value: 'guide' },
        ]);
        decide(db, {
            subjectType: 'threshold',
            subjectId: 'keywords:es',
            decisions: [{ kind: 'second_language', value: 'take' }],
            reason: 'taken',
            madeBy: 'human',
        });
        await runCluster({ db, client, config, reference });
        const plan = buildPlan(db, config, reference);
        const emergency = plan.pages.find((p) => p.translationKey === 'emergency')!;
        expect(emergency.locales['en']?.primaryKeyword).toBe('emergency plumber');
        expect(emergency.locales['es']?.primaryKeyword).toBe('fontanero urgente');
        expect(emergency.clusterIds['es']).toBe(esEmergency);
        const eastfield = plan.pages.find((p) => p.translationKey === 'eastfield')!;
        expect(eastfield.locales['en']?.primaryKeyword).toBe('emergency plumber eastfield');
        expect(eastfield.locales['en']?.supportingKeywords).toContain('plumber eastfield');
        expect(eastfield.clusterIds['en']).toBe(enTown);
        expect(plan.pages.filter((p) => p.type === 'guide').map((p) => p.translationKey)).toEqual([
            'guide-emergency-plumber-cost',
            'guide-plumbing-prices',
        ]);
        expect(plan.pages.some((p) => p.translationKey.includes('fontanero'))).toBe(false);
        expect(plan.pages.some((p) => p.clusterIds['en'] === enOnlyGuide)).toBe(true);
        close();
    });

    it('slugifies accents and the Cyrillic alphabet', () => {
        expect(slugify('Reparación de calderas')).toBe('reparacion-de-calderas');
        expect(slugify('летнее кафе')).toBe('letnee-kafe');
    });
});
