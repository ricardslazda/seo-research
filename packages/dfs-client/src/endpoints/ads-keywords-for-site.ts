import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';
import { AdsSearchVolumeRow } from './ads-search-volume.js';

export interface AdsKeywordsForSiteRequest {
    target: string;
    location_code: number;
    language_code: string;
    target_type?: 'site' | 'page';
    sort_by?:
        | 'relevance'
        | 'search_volume'
        | 'competition_index'
        | 'low_top_of_page_bid'
        | 'high_top_of_page_bid';
    include_adult_keywords?: boolean;
    search_partners?: boolean;
}

export const adsKeywordsForSiteEndpoint = defineEndpoint<
    AdsKeywordsForSiteRequest,
    AdsSearchVolumeRow
>({
    name: 'ads.keywords_for_site',
    path: '/v3/keywords_data/google_ads/keywords_for_site/live',
    method: 'POST',
    family: 'ads',
    defaults: { target_type: 'site', sort_by: 'relevance', search_partners: false },
    unorderedArrays: [],
    price: () => 0.075,
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(AdsSearchVolumeRow).parse(task.result ?? []),
});
