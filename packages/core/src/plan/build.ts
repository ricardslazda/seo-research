import { DEFAULT_PATH_WORDS, type PathWords, type SiteConfig } from '../config/site-config.js';
import type { Db } from '../db/open.js';
import { currentDecisions, decisionKey } from '../decisions.js';
import { readClusters, type ClusterReading } from '../phases/cluster/readings.js';
import { readCompetitors } from '../phases/competitors/readings.js';
import type { Reference } from '../reference/index.js';
import { loadScreen } from '../phases/screen/load.js';
import { readScreen, type LanguageReading } from '../phases/screen/readings.js';
import { foldAscii, transliterate } from '../phases/screen/rules.js';
import { areaAngle, guideAngle, homeAngle, serviceAngle } from './angles.js';
import { deriveTownEvidence, type TownEvidence } from './evidence.js';
import { Plan, type PlanPage } from './schema.js';
import { keywordMetrics, keywords, runs } from '../db/schema.js';
import { desc, eq } from 'drizzle-orm';

export function slugify(text: string): string {
    return transliterate(foldAscii(text))
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');
}

function pathFor(
    language: string,
    defaultLanguage: string,
    words: PathWords,
    type: PlanPage['type'],
    slug: string,
): string {
    const prefix = language === defaultLanguage ? '' : `/${language}`;
    if (type === 'home') return `${prefix}/`;
    if (type === 'service') return `${prefix}/${words.services}/${slug}`;
    if (type === 'guide') return `${prefix}/${words.guides}/${slug}`;
    return `${prefix}/${slug}`;
}

export interface BuildOptions {
    now?: () => Date;
}

