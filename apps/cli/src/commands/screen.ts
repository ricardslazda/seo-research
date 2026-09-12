import { Command } from 'commander';

import { applyScreenRules, loadScreen, planScreen, runScreen } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function screenCommand(): Command {
    return new Command('screen')
        .description(
            'phase 1: gather volume, result pages and referring domains for every candidate',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option('--refresh', 'ignore cached answers and call again', false)
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option('--dry-run', 'print the calls and their estimated cost without making them', false)
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    refresh: boolean;
                    dryRun: boolean;
                    yes: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    if (options.dryRun) {
                        const plan = planScreen(site.config, site.reference);
                        emit(
                            json ?? false,
                            plan,
                            plan.calls.map((call) => ({
                                endpoint: call.endpoint,
                                calls: call.count,
                                unit: money(call.unitPrice),
                                cost: money(call.cost),
                            })),
                        );
                        if (!json) process.stdout.write(`estimated total ${money(plan.total)}\n`);
                        return;
                    }
                    guardSpend(
                        planScreen(site.config, site.reference).total,
                        site.config.spend_ask_above_usd,
                        options.yes,
                    );
                    const summary = await runScreen({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        refresh: options.refresh,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const applied = applyScreenRules(
                        site.db,
                        loadScreen(site.db, site.config, site.reference),
                        summary.runId,
                    );
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, applied, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: ${summary.candidates} candidates, ${summary.keywords} keywords, ${summary.serps} new result pages (${summary.serpsSkipped} skipped), ${summary.domains} domains, ${summary.cachedCalls} cached calls, spent ${money(summary.cost)}\n`,
                        );
                        if (summary.serpsFailed > 0) {
                            process.stdout.write(
                                `failed: ${summary.serpsFailed} result pages never came back; run again to retry them\n`,
                            );
                        }
                        process.stdout.write(
                            `rules: ${applied.domainDecisions} domain kinds, ${applied.probeDecisions} probes\n`,
                        );
                        process.stdout.write(`written: ${written.join(', ')}\n`);
                    }
                } finally {
                    site.close();
                }
            },
        );
}
