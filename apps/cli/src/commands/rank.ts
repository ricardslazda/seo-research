import { Command } from 'commander';

import { planRank, runRank } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function rankCommand(): Command {
    return new Command('rank')
        .description(
            'phase 7: read where a domain sits for every keyword the plan tracks, on the same pages the screen used',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option('-d, --domain <domain>', 'domain to read; defaults to the site config')
        .option('--no-fetch-missing', 'read only from stored pages; fetch nothing')
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option('--refresh', 'fetch every tracked page again', false)
        .option('--dry-run', 'print the tracked keywords and the calls without making them', false)
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    domain?: string;
                    fetchMissing: boolean;
                    yes: boolean;
                    refresh: boolean;
                    dryRun: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    const plan = planRank(site.db, site.config, site.reference, {
                        refresh: options.refresh,
                        fetchMissing: options.fetchMissing,
                    });
                    if (options.dryRun) {
                        emit(
                            json ?? false,
                            plan,
                            plan.tracked.map((t) => ({
                                language: t.language,
                                keyword: t.text,
                                page: t.pageKey,
                                role: t.role,
                            })),
                        );
                        if (!json)
                            process.stdout.write(
                                plan.calls
                                    .map((c) => `${c.endpoint}: ${c.count} calls, ${money(c.cost)}`)
                                    .join('\n') + `\nestimated total ${money(plan.total)}\n`,
                            );
                        return;
                    }
                    guardSpend(plan.total, site.config.spend_ask_above_usd, options.yes);
                    const summary = await runRank({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        domain: options.domain,
                        refresh: options.refresh,
                        fetchMissing: options.fetchMissing,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: ${summary.domain}: ${summary.read} of ${summary.tracked} tracked keywords read, ${summary.fetched} pages fetched, ${summary.skipped} skipped, spent ${money(summary.cost)}\n`,
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
