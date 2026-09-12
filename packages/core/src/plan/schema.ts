import { z } from 'zod';

const LanguageCode = z.string().regex(/^[a-z]{2}$/);
const Key = z.string().regex(/^[a-z0-9-]+$/);

export const PlanLocale = z.object({
    path: z.string().regex(/^\//),
    primaryKeyword: z.string().nullable(),
    supportingKeywords: z.array(z.string()),
    intent: z.string().min(1),
    questions: z.array(z.string()),
    demand: z.enum(['measured', 'witnessed', 'none']),
});

export const PlanDerivedEvidence = z.object({
    distanceKm: z.number().nullable(),
    travelMinutes: z.number().nullable(),
    freeTravel: z.boolean().nullable(),
    surchargePerKm: z.number().nullable(),
    currency: z.string().nullable(),
    servicesWithDemand: z.array(z.string()),
    competitorsWithTownPage: z.array(z.string()),
    packSize: z.number().nullable(),
    packMedianReviews: z.number().nullable(),
    firstOrganicRank: z.number().nullable(),
    peakMonths: z.array(z.string()),
    troughMonth: z.string().nullable(),
});

export const PlanEvidence = z.object({
    level: z.enum(['derived', 'verified']),
    justification: z.string().min(40),
    localFacts: z.array(z.string().min(40)).min(3),
    sources: z.array(z.string().min(1)).min(1),
    derived: PlanDerivedEvidence.nullable(),
});

export const PlanPage = z.object({
    translationKey: Key,
    type: z.enum(['home', 'service', 'area', 'intersection', 'guide', 'standalone']),
    parentKey: Key.nullable(),
    serviceKey: Key.nullable(),
    placeSlug: Key.nullable(),
    locales: z.record(LanguageCode, PlanLocale),
    clusterIds: z.record(LanguageCode, z.number().int().nullable()),
    angle: z.string().nullable(),
    evidence: PlanEvidence.nullable(),
    linkedFrom: z.array(Key),
    buildTier: z.number().int().min(1).max(5),
    status: z.enum(['planned', 'blocked', 'not-written']),
    notes: z.array(z.string()),
});

export const Plan = z.object({
    site: z.object({
        slug: Key,
        languages: z.array(LanguageCode).min(1),
        defaultLanguage: LanguageCode,
        generatedAt: z.iso.datetime(),
        pageBudget: z.record(LanguageCode, z.number().int().nullable()),
    }),
    services: z.array(
        z.object({
            key: Key,
            name: z.record(LanguageCode, z.record(z.string(), z.string())),
            primaryKeyword: z.record(LanguageCode, z.string().nullable()),
        }),
    ),
    places: z.array(
        z.object({
            slug: Key,
            kind: z.enum(['city', 'district']),
            parent: Key.nullable(),
            locationCode: z.number().int(),
            name: z.record(LanguageCode, z.record(z.string(), z.string())),
        }),
    ),
    pages: z.array(PlanPage),
    notWritten: z.array(z.object({ subject: z.string(), reason: z.string() })),
});

export type Plan = z.infer<typeof Plan>;
export type PlanPage = z.infer<typeof PlanPage>;
export type PlanLocale = z.infer<typeof PlanLocale>;

export function planJsonSchema(): Record<string, unknown> {
    return z.toJSONSchema(Plan, { target: 'draft-2020-12' }) as Record<string, unknown>;
}
