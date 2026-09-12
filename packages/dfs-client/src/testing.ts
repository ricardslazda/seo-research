import type { HttpMethod, Transport, TransportResponse } from './transport.js';
import type { DfsEnvelope } from './types.js';

export interface SentRequest {
    method: HttpMethod;
    path: string;
    body: unknown;
}

export function fixtureTransport(byPath: Record<string, DfsEnvelope | DfsEnvelope[]>) {
    const sent: SentRequest[] = [];
    const queues = new Map<string, DfsEnvelope[]>();
    for (const [path, entry] of Object.entries(byPath)) {
        queues.set(path, Array.isArray(entry) ? [...entry] : [entry]);
    }
    const transport: Transport = {
        async send(method, path, body): Promise<TransportResponse> {
            sent.push({ method, path, body });
            const queue = queues.get(path);
            if (!queue) throw new Error(`no fixture for ${path}; tests never call the network`);
            const envelope = queue.length > 1 ? queue.shift() : queue[0];
            if (!envelope) throw new Error(`fixtures for ${path} exhausted`);
            return { httpStatus: 200, envelope, attempts: 1 };
        },
    };
    return { sent, transport };
}

export function okEnvelope(result: unknown[] | null, cost = 0): DfsEnvelope {
    return {
        version: '0.1',
        status_code: 20000,
        status_message: 'Ok.',
        time: '0',
        cost,
        tasks_count: 1,
        tasks_error: 0,
        tasks: [
            {
                id: 'fixture',
                status_code: 20000,
                status_message: 'Ok.',
                time: '0',
                cost,
                result_count: result?.length ?? 0,
                path: [],
                data: {},
                result,
            },
        ],
    };
}
