import { and, desc, eq } from 'drizzle-orm';

import type { CacheStore, NewRawRecord, RawRecord } from '@seo/dfs-client';
import { OK_STATUS } from '@seo/dfs-client';

import type { Db } from './open.js';
import { rawResponses } from './schema.js';

export class SqliteCacheStore implements CacheStore {
    constructor(private readonly db: Db) {}

    findLatestOk(endpoint: string, requestHash: string): RawRecord | undefined {
        const row = this.db
            .select()
            .from(rawResponses)
            .where(
                and(
                    eq(rawResponses.endpoint, endpoint),
                    eq(rawResponses.requestHash, requestHash),
                    eq(rawResponses.taskStatusCode, OK_STATUS),
                ),
            )
            .orderBy(desc(rawResponses.fetchedAt), desc(rawResponses.id))
            .limit(1)
            .get();
        return row ?? undefined;
    }

    insert(record: NewRawRecord): number {
        const inserted = this.db
            .insert(rawResponses)
            .values(record)
            .returning({ id: rawResponses.id })
            .get();
        if (!inserted) throw new Error('raw response insert returned no id');
        return inserted.id;
    }
}
