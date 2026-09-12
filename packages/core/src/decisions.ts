import { asc, eq } from 'drizzle-orm';

import type { Db } from './db/open.js';
import { decisions } from './db/schema.js';

export type MadeBy = 'rule' | 'claude' | 'human';
export type Decision = typeof decisions.$inferSelect;

export interface NewDecision {
    runId?: number | null;
    subjectType: string;
    subjectId: string;
    kind: string;
    value: string;
    reason: string;
    madeBy: MadeBy;
    evidenceRawId?: number | null;
    madeAt?: string;
}

export function decisionKey(subjectId: string, kind: string): string {
    return `${subjectId}::${kind}`;
}

export function writeDecision(db: Db, decision: NewDecision): number {
    const row = db
        .insert(decisions)
        .values({
            runId: decision.runId ?? null,
            subjectType: decision.subjectType,
            subjectId: decision.subjectId,
            kind: decision.kind,
            value: decision.value,
            reason: decision.reason,
            madeBy: decision.madeBy,
            evidenceRawId: decision.evidenceRawId ?? null,
            madeAt: decision.madeAt ?? new Date().toISOString(),
        })
        .returning({ id: decisions.id })
        .get();
    if (!row) throw new Error('decision insert returned no id');
    return row.id;
}

export function currentDecisions(db: Db, subjectType: string): Map<string, Decision> {
    const rows = db
        .select()
        .from(decisions)
        .where(eq(decisions.subjectType, subjectType))
        .orderBy(asc(decisions.madeAt), asc(decisions.id))
        .all();
    const latest = new Map<string, Decision>();
    for (const row of rows) latest.set(decisionKey(row.subjectId, row.kind), row);
    return latest;
}

export function currentDecision(
    db: Db,
    subjectType: string,
    subjectId: string,
    kind: string,
): Decision | undefined {
    return currentDecisions(db, subjectType).get(decisionKey(subjectId, kind));
}
