import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';
import { AdsSearchVolumeRow } from './ads-search-volume.js';

export interface AdsKeywordsForKeywordsRequest {
    keywords: string[];
    location_code: number;
    language_code: string;
    sort_by?:
        | 'relevance'
        | 'search_volume'
        | 'competition_index'
        | 'low_top_of_page_bid'
        | 'high_top_of_page_bid';
    include_adult_keywords?: boolean;
    search_partners?: boolean;
}

export const ADS_KEYWORDS_FOR_KEYWORDS_MAX_SEEDS = 20;

export const adsKeywordsForKeywordsEndpoint = defineEndpoint<
    AdsKeywordsForKeywordsRequest,
    AdsSearchVolumeRow
>({
    name: 'ads.keywords_for_keywords',
    path: '/v3/keywords_data/google_ads/keywords_for_keywords/live',
    method: 'POST',
    family: 'ads',
    defaults: { sort_by: 'search_volume', search_partners: false },
    unorderedArrays: ['keywords'],
    price: () => 0.09,
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(AdsSearchVolumeRow).parse(task.result ?? []),
});
