import { Command } from 'commander';

import { costSummary, openDatabase, siteDatabasePath } from '@seo/core';

import { resolveSiteDir } from '../context.js';
import { emit, money } from '../output.js';

export function costCommand(): Command {
    return new Command('cost')
        .description('what a site has spent, by run and endpoint')
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option('-r, --run <id>', 'one run only', (value) => Number.parseInt(value, 10))
        .action((options: { site?: string; slug?: string; run?: number }, command: Command) => {
            const { json } = command.optsWithGlobals<{ json?: boolean }>();
            const { db, close } = openDatabase(siteDatabasePath(resolveSiteDir(options)));
            try {
                const rows = costSummary(db, options.run);
                const total = rows.reduce((sum, row) => sum + row.cost, 0);
                emit(
                    json ?? false,
                    { rows, total },
                    rows.map((row) => ({
                        run: row.runId,
                        endpoint: row.endpoint,
                        calls: row.calls,
                        cost: money(row.cost),
                    })),
                );
                if (!json) process.stdout.write(`total ${money(total)}\n`);
            } finally {
                close();
            }
        });
}
