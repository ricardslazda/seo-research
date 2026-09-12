import type { PlaceConfig, SiteConfig } from '../config/site-config.js';
import type { LanguageReading } from '../phases/screen/readings.js';

export interface DerivedEvidence {
    distanceKm: number | null;
    travelMinutes: number | null;
    freeTravel: boolean | null;
    surchargePerKm: number | null;
    currency: string | null;
    servicesWithDemand: string[];
    competitorsWithTownPage: string[];
    packSize: number | null;
    packMedianReviews: number | null;
    firstOrganicRank: number | null;
    peakMonths: string[];
    troughMonth: string | null;
}

export interface TownEvidence {
    level: 'derived' | 'verified';
    justification: string;
    localFacts: string[];
    sources: string[];
    derived: DerivedEvidence | null;
}

export function haversineKm(
    a: { lat: number; lng: number },
    b: { lat: number; lng: number },
): number {
    const toRad = (deg: number) => (deg * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const h =
        Math.sin(dLat / 2) ** 2 +
        Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(h));
}

const MONTHS = [
    'January',
    'February',
    'March',
    'April',
    'May',
    'June',
    'July',
    'August',
    'September',
    'October',
    'November',
    'December',
];

export function seasonality(monthly: { month: number; search_volume: number }[][]): {
    peakMonths: string[];
    troughMonth: string | null;
} {
    const sums = new Array<number>(12).fill(0);
    let any = false;
    for (const series of monthly) {
        for (const point of series) {
            if (point.month >= 1 && point.month <= 12) {
                sums[point.month - 1] = (sums[point.month - 1] ?? 0) + point.search_volume;
                any = true;
            }
        }
    }
    if (!any) return { peakMonths: [], troughMonth: null };
    const ranked = sums.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    return {
        peakMonths: ranked.slice(0, 3).map((r) => MONTHS[r.i]!),
        troughMonth: MONTHS[ranked[ranked.length - 1]!.i] ?? null,
    };
}

export interface TownInputs {
    config: SiteConfig;
    place: PlaceConfig;
    readings: { serviceKey: string; reading: LanguageReading }[];
    competitorsWithTownPage: string[];
    monthly: { month: number; search_volume: number }[][];
    readOn: string;
}

function nameOf(place: PlaceConfig, language: string): string {
    return place.name[language]?.['nom'] ?? place.slug;
}

export function deriveTownEvidence(inputs: TownInputs): TownEvidence | null {
    const { config, place, readings } = inputs;
    const language = config.languages[0]!;
    const area = config.service_area;
    const base = area?.base ? config.places.find((p) => p.slug === area.base) : config.places[0];
    const facts: string[] = [];
    const sources = new Set<string>();
    const derived: DerivedEvidence = {
        distanceKm: null,
        travelMinutes: null,
        freeTravel: null,
        surchargePerKm: null,
        currency: null,
        servicesWithDemand: [],
        competitorsWithTownPage: inputs.competitorsWithTownPage,
        packSize: null,
        packMedianReviews: null,
        firstOrganicRank: null,
        peakMonths: [],
        troughMonth: null,
    };
    const town = nameOf(place, language);

    if (base && base.coordinates && place.coordinates && base.slug !== place.slug) {
        const straight = haversineKm(base.coordinates, place.coordinates);
        const road = Math.round(straight * (area?.road_factor ?? 1.25));
        const minutes = Math.round((road / (area?.average_kmh ?? 50)) * 60) + 10;
        derived.distanceKm = road;
        derived.travelMinutes = minutes;
        const freeKm = area?.free_km ?? 0;
        derived.freeTravel = road <= freeKm;
        if (area?.per_km !== undefined) {
            derived.surchargePerKm = area.per_km;
            derived.currency = config.market.currency ?? null;
        }
        const travel = derived.freeTravel
            ? `travel is free within ${freeKm} km`
            : derived.surchargePerKm !== null
              ? `travel beyond ${freeKm} km is charged at ${derived.surchargePerKm} ${derived.currency} per km`
              : `travel beyond ${freeKm} km is quoted with the job`;
        facts.push(
            `${town} is about ${road} km by road from ${nameOf(base, language)}, roughly ${minutes} minutes each way, and ${travel}.`,
        );
        sources.add(
            'coordinates in the site config and the service-area policy; distances computed, not measured',
        );
    }

    const withDemand = readings.filter(
        ({ reading }) =>
            (typeof reading.volume === 'number' && reading.volume > 0) ||
            reading.pack !== null ||
            reading.top10.some((t) => t.purposeBuilt),
    );
    derived.servicesWithDemand = [...new Set(withDemand.map((r) => r.serviceKey))];
    if (derived.servicesWithDemand.length > 0) {
        facts.push(
            `${derived.servicesWithDemand.length} of the ${config.services.length} services show demand in ${town} on the result pages read on ${inputs.readOn}: ${derived.servicesWithDemand.slice(0, 6).join(', ')}.`,
        );
        sources.add(`DataForSEO mobile result pages for ${town}, read on ${inputs.readOn}`);
    }

    const packs = readings
        .map((r) => r.reading.pack)
        .filter((p): p is NonNullable<LanguageReading['pack']> => p !== null);
    if (packs.length > 0) {
        const biggest = [...packs].sort((a, b) => b.size - a.size)[0]!;
        derived.packSize = biggest.size;
        derived.packMedianReviews = biggest.medianReviews;
    }
    const hub = readings[0]?.reading ?? null;
    derived.firstOrganicRank = hub?.firstOrganicRank ?? null;
    const held = inputs.competitorsWithTownPage;
    const packText =
        derived.packSize !== null
            ? `the local pack shows ${derived.packSize} listings with a median of ${derived.packMedianReviews ?? 0} reviews`
            : 'no local pack appears';
    facts.push(
        `${held.length === 0 ? 'No other site holds' : `${held.length} other site${held.length === 1 ? ' holds' : 's hold'}`} a page written for ${town} in the top ten${held.length > 0 ? ` (${held.slice(0, 4).join(', ')})` : ''}, and ${packText}.`,
    );
    sources.add(`DataForSEO mobile result pages for ${town}, read on ${inputs.readOn}`);

    const season = seasonality(inputs.monthly);
    derived.peakMonths = season.peakMonths;
    derived.troughMonth = season.troughMonth;
    if (season.peakMonths.length > 0) {
        facts.push(
            `Search demand for these services in the market peaks in ${season.peakMonths.join(', ')} and is lowest in ${season.troughMonth ?? 'winter'}, by Google Ads monthly volumes.`,
        );
        sources.add('Google Ads monthly search volumes over the last twelve months');
    }

    if (facts.length < 3) return null;
    const justification = `${town}: ${derived.distanceKm !== null ? `${derived.distanceKm} km from base, ` : ''}${held.length} competitor page${held.length === 1 ? '' : 's'} to beat and ${derived.packSize !== null ? `a pack of ${derived.packSize}` : 'an empty pack'}; ${derived.servicesWithDemand.length} services with demand here.`;
    return {
        level: 'derived',
        justification:
            justification.length >= 40
                ? justification
                : `${justification} A page for ${town} is justified by what the result pages show.`,
        localFacts: facts.map((f) =>
            f.length >= 40 ? f : `${f} (recorded from the research data)`,
        ),
        sources: [...sources],
        derived,
    };
}
