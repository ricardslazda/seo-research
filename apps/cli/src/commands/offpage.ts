import { Command } from 'commander';

import { applyOffpageRules, planOffpage, runOffpage } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function offpageCommand(): Command {
    return new Command('offpage')
        .description(
            "phase 6: read the strongest competitor's referring domains and the business listings around each place",
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '--targets <list>',
            'comma-separated domains to read instead of the strongest competitor',
        )
        .option('--limit <n>', 'referring domains per target', (v) => Number.parseInt(v, 10), 300)
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option('--refresh', 'ignore cached answers and call again', false)
        .option('--dry-run', 'print the targets and the calls without making them', false)
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    targets?: string;
                    limit: number;
                    yes: boolean;
                    refresh: boolean;
                    dryRun: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    const targets = options.targets
                        ?.split(',')
                        .map((t) => t.trim())
                        .filter(Boolean);
                    const plan = planOffpage(site.db, site.config, {
                        targets,
                        limit: options.limit,
                    });
                    if (options.dryRun) {
                        emit(
                            json ?? false,
                            plan,
                            plan.calls.map((c) => ({
                                endpoint: c.endpoint,
                                calls: c.count,
                                cost: money(c.cost),
                            })),
                        );
                        if (!json)
                            process.stdout.write(
                                `targets: ${plan.targets.join(', ') || 'none'}\nestimated total ${money(plan.total)}\n`,
                            );
                        return;
                    }
                    guardSpend(plan.total, site.config.spend_ask_above_usd, options.yes);
                    const summary = await runOffpage({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        targets,
                        limit: options.limit,
                        refresh: options.refresh,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const verdicts = applyOffpageRules(
                        site.db,
                        site.config,
                        site.reference,
                        summary.runId,
                    );
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, verdicts, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: ${summary.targets.join(', ')}: ${summary.referringDomains} referring domains, ${summary.listings} listings across ${summary.listingsPlaces} places, ${summary.cachedCalls} cached calls, spent ${money(summary.cost)}; ${verdicts} citation verdicts written\n`,
                        );
                        for (const failure of summary.failures)
                            process.stdout.write(`failed: ${failure}\n`);
                        process.stdout.write(`written: ${written.join(', ')}\n`);
                    }
                } finally {
                    site.close();
                }
            },
        );
}
