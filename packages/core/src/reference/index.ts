import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LanguageSupport, LocationIndex } from '@seo/dfs-client';

export interface Prices {
    syncedAt: string;
    price: Record<string, unknown> | null;
}

export type KnownDomainKind =
    'directory' | 'classifieds' | 'jobs' | 'social' | 'marketplace' | 'government';
export type KnownDomains = Partial<Record<KnownDomainKind, string[]>>;

export interface Reference {
    locations: LocationIndex;
    support: LanguageSupport;
    prices: Prices | null;
    domains: Record<string, KnownDomains>;
}

export const REFERENCE_FILES = {
    locations: 'locations.json',
    support: 'language-support.json',
    prices: 'prices.json',
} as const;

export function defaultReferenceDir(): string {
    return fileURLToPath(new URL('../../../../reference/', import.meta.url));
}

function readJson<T>(file: string): T | undefined {
    if (!existsSync(file)) return undefined;
    return JSON.parse(readFileSync(file, 'utf8')) as T;
}

export function readReference(dir = defaultReferenceDir()): Reference | undefined {
    const locations = readJson<LocationIndex>(join(dir, REFERENCE_FILES.locations));
    const support = readJson<LanguageSupport>(join(dir, REFERENCE_FILES.support));
    if (!locations || !support) return undefined;
    const prices = readJson<Prices>(join(dir, REFERENCE_FILES.prices)) ?? null;
    const domains: Record<string, KnownDomains> = {};
    for (const file of readdirSync(dir)) {
        const match = /^domains\.([a-z]{2})\.json$/.exec(file);
        if (match?.[1])
            domains[match[1].toUpperCase()] = readJson<KnownDomains>(join(dir, file)) ?? {};
    }
    return { locations, support, prices, domains };
}

// The known domains of one country, from reference/domains.<cc>.json; none when the file is absent.
export function domainsFor(reference: Reference, countryIso: string): KnownDomains {
    return reference.domains[countryIso.toUpperCase()] ?? {};
}

export function writeReference(reference: Reference, dir = defaultReferenceDir()): void {
    mkdirSync(dir, { recursive: true });
    const write = (name: string, value: unknown) =>
        writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + '\n');
    write(REFERENCE_FILES.locations, reference.locations);
    write(REFERENCE_FILES.support, reference.support);
    if (reference.prices) write(REFERENCE_FILES.prices, reference.prices);
}
