import { describe, expect, it } from 'vitest';

import {
    DfsHttpError,
    DfsTransportError,
    createTransport,
    credentialsFromEnv,
    isRetryableStatusCode,
} from './transport.js';
import type { DfsEnvelope } from './types.js';

const envelope = (statusCode: number): DfsEnvelope => ({
    version: '0.1',
    status_code: 20000,
    status_message: 'Ok.',
    time: '0',
    cost: 0.01,
    tasks_count: 1,
    tasks_error: statusCode === 20000 ? 0 : 1,
    tasks: [
        {
            id: 't',
            status_code: statusCode,
            status_message: '',
            time: '0',
            cost: 0.01,
            result_count: 0,
            path: [],
            data: {},
            result: [],
        },
    ],
});

const jsonResponse = (status: number, body: unknown): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });

interface Recorded {
    url: string;
    init: RequestInit;
}

const fakeFetch = (responses: (Response | Error)[]) => {
    const calls: Recorded[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
        calls.push({ url: String(url), init: init ?? {} });
        const next = responses.shift();
        if (next === undefined) throw new Error('no response queued');
        if (next instanceof Error) throw next;
        return next;
    };
    return { calls, fetch: fetch as typeof globalThis.fetch };
};

const credentials = { login: 'user@example.com', password: 'secret' };
const noSleep = { sleep: async () => {}, random: () => 0.5 };

describe('createTransport', () => {
    it('sends basic auth and a one-task array body', async () => {
        const { calls, fetch } = fakeFetch([jsonResponse(200, envelope(20000))]);
        const transport = createTransport(credentials, { fetch, ...noSleep });
        await transport.send('POST', '/v3/x/live', [{ keyword: 'a' }]);
        expect(calls).toHaveLength(1);
        expect(calls[0]?.url).toBe('https://api.dataforseo.com/v3/x/live');
        const headers = calls[0]?.init.headers as Record<string, string>;
        expect(headers['Authorization']).toBe(
            'Basic ' + Buffer.from('user@example.com:secret').toString('base64'),
        );
        expect(calls[0]?.init.body).toBe('[{"keyword":"a"}]');
    });

    it('retries a 503 and returns the second answer', async () => {
        const slept: number[] = [];
        const { calls, fetch } = fakeFetch([
            new Response('down', { status: 503 }),
            jsonResponse(200, envelope(20000)),
        ]);
        const transport = createTransport(credentials, {
            fetch,
            random: () => 0.5,
            sleep: async (ms) => {
                slept.push(ms);
            },
        });
        const answer = await transport.send('GET', '/v3/appendix/user_data');
        expect(answer.attempts).toBe(2);
        expect(calls).toHaveLength(2);
        expect(slept).toEqual([1000]);
    });

    it('does not retry an authentication failure', async () => {
        const { calls, fetch } = fakeFetch([new Response('nope', { status: 401 })]);
        const transport = createTransport(credentials, { fetch, ...noSleep });
        await expect(transport.send('GET', '/v3/appendix/user_data')).rejects.toBeInstanceOf(
            DfsHttpError,
        );
        expect(calls).toHaveLength(1);
    });

    it('retries a rate-limited task code and gives up after the policy', async () => {
        const { calls, fetch } = fakeFetch([
            jsonResponse(200, envelope(40202)),
            jsonResponse(200, envelope(40202)),
            jsonResponse(200, envelope(40202)),
        ]);
        const transport = createTransport(credentials, { fetch, ...noSleep });
        const answer = await transport.send('POST', '/v3/x/live', [{}]);
        expect(answer.attempts).toBe(3);
        expect(answer.envelope.tasks[0]?.status_code).toBe(40202);
        expect(calls).toHaveLength(3);
    });

    it('wraps a network failure after the last attempt', async () => {
        const { fetch } = fakeFetch([
            new Error('ECONNRESET'),
            new Error('ECONNRESET'),
            new Error('ECONNRESET'),
        ]);
        const transport = createTransport(credentials, { fetch, ...noSleep });
        await expect(transport.send('POST', '/v3/x/live', [{}])).rejects.toBeInstanceOf(
            DfsTransportError,
        );
    });
});

describe('isRetryableStatusCode', () => {
    it('retries the search engine and rate-limit codes and nothing else in the 4xxxx range', () => {
        expect(isRetryableStatusCode(40101)).toBe(true);
        expect(isRetryableStatusCode(40106)).toBe(true);
        expect(isRetryableStatusCode(40202)).toBe(true);
        expect(isRetryableStatusCode(50000)).toBe(true);
        expect(isRetryableStatusCode(40501)).toBe(false);
        expect(isRetryableStatusCode(40100)).toBe(false);
        expect(isRetryableStatusCode(20000)).toBe(false);
    });
});

describe('credentialsFromEnv', () => {
    it('reads both variables and refuses a missing one', () => {
        expect(credentialsFromEnv({ DATAFORSEO_LOGIN: 'a', DATAFORSEO_PASSWORD: 'b' })).toEqual({
            login: 'a',
            password: 'b',
        });
        expect(() => credentialsFromEnv({ DATAFORSEO_LOGIN: 'a' })).toThrow(/must be set/);
    });
});
