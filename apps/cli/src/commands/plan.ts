import { Command } from 'commander';

import { buildPlan, planJsonSchema, writeOutputs } from '@seo/core';

import { emit } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function planCommand(): Command {
    return new Command('plan')
        .description(
            'phase 5: turn the clusters into the pages to write and export out/plan.json with its schema; makes no calls',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .action((options: { site?: string; slug?: string }, command: Command) => {
            const { json } = command.optsWithGlobals<{ json?: boolean }>();
            const site = openSite(options);
            try {
                const plan = buildPlan(site.db, site.config, site.reference);
                const written = [
                    ...writeOutputs(site.siteDir, {
                        'plan.json': JSON.stringify(plan, null, 2) + '\n',
                        'plan.schema.json': JSON.stringify(planJsonSchema(), null, 2) + '\n',
                    }),
                    ...writeSiteReport(site),
                ];
                const counts: Record<string, number> = {};
                for (const p of plan.pages) counts[p.status] = (counts[p.status] ?? 0) + 1;
                emit(json ?? false, {
                    pages: plan.pages.length,
                    counts,
                    notWritten: plan.notWritten,
                    written,
                });
                if (!json) {
                    process.stdout.write(
                        `${plan.pages.length} pages per locale: ${Object.entries(counts)
                            .map(([k, v]) => `${v} ${k}`)
                            .join(', ')}; ${plan.notWritten.length} not written\n`,
                    );
                    process.stdout.write(`written: ${written.join(', ')}\n`);
                }
            } finally {
                site.close();
            }
        });
}
