import { Command } from 'commander';

import { findEndpoint, listEndpoints } from '@seo/dfs-client';
import { SqliteCacheStore, createClient, openDatabase, siteDatabasePath } from '@seo/core';

import { resolveSiteDir } from '../context.js';
import { emit } from '../output.js';

export function probeCommand(): Command {
    return new Command('probe')
        .description('call one endpoint through the cache and print its parsed rows')
        .argument('[endpoint]', 'endpoint name; omit to list them')
        .option('-b, --body <json>', 'request body as JSON', '{}')
        .option('-s, --site <dir>', 'site folder whose database stores the raw answer')
        .option('--slug <slug>', 'site slug under sites/')
        .option('--refresh', 'ignore the cache', false)
        .action(
            async (
                name: string | undefined,
                options: { body: string; site?: string; slug?: string; refresh: boolean },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                if (!name) {
                    const rows = listEndpoints().map((endpoint) => ({
                        name: endpoint.name,
                        family: endpoint.family,
                        path: endpoint.path,
                    }));
                    emit(json ?? false, rows, rows);
                    return;
                }
                const endpoint = findEndpoint(name);
                if (!endpoint)
                    throw new Error(`unknown endpoint "${name}"; run "seo probe" to list them`);
                const siteDir = resolveSiteDir(options, '_scratch');
                const { db, close } = openDatabase(siteDatabasePath(siteDir));
                try {
                    const client = createClient({ store: new SqliteCacheStore(db) });
                    const body = JSON.parse(options.body) as Record<string, unknown>;
                    const result = await client.call(endpoint, body, { refresh: options.refresh });
                    emit(json ?? false, {
                        rawId: result.rawId,
                        cached: result.cached,
                        cost: result.cost,
                        rows: result.rows,
                    });
                    if (!json) {
                        process.stdout.write(
                            `raw #${result.rawId} cached=${result.cached} cost=${result.cost} rows=${result.rows.length}\n`,
                        );
                        process.stdout.write(
                            JSON.stringify(result.rows.slice(0, 20), null, 2) + '\n',
                        );
                    }
                } finally {
                    close();
                }
            },
        );
}
