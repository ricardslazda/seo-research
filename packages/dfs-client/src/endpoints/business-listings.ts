import { z } from 'zod';

import { defineEndpoint } from '../endpoint.js';

export const ListingRating = z.looseObject({
    value: z.number().nullable().optional(),
    votes_count: z.number().nullable().optional(),
    rating_max: z.number().nullable().optional(),
});

export const ListingItem = z.looseObject({
    type: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    description: z.string().nullable().optional(),
    category: z.string().nullable().optional(),
    category_ids: z.array(z.string()).nullable().optional(),
    additional_categories: z.array(z.string()).nullable().optional(),
    cid: z.string().nullable().optional(),
    place_id: z.string().nullable().optional(),
    domain: z.string().nullable().optional(),
    url: z.string().nullable().optional(),
    phone: z.string().nullable().optional(),
    address: z.string().nullable().optional(),
    address_info: z.record(z.string(), z.unknown()).nullable().optional(),
    latitude: z.number().nullable().optional(),
    longitude: z.number().nullable().optional(),
    is_claimed: z.boolean().nullable().optional(),
    rating: ListingRating.nullable().optional(),
    total_photos: z.number().nullable().optional(),
    first_seen: z.string().nullable().optional(),
    last_updated_time: z.string().nullable().optional(),
});
export type ListingItem = z.infer<typeof ListingItem>;

export const BusinessListingsResult = z.looseObject({
    total_count: z.number().nullable().optional(),
    count: z.number().nullable().optional(),
    offset: z.number().nullable().optional(),
    offset_token: z.string().nullable().optional(),
    items: z.array(ListingItem).nullable().optional(),
});
export type BusinessListingsResult = z.infer<typeof BusinessListingsResult>;

export interface BusinessListingsRequest {
    categories?: string[];
    title?: string;
    description?: string;
    location_coordinate: string;
    is_claimed?: boolean;
    limit?: number;
    offset?: number;
    order_by?: string[];
    filters?: unknown[];
}

export const businessListingsEndpoint = defineEndpoint<
    BusinessListingsRequest,
    BusinessListingsResult
>({
    name: 'business.listings',
    path: '/v3/business_data/business_listings/search/live',
    method: 'POST',
    family: 'labs',
    defaults: { limit: 100, order_by: ['rating.votes_count,desc'] },
    unorderedArrays: ['categories'],
    price: () => 0.0109,
    gate: () => null,
    parse: (task) => z.array(BusinessListingsResult).parse(task.result ?? []),
});
