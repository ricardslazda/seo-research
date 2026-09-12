import type { z } from 'zod';

import type { SiteConfig } from '../config/site-config.js';
import type { Db } from '../db/open.js';
import type { Reference } from '../reference/index.js';

export interface QueryContext {
    db: Db;
    config: SiteConfig;
    reference: Reference;
    site: string;
}

export interface QueryResult {
    meta: Record<string, unknown>;
    rows: Record<string, unknown>[];
}

export interface QueryDef<Params = Record<string, never>> {
    name: string;
    description: string;
    params: z.ZodType<Params>;
    run(context: QueryContext, params: Params): QueryResult;
}

export function defineQuery<Params>(def: QueryDef<Params>): QueryDef<Params> {
    return def;
}
