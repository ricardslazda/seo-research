import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { parse } from 'yaml';
import { z } from 'zod';

const Slug = z.string().regex(/^[a-z0-9-]+$/, 'must be lowercase letters, digits and dashes');
const LanguageCode = z.string().regex(/^[a-z]{2}$/, 'must be a two-letter language code');
const Forms = z.record(z.string(), z.string().min(1));

export const HeadForm = z.object({
    term: z.string().min(1),
    place: z.string().min(1),
});

const Slugs = z.record(LanguageCode, Slug);

export const Coordinates = z.object({
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
});

const Pattern = z.string().min(1);
const VocabularyKey = z.string().regex(/^[a-z_]+$/, 'must be lowercase letters and underscores');
const CountryIso = z.string().regex(/^[A-Z]{2}$/, 'must be a two-letter uppercase country code');
const CurrencyCode = z
    .string()
    .regex(/^[A-Z]{3}$/, 'must be a three-letter uppercase currency code');
const Tld = z.string().regex(/^\.[a-z0-9.-]+$/, 'must be a lowercase domain ending with its dot');

// Facts about the country the site sells in. Each has a fallback, so a site states only what the
// fallback gets wrong: the country comes from the first place's location otherwise.
export const MarketConfig = z.object({
    country: CountryIso.optional(),
    currency: CurrencyCode.optional(),
    currency_marks: z.array(z.string().min(1)).default([]),
    phone_pattern: Pattern.optional(),
    home_tlds: z.array(Tld).optional(),
    ignore_countries: z.array(CountryIso).default([]),
});

export const DEFAULT_PATH_WORDS = { services: 'services', guides: 'guides' } as const;

export const PathWords = z.object({
    services: Slug.default(DEFAULT_PATH_WORDS.services),
    guides: Slug.default(DEFAULT_PATH_WORDS.guides),
});

export const ServiceArea = z.object({
    base: Slug.optional(),
    free_km: z.number().nonnegative().default(0),
    per_km: z.number().nonnegative().optional(),
    road_factor: z.number().min(1).max(2).default(1.25),
    average_kmh: z.number().positive().default(50),
    response_promise: z.record(LanguageCode, z.string().min(1)).optional(),
    listing_categories: z.array(z.string().min(1)).optional(),
    listing_radius_km: z.number().positive().default(10),
    listing_match: Pattern.optional(),
});

// The trade's words, written folded: ASCII letters, Cyrillic transliterated, as the keyword
// rules see them. Stems match the start of a word; a stem with a space matches anywhere. The two
// path patterns extend the English defaults that read a URL path as a listing or a guide.
export const VocabularyConfig = z.object({
    topic_stems: z.array(z.string().min(1)).default([]),
    non_distinctive: z.array(z.string().min(1)).default([]),
    brands: z.array(z.string().min(1)).default([]),
    exclusions: z.record(VocabularyKey, Pattern).default({}),
    out_of_area: Pattern.optional(),
    near: Pattern.optional(),
    modifiers: z.record(VocabularyKey, Pattern).default({}),
    directory_paths: Pattern.optional(),
    guide_paths: Pattern.optional(),
});

const RULE_EXCLUSIONS = ['brand', 'out_of_area', 'off_topic'];
const RULE_MODIFIERS = ['place'];

function patternProblem(source: string): string | null {
    try {
        new RegExp(source, 'i');
        return null;
    } catch (error) {
        return error instanceof Error ? error.message : String(error);
    }
}

export const PlaceConfig = z.object({
    slug: Slug,
    location_code: z.number().int().positive(),
    kind: z.enum(['city', 'district']).default('city'),
    parent: Slug.optional(),
    name: z.record(LanguageCode, Forms),
    slugs: Slugs.optional(),
    coordinates: Coordinates.optional(),
    volume_scope: z.enum(['city', 'country']).default('city'),
});

export const ServiceConfig = z.object({
    key: Slug,
    head: z.record(LanguageCode, Forms),
    slugs: Slugs.optional(),
});

