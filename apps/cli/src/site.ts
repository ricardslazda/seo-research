import { basename } from 'node:path';

import type { DfsClient } from '@seo/dfs-client';
import {
    SqliteCacheStore,
    createClient,
    loadSiteConfig,
    openDatabase,
    requireReference,
    siteDatabasePath,
    type Db,
    type Reference,
    type SiteConfig,
} from '@seo/core';

import { resolveSiteDir } from './context.js';

export interface OpenSite {
    siteDir: string;
    slug: string;
    config: SiteConfig;
    reference: Reference;
    db: Db;
    client: () => DfsClient;
    close(): void;
}

export function openSite(options: { site?: string; slug?: string }): OpenSite {
    const siteDir = resolveSiteDir(options);
    const config = loadSiteConfig(siteDir);
    const reference = requireReference();
    const { db, close } = openDatabase(siteDatabasePath(siteDir));
    return {
        siteDir,
        slug: config.slug || basename(siteDir),
        config,
        reference,
        db,
        client: () => createClient({ store: new SqliteCacheStore(db), reference }),
        close,
    };
}
