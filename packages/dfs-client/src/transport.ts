import type { DfsEnvelope } from './types.js';

export interface Credentials {
    login: string;
    password: string;
}

export interface RetryPolicy {
    attempts: number;
    delaysMs: readonly number[];
    jitter: number;
}

export const defaultRetryPolicy: RetryPolicy = {
    attempts: 3,
    delaysMs: [1000, 4000, 16000],
    jitter: 0.25,
};

export interface TransportOptions {
    baseUrl?: string;
    timeoutMs?: number;
    fetch?: typeof globalThis.fetch;
    retry?: RetryPolicy;
    sleep?: (ms: number) => Promise<void>;
    random?: () => number;
}

export interface TransportResponse {
    httpStatus: number;
    envelope: DfsEnvelope;
    attempts: number;
}

export type HttpMethod = 'GET' | 'POST';

export interface Transport {
    send(method: HttpMethod, path: string, body?: unknown): Promise<TransportResponse>;
}

export class DfsHttpError extends Error {
    constructor(
        readonly httpStatus: number,
        readonly path: string,
        readonly bodyText: string,
    ) {
        super(`DataForSEO ${path} answered HTTP ${httpStatus}`);
        this.name = 'DfsHttpError';
    }
}

export class DfsTransportError extends Error {
    constructor(
        readonly path: string,
        readonly attempts: number,
        override readonly cause: unknown,
    ) {
        super(`DataForSEO ${path} unreachable after ${attempts} attempts`);
        this.name = 'DfsTransportError';
    }
}

const retryableHttp = new Set([429, 500, 502, 503, 504]);

export function isRetryableStatusCode(code: number): boolean {
    return [40101, 40106, 40202].includes(code) || (code >= 50000 && code < 60000);
}

export function credentialsFromEnv(env: NodeJS.ProcessEnv = process.env): Credentials {
    const login = env['DATAFORSEO_LOGIN'];
    const password = env['DATAFORSEO_PASSWORD'];
    if (!login || !password) {
        throw new Error('DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD must be set');
    }
    return { login, password };
}

export function createTransport(
    credentials: Credentials,
    options: TransportOptions = {},
): Transport {
    const baseUrl = (options.baseUrl ?? 'https://api.dataforseo.com').replace(/\/$/, '');
    const authorization =
        'Basic ' + Buffer.from(`${credentials.login}:${credentials.password}`).toString('base64');
    const fetchFn = options.fetch ?? globalThis.fetch;
    const retry = options.retry ?? defaultRetryPolicy;
    const sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    const random = options.random ?? Math.random;
    const timeoutMs = options.timeoutMs ?? 130_000;

    const delayFor = (attempt: number): number => {
        const base = retry.delaysMs[Math.min(attempt, retry.delaysMs.length) - 1] ?? 1000;
        return Math.round(base * (1 + retry.jitter * (random() * 2 - 1)));
    };

    return {
        async send(method, path, body) {
            let lastError: unknown;
            for (let attempt = 1; attempt <= retry.attempts; attempt++) {
                const isLast = attempt === retry.attempts;
                let response: Response;
                try {
                    response = await fetchFn(baseUrl + path, {
                        method,
                        headers: {
                            Authorization: authorization,
                            'Content-Type': 'application/json',
                            Accept: 'application/json',
                        },
                        body: method === 'POST' ? JSON.stringify(body) : undefined,
                        signal: AbortSignal.timeout(timeoutMs),
                    });
                } catch (error) {
                    lastError = error;
                    if (isLast) break;
                    await sleep(delayFor(attempt));
                    continue;
                }
                if (!response.ok) {
                    const text = await response.text();
                    lastError = new DfsHttpError(response.status, path, text);
                    if (!retryableHttp.has(response.status) || isLast) throw lastError;
                    await sleep(delayFor(attempt));
                    continue;
                }
                const envelope = (await response.json()) as DfsEnvelope;
                const taskCode = envelope.tasks?.[0]?.status_code ?? envelope.status_code;
                const retryable =
                    isRetryableStatusCode(envelope.status_code) || isRetryableStatusCode(taskCode);
                if (retryable && !isLast) {
                    await sleep(delayFor(attempt));
                    continue;
                }
                return { httpStatus: response.status, envelope, attempts: attempt };
            }
            if (lastError instanceof DfsHttpError) throw lastError;
            throw new DfsTransportError(path, retry.attempts, lastError);
        },
    };
}