export const SiteConfig = z
    .object({
        slug: Slug,
        languages: z.array(LanguageCode).min(1),
        places: z.array(PlaceConfig).min(1),
        services: z.array(ServiceConfig).min(1),
        head_forms: z.record(LanguageCode, z.array(HeadForm).min(1)),
        market: MarketConfig.prefault({}),
        paths: z.record(LanguageCode, PathWords).default({}),
        service_area: ServiceArea.optional(),
        vocabulary: VocabularyConfig.optional(),
        spend_ask_above_usd: z.number().nonnegative().default(3),
        domain: z
            .string()
            .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/)
            .optional(),
        business_name: z.string().min(1).optional(),
    })
    .superRefine((config, ctx) => {
        for (const language of config.languages) {
            const forms = config.head_forms[language];
            if (!forms) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['head_forms', language],
                    message: `no head forms for "${language}"`,
                });
                continue;
            }
            for (const [formIndex, form] of forms.entries()) {
                for (const [serviceIndex, service] of config.services.entries()) {
                    if (!service.head[language]?.[form.term]) {
                        ctx.addIssue({
                            code: 'custom',
                            path: ['services', serviceIndex, 'head', language, form.term],
                            message: `service "${service.key}" has no "${form.term}" form in "${language}" (needed by head_forms.${language}[${formIndex}])`,
                        });
                    }
                }
                for (const [placeIndex, place] of config.places.entries()) {
                    if (!place.name[language]?.[form.place]) {
                        ctx.addIssue({
                            code: 'custom',
                            path: ['places', placeIndex, 'name', language, form.place],
                            message: `place "${place.slug}" has no "${form.place}" form in "${language}" (needed by head_forms.${language}[${formIndex}])`,
                        });
                    }
                }
            }
        }
        const slugs = new Set(config.places.map((place) => place.slug));
        if (config.service_area?.base && !slugs.has(config.service_area.base)) {
            ctx.addIssue({
                code: 'custom',
                path: ['service_area', 'base'],
                message: `unknown base place "${config.service_area.base}"`,
            });
        }
        for (const [placeIndex, place] of config.places.entries()) {
            if (place.parent && !slugs.has(place.parent)) {
                ctx.addIssue({
                    code: 'custom',
                    path: ['places', placeIndex, 'parent'],
                    message: `unknown parent "${place.parent}"`,
                });
            }
        }
        const checkPattern = (path: (string | number)[], source: string | undefined): void => {
            if (source === undefined) return;
            const problem = patternProblem(source);
            if (problem)
                ctx.addIssue({ code: 'custom', path, message: `not a pattern: ${problem}` });
        };
        checkPattern(['service_area', 'listing_match'], config.service_area?.listing_match);
        checkPattern(['market', 'phone_pattern'], config.market.phone_pattern);
        if (config.service_area?.per_km !== undefined && !config.market.currency) {
            ctx.addIssue({
                code: 'custom',
                path: ['service_area', 'per_km'],
                message: 'a per-km charge needs market.currency to name its unit',
            });
        }
        if (config.vocabulary) {
            for (const [reason, source] of Object.entries(config.vocabulary.exclusions)) {
                if (RULE_EXCLUSIONS.includes(reason)) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['vocabulary', 'exclusions', reason],
                        message: `"${reason}" is decided by a rule, not a pattern`,
                    });
                }
                checkPattern(['vocabulary', 'exclusions', reason], source);
            }
            for (const [name, source] of Object.entries(config.vocabulary.modifiers)) {
                if (RULE_MODIFIERS.includes(name)) {
                    ctx.addIssue({
                        code: 'custom',
                        path: ['vocabulary', 'modifiers', name],
                        message: `"${name}" is decided by a rule from the place names and vocabulary.near`,
                    });
                }
                checkPattern(['vocabulary', 'modifiers', name], source);
            }
            checkPattern(['vocabulary', 'out_of_area'], config.vocabulary.out_of_area);
            checkPattern(['vocabulary', 'near'], config.vocabulary.near);
            checkPattern(['vocabulary', 'directory_paths'], config.vocabulary.directory_paths);
            checkPattern(['vocabulary', 'guide_paths'], config.vocabulary.guide_paths);
        }
    });

export type SiteConfig = z.infer<typeof SiteConfig>;
export type PlaceConfig = z.infer<typeof PlaceConfig>;
export type ServiceConfig = z.infer<typeof ServiceConfig>;
export type HeadForm = z.infer<typeof HeadForm>;
export type VocabularyConfig = z.infer<typeof VocabularyConfig>;
export type MarketConfig = z.infer<typeof MarketConfig>;
export type PathWords = z.infer<typeof PathWords>;

export const SITE_CONFIG_FILE = 'site.config.yaml';
export const SITE_DATABASE_FILE = 'research.sqlite';

export class SiteConfigError extends Error {
    constructor(
        readonly file: string,
        readonly issues: string[],
    ) {
        super(`${file} is not a valid site config:\n  ${issues.join('\n  ')}`);
        this.name = 'SiteConfigError';
    }
}

export function parseSiteConfig(source: unknown, file = SITE_CONFIG_FILE): SiteConfig {
    const result = SiteConfig.safeParse(source);
    if (result.success) return result.data;
    const issues = result.error.issues.map(
        (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new SiteConfigError(file, issues);
}

export function loadSiteConfig(siteDir: string): SiteConfig {
    const file = join(siteDir, SITE_CONFIG_FILE);
    return parseSiteConfig(parse(readFileSync(file, 'utf8')), file);
}

export function siteDatabasePath(siteDir: string): string {
    return join(siteDir, SITE_DATABASE_FILE);
}
