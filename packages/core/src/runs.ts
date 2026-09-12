import { eq } from 'drizzle-orm';

import type { Db } from './db/open.js';
import { runs } from './db/schema.js';

export function startRun(db: Db, phase: string, args: unknown, now = new Date()): number {
    const row = db
        .insert(runs)
        .values({ phase, startedAt: now.toISOString(), argsJson: JSON.stringify(args ?? {}) })
        .returning({ id: runs.id })
        .get();
    if (!row) throw new Error('run insert returned no id');
    return row.id;
}

export function finishRun(db: Db, id: number, notes?: string, now = new Date()): void {
    db.update(runs)
        .set({ finishedAt: now.toISOString(), notes: notes ?? null })
        .where(eq(runs.id, id))
        .run();
}
