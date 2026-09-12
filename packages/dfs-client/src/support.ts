import type { Family, PairRequest } from './endpoint.js';
import type { Gate } from './client.js';

export interface LocationEntry {
    code: number;
    name: string;
    type: string;
    parent: number | null;
    countryIso: string;
    sources: string[];
}

export type LocationIndex = Record<string, LocationEntry>;

export type FamilySupport = Partial<Record<Family, string[]>>;

export interface LanguageSupport {
    global: FamilySupport;
    countries: Record<string, FamilySupport>;
    intentLanguages: string[];
}

export class UnknownLocationError extends Error {
    constructor(readonly locationCode: number) {
        super(`location ${locationCode} is not in the reference index; run "seo ref sync"`);
        this.name = 'UnknownLocationError';
    }
}

export class UnsupportedPairError extends Error {
    constructor(
        readonly family: Family,
        readonly countryIso: string,
        readonly pair: PairRequest,
    ) {
        super(
            `${family} endpoints do not support language "${pair.languageCode}" in ${countryIso} (location ${pair.locationCode})`,
        );
        this.name = 'UnsupportedPairError';
    }
}

export function createGate(support: LanguageSupport, locations: LocationIndex): Gate {
    return (family, pair) => {
        const location = locations[String(pair.locationCode)];
        if (!location) throw new UnknownLocationError(pair.locationCode);
        const languages =
            support.countries[location.countryIso]?.[family] ?? support.global[family];
        if (!languages) return;
        if (!languages.includes(pair.languageCode)) {
            throw new UnsupportedPairError(family, location.countryIso, pair);
        }
    };
}
