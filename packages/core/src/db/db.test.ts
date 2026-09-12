import { describe, expect, it } from 'vitest';

import { SqliteCacheStore } from './cache-store.js';
import { openDatabase } from './open.js';

const record = (taskStatusCode: number, fetchedAt: string) => ({
    runId: null,
    endpoint: 'ads.search_volume',
    requestHash: 'abc',
    requestJson: '{}',
    responseJson: '{"tasks":[]}',
    httpStatus: 200,
    taskStatusCode,
    cost: 0.09,
    fetchedAt,
});

describe('openDatabase', () => {
    it('creates every table of the screen on an empty file', () => {
        const { sqlite, close } = openDatabase(':memory:');
        const names = sqlite
            .prepare("select name from sqlite_master where type = 'table' order by name")
            .all()
            .map((row) => (row as { name: string }).name);
        expect(names).toEqual(
            expect.arrayContaining([
                'raw_responses',
                'runs',
                'decisions',
                'services',
                'places',
                'candidates',
                'keywords',
                'keyword_metrics',
                'serps',
                'serp_items',
                'domains',
                'domain_pages',
                'domain_keywords',
                'page_anatomy',
                'keyword_origins',
                'referring_domains',
                'listings',
                'rank_readings',
            ]),
        );
        expect(sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
        close();
    });
});

describe('SqliteCacheStore', () => {
    it('returns the latest successful answer and ignores failed ones', () => {
        const { db, close } = openDatabase(':memory:');
        const store = new SqliteCacheStore(db);
        expect(store.findLatestOk('ads.search_volume', 'abc')).toBeUndefined();
        const first = store.insert(record(20000, '2026-09-01T00:00:00.000Z'));
        const second = store.insert(record(20000, '2026-09-02T00:00:00.000Z'));
        store.insert(record(40501, '2026-09-03T00:00:00.000Z'));
        expect(first).toBe(1);
        expect(store.findLatestOk('ads.search_volume', 'abc')?.id).toBe(second);
        expect(store.findLatestOk('ads.search_volume', 'other')).toBeUndefined();
        close();
    });
});