export function buildPlan(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    options: BuildOptions = {},
): Plan {
    const now = options.now ?? (() => new Date());
    const defaultLanguage = config.languages[0]!;
    const thresholds = currentDecisions(db, 'threshold');
    const pageDecisions = currentDecisions(db, 'page');
    const decision = (key: string, kind: string): string | undefined =>
        pageDecisions.get(decisionKey(key, kind))?.value;

    const clusters = readClusters(db, config, reference);
    const screen = readScreen(loadScreen(db, config, reference));
    const hubPlace = config.places[0]!;
    const coverageCells = readCompetitors(db, config, reference).coverage;
    const townPagesHeld = (placeSlug: string): string[] => [
        ...new Set(
            coverageCells
                .filter((c) => c.place === placeSlug && c.language === defaultLanguage)
                .flatMap((c) => c.competitorsWithPage),
        ),
    ];
    const cityKeywordIds = new Set(
        db
            .select({ id: keywords.id })
            .from(keywords)
            .where(eq(keywords.locationCode, hubPlace.location_code))
            .all()
            .map((r) => r.id),
    );
    const monthlySeries: { month: number; search_volume: number }[][] = [];
    for (const metric of db.select().from(keywordMetrics).all()) {
        if (!cityKeywordIds.has(metric.keywordId) || !metric.monthlyJson) continue;
        monthlySeries.push(
            JSON.parse(metric.monthlyJson) as { month: number; search_volume: number }[],
        );
    }
    const lastScreen = db
        .select({ startedAt: runs.startedAt })
        .from(runs)
        .where(eq(runs.phase, 'screen'))
        .orderBy(desc(runs.id))
        .limit(1)
        .get();
    const readOn = (lastScreen?.startedAt ?? now().toISOString()).slice(0, 10);

    const readingFor = (
        serviceKey: string,
        placeSlug: string,
        language: string,
    ): LanguageReading | null =>
        screen.rows.find((row) => row.service === serviceKey && row.place === placeSlug)?.languages[
            language
        ] ?? null;
    const demandOf = (reading: LanguageReading | null): 'measured' | 'witnessed' | 'none' => {
        if (!reading) return 'none';
        if (typeof reading.volume === 'number' && reading.volume > 0) return 'measured';
        return reading.demandEvidence.length > 0 ? 'witnessed' : 'none';
    };

    const pages: PlanPage[] = [];
    const notWritten: Plan['notWritten'] = [];
    // Clusters are read per language: a service page takes one cluster per locale, a town page
    // takes the cluster written for that town, and a guide keeps the language it was read in.
    const clusterByService = new Map<string, Map<string, ClusterReading>>();
    const placeClusters = new Map<string, Map<string, ClusterReading>>();
    const hubClusters = new Map<string, ClusterReading>();
    const guideClusters: ClusterReading[] = [];
    const researched = new Set(clusters.languages);
    const folded = (text: string): string => transliterate(foldAscii(text));
    const placeOf = (cluster: ClusterReading): string | null => {
        const text = ` ${folded(cluster.primaryKeyword)} `;
        const place = config.places.find((p) =>
            Object.values(p.name[cluster.language] ?? {}).some((form) =>
                text.includes(` ${folded(form)} `),
            ),
        );
        return place?.slug ?? null;
    };
    const claim = (
        map: Map<string, Map<string, ClusterReading>>,
        language: string,
        key: string,
        cluster: ClusterReading,
    ): boolean => {
        const own = map.get(language) ?? new Map<string, ClusterReading>();
        map.set(language, own);
        if (own.has(key)) return false;
        own.set(key, cluster);
        return true;
    };

    for (const cluster of clusters.clusters) {
        const language = cluster.language;
        const town = cluster.pageType === 'place' ? placeOf(cluster) : null;
        if (cluster.pageType === 'home') {
            if (hubClusters.has(language)) guideClusters.push(cluster);
            else hubClusters.set(language, cluster);
        } else if (cluster.pageType === 'guide') guideClusters.push(cluster);
        else if (town && town !== hubPlace.slug) {
            if (!claim(placeClusters, language, town, cluster)) guideClusters.push(cluster);
        } else if (cluster.service) {
            if (!claim(clusterByService, language, cluster.service, cluster))
                guideClusters.push(cluster);
        } else
            notWritten.push({
                subject: cluster.primaryKeyword,
                reason: 'no service claims it and it is not a guide; assign a service or a page type',
            });
    }
    const clusterFor = (language: string, serviceKey: string): ClusterReading | null =>
        clusterByService.get(language)?.get(serviceKey) ?? null;
    const membersOf = (cluster: ClusterReading): string[] =>
        cluster.members.filter((m) => m.role === 'member').map((m) => m.text);

    const localesFor = (
        type: PlanPage['type'],
        slugs: Record<string, string>,
        primary: Record<string, string | null>,
        supporting: Record<string, string[]>,
        questions: Record<string, string[]>,
        intent: Record<string, string>,
        demand: Record<string, 'measured' | 'witnessed' | 'none'>,
    ): PlanPage['locales'] => {
        const out: PlanPage['locales'] = {};
        for (const language of config.languages) {
            out[language] = {
                path: pathFor(
                    language,
                    defaultLanguage,
                    config.paths[language] ?? DEFAULT_PATH_WORDS,
                    type,
                    slugs[language] ?? slugs[defaultLanguage] ?? '',
                ),
                primaryKeyword: primary[language] ?? null,
                supportingKeywords: supporting[language] ?? [],
                intent: intent[language] ?? intent[defaultLanguage] ?? 'unknown',
                questions: questions[language] ?? [],
                demand: demand[language] ?? 'none',
            };
        }
        return out;
    };

    const hubCluster = hubClusters.get(defaultLanguage) ?? null;
    const hubService = hubCluster?.service ?? null;
    {
        const primary: Record<string, string | null> = {};
        const supporting: Record<string, string[]> = {};
        const demand: Record<string, 'measured' | 'witnessed' | 'none'> = {};
        const intent: Record<string, string> = {};
        const questions: Record<string, string[]> = {};
        const clusterIds: Record<string, number | null> = {};
        for (const language of config.languages) {
            const hub = hubClusters.get(language) ?? null;
            const reading = hubService ? readingFor(hubService, hubPlace.slug, language) : null;
            primary[language] = hub ? hub.primaryKeyword : (reading?.keyword ?? null);
            supporting[language] = hub ? membersOf(hub) : reading ? [reading.keyword] : [];
            demand[language] = hub
                ? hub.volumeSum > 0
                    ? 'measured'
                    : 'witnessed'
                : demandOf(reading);
            intent[language] = 'commercial';
            questions[language] = hub?.questions ?? [];
            clusterIds[language] = hub?.id ?? null;
        }
        pages.push({
            translationKey: 'home',
            type: 'home',
            parentKey: null,
            serviceKey: hubService,
            placeSlug: hubPlace.slug,
            locales: localesFor('home', {}, primary, supporting, questions, intent, demand),
            clusterIds,
            angle:
                decision('home', 'angle') ??
                homeAngle(hubCluster, hubPlace.name[defaultLanguage]?.['nom'] ?? hubPlace.slug),
            evidence: null,
            linkedFrom: [],
            buildTier: 1,
            status: decision('home', 'build') === 'false' ? 'not-written' : 'planned',
            notes: hubCluster
                ? []
                : [
                      'no cluster carries the home page type; give the trade term a page_type=home decision',
                  ],
        });
    }

    for (const service of config.services) {
        const cluster = clusterFor(defaultLanguage, service.key);
        if (service.key === hubService) continue;
        const key = service.key;
        const slugs: Record<string, string> = {};
        const primary: Record<string, string | null> = {};
        const supporting: Record<string, string[]> = {};
        const demand: Record<string, 'measured' | 'witnessed' | 'none'> = {};
        const intent: Record<string, string> = {};
        const questions: Record<string, string[]> = {};
        const clusterIds: Record<string, number | null> = {};
        for (const language of config.languages) {
            const term = service.head[language]?.['term'] ?? null;
            slugs[language] = service.slugs?.[language] ?? slugify(term ?? key);
            const reading = readingFor(service.key, hubPlace.slug, language);
            const own = clusterFor(language, service.key);
            if (own) {
                primary[language] = own.primaryKeyword;
                supporting[language] = membersOf(own);
                demand[language] = own.volumeSum > 0 ? 'measured' : demandOf(reading);
                intent[language] = own.intentFinal;
            } else {
                primary[language] = term;
                supporting[language] = reading ? [reading.keyword] : [];
                demand[language] = demandOf(reading);
                intent[language] = cluster?.intentFinal ?? 'commercial';
            }
            questions[language] = own?.questions ?? [];
            clusterIds[language] = own?.id ?? null;
        }
        const notes: string[] = [];
        if (!cluster && researched.has(defaultLanguage))
            notes.push(
                'no shortlisted keyword in the researched language; the page is a conversion or navigation page',
            );
        const excluded = decision(key, 'build') === 'false';
        pages.push({
            translationKey: key,
            type: 'service',
            parentKey: 'home',
            serviceKey: key,
            placeSlug: null,
            locales: localesFor('service', slugs, primary, supporting, questions, intent, demand),
            clusterIds,
            angle:
                decision(key, 'angle') ??
                serviceAngle(cluster, service.head[defaultLanguage]?.['term'] ?? null),
            evidence: null,
            linkedFrom: [],
            buildTier: 2,
            status: excluded ? 'not-written' : 'planned',
            notes,
        });
    }

    for (const place of config.places) {
        if (place.slug === hubPlace.slug) continue;
        const key = place.slug;
        const slugs: Record<string, string> = {};
        const primary: Record<string, string | null> = {};
        const supporting: Record<string, string[]> = {};
        const demand: Record<string, 'measured' | 'witnessed' | 'none'> = {};
        const intent: Record<string, string> = {};
        const questions: Record<string, string[]> = {};
        const clusterIds: Record<string, number | null> = {};
        for (const language of config.languages) {
            slugs[language] =
                place.slugs?.[language] ?? slugify(place.name[language]?.['nom'] ?? place.slug);
            const town = placeClusters.get(language)?.get(place.slug) ?? null;
            const head = hubService ? readingFor(hubService, place.slug, language) : null;
            const others = config.services
                .filter((s) => s.key !== hubService)
                .map((s) => readingFor(s.key, place.slug, language))
                .filter((r): r is LanguageReading => r !== null && r.demandEvidence.length > 0);
            primary[language] = town?.primaryKeyword ?? head?.keyword ?? null;
            supporting[language] = [
                ...new Set([
                    ...(town ? membersOf(town) : []),
                    ...(town && head ? [head.keyword] : []),
                    ...others.map((r) => r.keyword),
                ]),
            ];
            const best = [head, ...others].filter((r): r is LanguageReading => r !== null);
            demand[language] =
                (town && town.volumeSum > 0) ||
                best.some((r) => typeof r.volume === 'number' && r.volume > 0)
                    ? 'measured'
                    : town || best.some((r) => r.demandEvidence.length > 0)
                      ? 'witnessed'
                      : 'none';
            intent[language] = town?.intentFinal ?? 'commercial';
            questions[language] = [
                ...new Set([...(town?.questions ?? []), ...best.flatMap((r) => r.paa)]),
            ];
            clusterIds[language] = town?.id ?? null;
        }
        const justification = decision(key, 'justification') ?? null;
        const facts = [
            decision(key, 'fact_1'),
            decision(key, 'fact_2'),
            decision(key, 'fact_3'),
        ].filter((f): f is string => Boolean(f));
        const source = decision(key, 'source') ?? null;
        const verified =
            justification !== null &&
            justification.length >= 40 &&
            facts.length >= 3 &&
            facts.every((f) => f.length >= 40) &&
            source !== null;
        const derived = deriveTownEvidence({
            config,
            place,
            readings: config.services
                .map((s) => ({
                    serviceKey: s.key,
                    reading: readingFor(s.key, place.slug, defaultLanguage),
                }))
                .filter(
                    (r): r is { serviceKey: string; reading: LanguageReading } =>
                        r.reading !== null,
                )
                .sort((a, b) =>
                    a.serviceKey === hubService ? -1 : b.serviceKey === hubService ? 1 : 0,
                ),
            competitorsWithTownPage: townPagesHeld(place.slug),
            monthly: monthlySeries,
            readOn,
        });
        let evidence: TownEvidence | null = derived;
        if (verified) {
            evidence = {
                level: 'verified',
                justification: justification!,
                localFacts: [...facts, ...(derived?.localFacts ?? [])],
                sources: [source!, ...(derived?.sources ?? [])],
                derived: derived?.derived ?? null,
            };
        }
        const excluded = decision(key, 'build') === 'false';
        pages.push({
            translationKey: key,
            type: 'area',
            parentKey: 'home',
            serviceKey: null,
            placeSlug: place.slug,
            locales: localesFor('area', slugs, primary, supporting, questions, intent, demand),
            clusterIds,
            angle:
                decision(key, 'angle') ??
                areaAngle(
                    place.name[defaultLanguage]?.['nom'] ?? place.slug,
                    evidence?.derived ?? null,
                ),
            evidence: evidence
                ? {
                      level: evidence.level,
                      justification: evidence.justification,
                      localFacts: evidence.localFacts,
                      sources: evidence.sources,
                      derived: evidence.derived,
                  }
                : null,
            linkedFrom: [],
            buildTier: 3,
            status: excluded ? 'not-written' : evidence ? 'planned' : 'blocked',
            notes: evidence
                ? evidence.level === 'derived'
                    ? [
                          'evidence derived from the research data; add a justification, three facts and a source as page decisions to mark it verified',
                      ]
                    : []
                : [
                      'too little derived evidence: add coordinates to the place and the base, or record facts as page decisions',
                  ],
        });
    }

    for (const cluster of guideClusters) {
        const language = cluster.language;
        const foreign = language !== defaultLanguage;
        const slug = slugify(cluster.primaryKeyword);
        const key = foreign ? `guide-${language}-${slug}` : `guide-${slug}`;
        const slugs: Record<string, string> = {};
        const intent: Record<string, string> = {};
        const demand: Record<string, 'measured' | 'witnessed' | 'none'> = {};
        for (const l of config.languages) {
            slugs[l] = slug;
            intent[l] = cluster.intentFinal;
            demand[l] =
                l === language ? (cluster.volumeSum > 0 ? 'measured' : 'witnessed') : 'none';
        }
        const excluded = decision(key, 'build') === 'false';
        pages.push({
            translationKey: key,
            type: 'guide',
            parentKey: cluster.service ?? 'home',
            serviceKey: cluster.service,
            placeSlug: null,
            locales: localesFor(
                'guide',
                slugs,
                { [language]: cluster.primaryKeyword },
                { [language]: membersOf(cluster) },
                { [language]: cluster.questions },
                intent,
                demand,
            ),
            clusterIds: { [language]: cluster.id },
            angle: decision(key, 'angle') ?? guideAngle(cluster),
            evidence: null,
            linkedFrom: [],
            buildTier: 5,
            status: excluded ? 'not-written' : 'planned',
            notes: foreign
                ? [
                      `read in ${language} with no ${defaultLanguage} cluster beside it; the page exists in ${language} only`,
                  ]
                : [],
        });
    }

    const built = pages.filter((p) => p.status !== 'not-written');
    const services = built.filter((p) => p.type === 'service').map((p) => p.translationKey);
    const areas = built.filter((p) => p.type === 'area').map((p) => p.translationKey);
    for (const page of built) {
        if (page.type === 'home') continue;
        const referrers = new Set<string>();
        if (page.type === 'service') {
            referrers.add('home');
            const index = services.indexOf(page.translationKey);
            const sibling = services[(index + 1) % services.length];
            if (sibling && sibling !== page.translationKey) referrers.add(sibling);
            if (referrers.size < 2 && areas[0]) referrers.add(areas[0]);
        } else if (page.type === 'area') {
            referrers.add('home');
            const index = areas.indexOf(page.translationKey);
            const sibling = areas[(index + 1) % areas.length];
            if (sibling && sibling !== page.translationKey) referrers.add(sibling);
            if (referrers.size < 2 && services[0]) referrers.add(services[0]);
        } else if (page.type === 'guide') {
            if (page.serviceKey && services.includes(page.serviceKey))
                referrers.add(page.serviceKey);
            referrers.add('home');
            if (referrers.size < 2 && services[0]) referrers.add(services[0]);
        }
        page.linkedFrom = [...referrers].slice(0, 2);
    }

    const seenPrimary = new Map<string, string>();
    for (const page of built) {
        for (const [language, locale] of Object.entries(page.locales)) {
            if (!locale.primaryKeyword) continue;
            const key = `${language}|${locale.primaryKeyword}`;
            const holder = seenPrimary.get(key);
            if (holder)
                page.notes.push(
                    `primary keyword "${locale.primaryKeyword}" (${language}) is also claimed by ${holder}`,
                );
            else seenPrimary.set(key, page.translationKey);
        }
    }
    for (const service of config.services) {
        if (
            !clusterFor(defaultLanguage, service.key) &&
            service.key !== hubService &&
            decision(service.key, 'build') === 'false'
        ) {
            notWritten.push({ subject: service.key, reason: 'excluded by decision' });
        }
    }

    const budget: Record<string, number | null> = {};
    for (const language of config.languages) {
        const value = thresholds.get(decisionKey(`keywords:${language}`, 'page_budget'))?.value;
        budget[language] = value ? Number(value) : null;
    }

    const plan: Plan = {
        site: {
            slug: config.slug,
            languages: config.languages,
            defaultLanguage,
            generatedAt: now().toISOString(),
            pageBudget: budget,
        },
        services: config.services.map((s) => ({
            key: s.key,
            name: Object.fromEntries(config.languages.map((l) => [l, s.head[l] ?? {}])),
            primaryKeyword: Object.fromEntries(
                config.languages.map((l) => [
                    l,
                    pages.find((p) => p.translationKey === s.key)?.locales[l]?.primaryKeyword ??
                        (s.key === hubService
                            ? (pages[0]?.locales[l]?.primaryKeyword ?? null)
                            : null),
                ]),
            ),
        })),
        places: config.places.map((p) => ({
            slug: p.slug,
            kind: p.kind,
            parent: p.parent ?? null,
            locationCode: p.location_code,
            name: Object.fromEntries(config.languages.map((l) => [l, p.name[l] ?? {}])),
        })),
        pages: pages.sort(
            (a, b) => a.buildTier - b.buildTier || a.translationKey.localeCompare(b.translationKey),
        ),
        notWritten,
    };
    return Plan.parse(plan);
}
