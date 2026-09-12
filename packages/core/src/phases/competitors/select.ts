import { countryIsoFor } from '../../config/market.js';
import type { SiteConfig } from '../../config/site-config.js';
import type { Db } from '../../db/open.js';
import { decisionKey } from '../../decisions.js';
import { domainsFor, type Reference } from '../../reference/index.js';
import { loadScreen } from '../screen/load.js';
import {
    NON_BUSINESS_KINDS,
    domainBreadth,
    knownKind,
    knownKinds,
    type DomainKind,
} from '../screen/rules.js';

export interface CompetitorCandidate {
    domain: string;
    kind: DomainKind;
    pages: number;
    services: number;
    places: number;
    referringDomains: number | null;
    explicit: boolean;
}

export interface SelectOptions {
    domains?: string[];
    minPages?: number;
    max?: number;
}

export function selectCompetitors(
    db: Db,
    config: SiteConfig,
    reference: Reference,
    options: SelectOptions = {},
): CompetitorCandidate[] {
    const data = loadScreen(db, config, reference);
    const breadth = domainBreadth(data);
    const known = knownKinds(domainsFor(reference, countryIsoFor(config, reference)));
    const kindOf = (domain: string): DomainKind =>
        (data.decisions.domain.get(decisionKey(domain, 'kind'))?.value as DomainKind | undefined) ??
        knownKind(known, domain) ??
        'unknown';
    const excluded = new Set(
        [...data.decisions.domain.values()]
            .filter((d) => d.kind === 'competitor' && d.value === 'false')
            .map((d) => d.subjectId),
    );
    const entry = (domain: string, explicit: boolean): CompetitorCandidate => ({
        domain,
        kind: kindOf(domain),
        pages: breadth.get(domain)?.pages ?? 0,
        services: breadth.get(domain)?.services ?? 0,
        places: breadth.get(domain)?.places ?? 0,
        referringDomains: data.domains.get(domain)?.referringDomains ?? null,
        explicit,
    });
    if (options.domains && options.domains.length > 0) {
        return options.domains.map((domain) => entry(domain.toLowerCase(), true));
    }
    const minPages = options.minPages ?? 5;
    const max = options.max ?? 12;
    return [...breadth.entries()]
        .filter(([domain, b]) => {
            const listed = knownKind(known, domain);
            return (
                b.pages >= minPages &&
                !excluded.has(domain) &&
                !NON_BUSINESS_KINDS.includes(kindOf(domain)) &&
                (listed === undefined || !NON_BUSINESS_KINDS.includes(listed))
            );
        })
        .sort((a, b) => b[1].pages - a[1].pages || a[0].localeCompare(b[0]))
        .slice(0, max)
        .map(([domain]) => entry(domain, false));
}
