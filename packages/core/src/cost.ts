import { and, eq, isNotNull, sql } from 'drizzle-orm';

import type { Db } from './db/open.js';
import { rawResponses } from './db/schema.js';

export interface CostRow {
    runId: number | null;
    endpoint: string;
    calls: number;
    cost: number;
}

export function costSummary(db: Db, runId?: number): CostRow[] {
    const where =
        runId === undefined
            ? undefined
            : and(isNotNull(rawResponses.runId), eq(rawResponses.runId, runId));
    return db
        .select({
            runId: rawResponses.runId,
            endpoint: rawResponses.endpoint,
            calls: sql<number>`count(*)`,
            cost: sql<number>`round(sum(${rawResponses.cost}), 4)`,
        })
        .from(rawResponses)
        .where(where)
        .groupBy(rawResponses.runId, rawResponses.endpoint)
        .orderBy(rawResponses.runId, rawResponses.endpoint)
        .all();
}
