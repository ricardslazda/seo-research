import type { CacheStore } from './cache.js';
import { requestHash } from './canonical.js';
import type { EndpointDef, Family, PairRequest } from './endpoint.js';
import type { Limiter } from './limiter.js';
import type { Transport } from './transport.js';
import type { DfsEnvelope, DfsTask } from './types.js';
import { OK_STATUS } from './types.js';

export interface CallOptions {
    refresh?: boolean;
    runId?: number | null;
}

export interface CallResult<Row> {
    rows: Row[];
    rawId: number;
    cost: number;
    cached: boolean;
    task: DfsTask;
}

export type Gate = (family: Family, pair: PairRequest) => void;

export interface DfsClientOptions {
    transport: Transport;
    store: CacheStore;
    gate?: Gate;
    limiters?: Partial<Record<Family, Limiter>>;
    now?: () => Date;
}

export class DfsTaskError extends Error {
    constructor(
        readonly endpoint: string,
        readonly statusCode: number,
        readonly statusMessage: string,
        readonly rawId: number,
    ) {
        super(`${endpoint} failed with ${statusCode} ${statusMessage}`);
        this.name = 'DfsTaskError';
    }
}

const passthrough: Limiter = (work) => work();

function firstTask(envelope: DfsEnvelope): DfsTask {
    const task = envelope.tasks?.[0];
    if (task) return task;
    return {
        id: '',
        status_code: envelope.status_code,
        status_message: envelope.status_message,
        time: envelope.time,
        cost: envelope.cost ?? 0,
        result_count: 0,
        path: [],
        data: {},
        result: null,
    };
}

export class DfsClient {
    constructor(private readonly options: DfsClientOptions) {}

    estimate<Request extends object, Row>(
        def: EndpointDef<Request, Row>,
        request: Request,
    ): number {
        return def.price({ ...def.defaults, ...request });
    }

    async call<Request extends object, Row>(
        def: EndpointDef<Request, Row>,
        request: Request,
        options: CallOptions = {},
    ): Promise<CallResult<Row>> {
        const merged: Request = { ...def.defaults, ...request };
        const pair = def.gate(merged);
        if (pair && this.options.gate) this.options.gate(def.family, pair);

        const body = def.method === 'POST' ? merged : null;
        const hash = requestHash(def.path, body, { unorderedArrays: def.unorderedArrays });

        if (!options.refresh) {
            const hit = this.options.store.findLatestOk(def.name, hash);
            if (hit) {
                const task = firstTask(JSON.parse(hit.responseJson) as DfsEnvelope);
                return { rows: def.parse(task), rawId: hit.id, cost: 0, cached: true, task };
            }
        }

        const limiter = this.options.limiters?.[def.family] ?? passthrough;
        const response = await limiter(() =>
            this.options.transport.send(
                def.method,
                def.path,
                def.method === 'POST' ? [merged] : undefined,
            ),
        );
        const task = firstTask(response.envelope);
        const cost = task.cost ?? response.envelope.cost ?? 0;
        const rawId = this.options.store.insert({
            runId: options.runId ?? null,
            endpoint: def.name,
            requestHash: hash,
            requestJson: JSON.stringify(merged),
            responseJson: JSON.stringify(response.envelope),
            httpStatus: response.httpStatus,
            taskStatusCode: task.status_code,
            cost,
            fetchedAt: (this.options.now?.() ?? new Date()).toISOString(),
        });
        if (task.status_code !== OK_STATUS) {
            throw new DfsTaskError(def.name, task.status_code, task.status_message, rawId);
        }
        return { rows: def.parse(task), rawId, cost, cached: false, task };
    }
}
