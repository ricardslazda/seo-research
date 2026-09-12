import { describe, expect, it } from 'vitest';

import { MemoryCacheStore } from './cache.js';
import { DfsClient, DfsTaskError } from './client.js';
import { defineEndpoint } from './endpoint.js';
import type { HttpMethod, Transport, TransportResponse } from './transport.js';
import type { DfsEnvelope } from './types.js';

interface Sent {
    method: HttpMethod;
    path: string;
    body: unknown;
}

const envelope = (statusCode: number, result: unknown[] | null, cost = 0.09): DfsEnvelope => ({
    version: '0.1',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0',
    cost,
    tasks_count: 1,
    tasks_error: statusCode === 20000 ? 0 : 1,
    tasks: [
        {
            id: 't',
            status_code: statusCode,
            status_message: statusCode === 20000 ? 'Ok.' : 'Invalid Field.',
            time: '0',
            cost,
            result_count: result?.length ?? 0,
            path: [],
            data: {},
            result,
        },
    ],
});

const fakeTransport = (queue: DfsEnvelope[]) => {
    const sent: Sent[] = [];
    const transport: Transport = {
        async send(method, path, body): Promise<TransportResponse> {
            sent.push({ method, path, body });
            const next = queue.shift();
            if (!next) throw new Error('no envelope queued');
            return { httpStatus: 200, envelope: next, attempts: 1 };
        },
    };
    return { sent, transport };
};

interface VolumeRequest {
    keywords: string[];
    location_code: number;
    language_code: string;
    search_partners?: boolean;
}

const volume = defineEndpoint<VolumeRequest, { keyword: string }>({
    name: 'ads.search_volume',
    path: '/v3/keywords_data/google_ads/search_volume/live',
    method: 'POST',
    family: 'ads',
    defaults: { search_partners: false },
    unorderedArrays: ['keywords'],
    price: () => 0.09,
    gate: (r) => ({ locationCode: r.location_code, languageCode: r.language_code }),
    parse: (task) => (task.result ?? []) as { keyword: string }[],
});

const request: VolumeRequest = {
    keywords: ['b', 'a'],
    location_code: 1001001,
    language_code: 'en',
};

describe('DfsClient', () => {
    it('sends once, stores the raw answer, then serves the same question from the cache', async () => {
        const { sent, transport } = fakeTransport([envelope(20000, [{ keyword: 'a' }])]);
        const store = new MemoryCacheStore();
        const client = new DfsClient({
            transport,
            store,
            now: () => new Date('2026-09-02T00:00:00Z'),
        });

        const first = await client.call(volume, request, { runId: 1 });
        expect(first.cached).toBe(false);
        expect(first.cost).toBe(0.09);
        expect(first.rows).toEqual([{ keyword: 'a' }]);
        expect(sent).toHaveLength(1);
        expect(sent[0]?.body).toEqual([
            {
                search_partners: false,
                keywords: ['b', 'a'],
                location_code: 1001001,
                language_code: 'en',
            },
        ]);
        expect(store.records[0]?.runId).toBe(1);
        expect(store.records[0]?.fetchedAt).toBe('2026-09-02T00:00:00.000Z');

        const second = await client.call(volume, {
            language_code: 'en',
            location_code: 1001001,
            keywords: ['a', 'b', 'b'],
            search_partners: false,
        });
        expect(second.cached).toBe(true);
        expect(second.cost).toBe(0);
        expect(second.rawId).toBe(first.rawId);
        expect(sent).toHaveLength(1);
    });

    it('fetches again when asked to refresh', async () => {
        const { sent, transport } = fakeTransport([
            envelope(20000, [{ keyword: 'a' }]),
            envelope(20000, [{ keyword: 'a' }]),
        ]);
        const store = new MemoryCacheStore();
        const client = new DfsClient({ transport, store });
        const first = await client.call(volume, request);
        const second = await client.call(volume, request, { refresh: true });
        expect(sent).toHaveLength(2);
        expect(second.rawId).not.toBe(first.rawId);
    });

    it('stores a failed task, throws, and does not serve it later as a hit', async () => {
        const { sent, transport } = fakeTransport([
            envelope(40501, null, 0),
            envelope(20000, [{ keyword: 'a' }]),
        ]);
        const store = new MemoryCacheStore();
        const client = new DfsClient({ transport, store });
        await expect(client.call(volume, request)).rejects.toBeInstanceOf(DfsTaskError);
        expect(store.records).toHaveLength(1);
        expect(store.records[0]?.taskStatusCode).toBe(40501);
        const retry = await client.call(volume, request);
        expect(retry.cached).toBe(false);
        expect(sent).toHaveLength(2);
    });

    it('asks the gate before hashing or sending', async () => {
        const { sent, transport } = fakeTransport([]);
        const store = new MemoryCacheStore();
        const seen: string[] = [];
        const client = new DfsClient({
            transport,
            store,
            gate: (family, pair) => {
                seen.push(`${family}:${pair.locationCode}:${pair.languageCode}`);
                throw new Error('unsupported');
            },
        });
        await expect(client.call(volume, request)).rejects.toThrow('unsupported');
        expect(seen).toEqual(['ads:1001001:en']);
        expect(sent).toHaveLength(0);
        expect(store.records).toHaveLength(0);
    });

    it('runs the transport through the family limiter', async () => {
        const { transport } = fakeTransport([envelope(20000, [])]);
        const order: string[] = [];
        const client = new DfsClient({
            transport,
            store: new MemoryCacheStore(),
            limiters: {
                ads: async (work) => {
                    order.push('limiter');
                    return work();
                },
            },
        });
        await client.call(volume, request);
        expect(order).toEqual(['limiter']);
    });
});
