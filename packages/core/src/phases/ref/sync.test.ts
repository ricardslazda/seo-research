import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { DfsClient, MemoryCacheStore, type DfsEnvelope, type Transport } from '@seo/dfs-client';

import { syncReference } from './sync.js';

const envelope = (result: unknown[]): DfsEnvelope => ({
    version: '0.1',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0',
    cost: 0,
    tasks_count: 1,
    tasks_error: 0,
    tasks: [
        {
            id: 't',
            status_code: 20000,
            status_message: 'Ok.',
            time: '0',
            cost: 0,
            result_count: result.length,
            path: [],
            data: {},
            result,
        },
    ],
});

const byPath: Record<string, unknown[]> = {
    '/v3/serp/google/locations/zz': [
        {
            location_code: 2999,
            location_name: 'Testland',
            location_code_parent: null,
            country_iso_code: 'ZZ',
            location_type: 'Country',
        },
        {
            location_code: 1001001,
            location_name: 'Northbridge,Testland',
            location_code_parent: 2999,
            country_iso_code: 'ZZ',
            location_type: 'City',
        },
    ],
    '/v3/keywords_data/google_ads/locations/zz': [
        {
            location_code: 1001001,
            location_name: 'Northbridge,Testland',
            location_code_parent: 2999,
            country_iso_code: 'ZZ',
            location_type: 'City',
        },
    ],
    '/v3/dataforseo_labs/locations_and_languages': [
        {
            location_code: 2999,
            location_name: 'Testland',
            country_iso_code: 'ZZ',
            location_type: 'Country',
            available_languages: [
                { language_name: 'English', language_code: 'en', available_sources: ['google'] },
                { language_name: 'Spanish', language_code: 'es', available_sources: ['bing'] },
            ],
        },
        {
            location_code: 2998,
            location_name: 'Otherland',
            country_iso_code: 'XX',
            location_type: 'Country',
            available_languages: [],
        },
    ],
    '/v3/serp/google/languages': [
        { language_name: 'English', language_code: 'en' },
        { language_name: 'Spanish', language_code: 'es' },
    ],
    '/v3/keywords_data/google_ads/languages': [
        { language_name: 'Spanish', language_code: 'es' },
        { language_name: 'English', language_code: 'en' },
    ],
    '/v3/appendix/user_data': [{ money: { balance: 12.5 }, price: { serp: {} } }],
};

const transport: Transport = {
    async send(_method, path) {
        const result = byPath[path];
        if (!result) throw new Error(`unexpected ${path}`);
        return { httpStatus: 200, envelope: envelope(result), attempts: 1 };
    },
};

describe('syncReference', () => {
    it('writes the location index, the support matrix and the prices', async () => {
        const dir = mkdtempSync(join(tmpdir(), 'seo-ref-'));
        const client = new DfsClient({ transport, store: new MemoryCacheStore() });
        const summary = await syncReference(client, {
            countries: ['zz'],
            referenceDir: dir,
            now: () => new Date('2026-09-02T00:00:00Z'),
        });
        expect(summary).toEqual({
            countries: { ZZ: { locations: 2, labs: ['en'] } },
            global: { serp: 2, ads: 2 },
            balance: 12.5,
        });
        const locations = JSON.parse(readFileSync(join(dir, 'locations.json'), 'utf8')) as Record<
            string,
            { sources: string[] }
        >;
        expect(locations['1001001']?.sources).toEqual(['serp', 'ads']);
        expect(locations['2999']?.sources).toEqual(['serp', 'labs']);
        const support = JSON.parse(readFileSync(join(dir, 'language-support.json'), 'utf8')) as {
            global: { serp: string[]; ads: string[] };
            countries: Record<string, { labs: string[] }>;
            intentLanguages: string[];
        };
        expect(support.global).toEqual({ serp: ['en', 'es'], ads: ['en', 'es'] });
        expect(support.countries['ZZ']).toEqual({ labs: ['en'] });
        expect(support.intentLanguages).toContain('en');
        expect(support.intentLanguages).not.toContain('ga');
        const prices = JSON.parse(readFileSync(join(dir, 'prices.json'), 'utf8')) as {
            syncedAt: string;
            price: Record<string, unknown>;
        };
        expect(prices.syncedAt).toBe('2026-09-02T00:00:00.000Z');
        expect(prices.price).toEqual({ serp: {} });
        expect(readFileSync(join(dir, 'prices.json'), 'utf8')).not.toContain('balance');
    });
});
