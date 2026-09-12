import {
    DfsClient,
    MemoryCacheStore,
    createFamilyLimiters,
    createGate,
    createTransport,
    credentialsFromEnv,
    type CacheStore,
    type Transport,
} from '@seo/dfs-client';

import { readReference, type Reference } from '../reference/index.js';

export interface CreateClientOptions {
    store?: CacheStore;
    transport?: Transport;
    reference?: Reference | null;
    referenceDir?: string;
    env?: NodeJS.ProcessEnv;
}

export class MissingReferenceError extends Error {
    constructor() {
        super('reference files are missing; run "seo ref sync --countries <ISO,...>" first');
        this.name = 'MissingReferenceError';
    }
}

export function createClient(options: CreateClientOptions = {}): DfsClient {
    const transport = options.transport ?? createTransport(credentialsFromEnv(options.env));
    const reference =
        options.reference === undefined ? readReference(options.referenceDir) : options.reference;
    return new DfsClient({
        transport,
        store: options.store ?? new MemoryCacheStore(),
        gate: reference ? createGate(reference.support, reference.locations) : undefined,
        limiters: createFamilyLimiters(),
    });
}

export function requireReference(referenceDir?: string): Reference {
    const reference = readReference(referenceDir);
    if (!reference) throw new MissingReferenceError();
    return reference;
}
