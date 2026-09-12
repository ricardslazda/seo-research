import type { EndpointDef } from '../endpoint.js';
import { adsKeywordsForKeywordsEndpoint } from './ads-keywords-for-keywords.js';
import { adsKeywordsForSiteEndpoint } from './ads-keywords-for-site.js';
import {
    labsBulkKeywordDifficultyEndpoint,
    labsKeywordIdeasEndpoint,
    labsKeywordSuggestionsEndpoint,
    labsSearchIntentEndpoint,
} from './labs-keyword-expansion.js';
import { adsSearchVolumeEndpoint } from './ads-search-volume.js';
import { labsRankedKeywordsEndpoint } from './labs-ranked-keywords.js';
import { labsRelevantPagesEndpoint } from './labs-relevant-pages.js';
import { onPageContentParsingEndpoint } from './onpage-content-parsing.js';
import { bulkReferringDomainsEndpoint } from './backlinks-bulk-referring-domains.js';
import { backlinksReferringDomainsEndpoint } from './backlinks-referring-domains.js';
import { businessListingsEndpoint } from './business-listings.js';
import {
    adsLanguagesEndpoint,
    labsLocationsAndLanguagesEndpoint,
    serpLanguagesEndpoint,
    userDataEndpoint,
} from './reference.js';
import { serpOrganicEndpoint } from './serp-organic.js';

export type AnyEndpoint = EndpointDef<Record<string, unknown>, unknown>;

const all: AnyEndpoint[] = [
    adsSearchVolumeEndpoint,
    serpOrganicEndpoint,
    bulkReferringDomainsEndpoint,
    backlinksReferringDomainsEndpoint,
    businessListingsEndpoint,
    labsRankedKeywordsEndpoint,
    labsRelevantPagesEndpoint,
    onPageContentParsingEndpoint,
    adsKeywordsForSiteEndpoint,
    adsKeywordsForKeywordsEndpoint,
    labsKeywordSuggestionsEndpoint,
    labsKeywordIdeasEndpoint,
    labsBulkKeywordDifficultyEndpoint,
    labsSearchIntentEndpoint,
    labsLocationsAndLanguagesEndpoint,
    serpLanguagesEndpoint,
    adsLanguagesEndpoint,
    userDataEndpoint,
] as unknown as AnyEndpoint[];

export function listEndpoints(): AnyEndpoint[] {
    return [...all];
}

export function findEndpoint(name: string): AnyEndpoint | undefined {
    return all.find((endpoint) => endpoint.name === name);
}
