import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { asc } from 'drizzle-orm';

import type { Db } from '../db/open.js';
import { decisions } from '../db/schema.js';

export const OUT_DIR = 'out';

export function exportDecisions(db: Db): string {
    const rows = db.select().from(decisions).orderBy(asc(decisions.id)).all();
    return rows.map((row) => JSON.stringify(row)).join('\n') + (rows.length > 0 ? '\n' : '');
}

export function writeOutputs(siteDir: string, files: Record<string, string>): string[] {
    const dir = join(siteDir, OUT_DIR);
    mkdirSync(dir, { recursive: true });
    const written: string[] = [];
    for (const [name, content] of Object.entries(files)) {
        const file = join(dir, name);
        writeFileSync(file, content);
        written.push(file);
    }
    return written;
}
