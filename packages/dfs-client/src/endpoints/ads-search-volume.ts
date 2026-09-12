import { z } from 'zod';

import { chunk, isAdsSafeKeyword, keywordKey, uniqueKeywords, type BatchResult } from '../batch.js';
import type { CallOptions, DfsClient } from '../client.js';
import { defineEndpoint } from '../endpoint.js';

export const MonthlySearch = z.object({
    year: z.number(),
    month: z.number(),
    search_volume: z.number(),
});

export const AdsSearchVolumeRow = z.looseObject({
    keyword: z.string(),
    search_volume: z.number().nullable(),
    competition: z.string().nullable(),
    competition_index: z.number().nullable(),
    cpc: z.number().nullable(),
    low_top_of_page_bid: z.number().nullable(),
    high_top_of_page_bid: z.number().nullable(),
    monthly_searches: z.array(MonthlySearch).nullable(),
});
export type AdsSearchVolumeRow = z.infer<typeof AdsSearchVolumeRow>;

export interface AdsSearchVolumeRequest {
    keywords: string[];
    location_code: number;
    language_code: string;
    search_partners?: boolean;
    date_from?: string;
    date_to?: string;
}

export const ADS_SEARCH_VOLUME_MAX_KEYWORDS = 1000;

export const adsSearchVolumeEndpoint = defineEndpoint<AdsSearchVolumeRequest, AdsSearchVolumeRow>({
    name: 'ads.search_volume',
    path: '/v3/keywords_data/google_ads/search_volume/live',
    method: 'POST',
    family: 'ads',
    defaults: { search_partners: false },
    unorderedArrays: ['keywords'],
    price: () => 0.09,
    gate: (request) => ({
        locationCode: request.location_code,
        languageCode: request.language_code,
    }),
    parse: (task) => z.array(AdsSearchVolumeRow).parse(task.result ?? []),
});

export async function adsSearchVolume(
    client: DfsClient,
    request: AdsSearchVolumeRequest,
    options: CallOptions = {},
): Promise<BatchResult<AdsSearchVolumeRow>> {
    const sent = uniqueKeywords(request.keywords).filter(isAdsSafeKeyword);
    const result: BatchResult<AdsSearchVolumeRow> = {
        rows: [],
        missing: [],
        rawIds: [],
        cost: 0,
        cachedCalls: 0,
    };
    for (const keywords of chunk(sent, ADS_SEARCH_VOLUME_MAX_KEYWORDS)) {
        const call = await client.call(adsSearchVolumeEndpoint, { ...request, keywords }, options);
        result.rows.push(...call.rows);
        result.rawIds.push(call.rawId);
        result.cost += call.cost;
        if (call.cached) result.cachedCalls++;
    }
    const got = new Set(result.rows.map((row) => keywordKey(row.keyword)));
    result.missing = sent.filter((keyword) => !got.has(keywordKey(keyword)));
    return result;
}
