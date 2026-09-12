import type { QueryDef } from './types.js';

export * from './types.js';

const all: QueryDef<unknown>[] = [];

export function listQueries(): QueryDef<unknown>[] {
    return [...all];
}

export function findQuery(name: string): QueryDef<unknown> | undefined {
    return all.find((query) => query.name === name);
}
