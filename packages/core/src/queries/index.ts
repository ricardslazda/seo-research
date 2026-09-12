import { clusterQueries } from '../phases/cluster/queries.js';
import { competitorQueries } from '../phases/competitors/queries.js';
import { keywordQueries } from '../phases/keywords/queries.js';
import { screenQueries } from '../phases/screen/queries.js';
import type { QueryDef } from './types.js';

export * from './types.js';

const all: QueryDef<unknown>[] = [
    ...screenQueries,
    ...competitorQueries,
    ...keywordQueries,
    ...clusterQueries,
] as QueryDef<unknown>[];

export function listQueries(): QueryDef<unknown>[] {
    return [...all];
}

export function findQuery(name: string): QueryDef<unknown> | undefined {
    return all.find((query) => query.name === name);
}
