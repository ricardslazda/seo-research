import { Command } from 'commander';

import { emit } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function reportCommand(): Command {
    return new Command('report')
        .description('render out/report.md and out/decisions.jsonl from the database')
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .action((options: { site?: string; slug?: string }, command: Command) => {
            const { json } = command.optsWithGlobals<{ json?: boolean }>();
            const site = openSite(options);
            try {
                const written = writeSiteReport(site);
                emit(json ?? false, { written });
                if (!json) process.stdout.write(`written: ${written.join(', ')}\n`);
            } finally {
                site.close();
            }
        });
}
