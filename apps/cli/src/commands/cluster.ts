import { Command } from 'commander';

import { planCluster, runCluster } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function clusterCommand(): Command {
    return new Command('cluster')
        .description(
            'phase 4: read one mobile result page per shortlisted keyword at the first place and group the keywords that share a page',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '--languages <list>',
            'comma-separated languages to read instead of the researched ones',
        )
        .option('--refresh', 'ignore cached answers and call again', false)
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option(
            '--dry-run',
            'print the shortlisted keywords and the calls without making them',
            false,
        )
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    languages?: string;
                    refresh: boolean;
                    dryRun: boolean;
                    yes: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    const languages = options.languages
                        ?.split(',')
                        .map((l) => l.trim())
                        .filter(Boolean);
                    if (options.dryRun) {
                        const plan = planCluster(site.db, site.config, { languages });
                        emit(
                            json ?? false,
                            plan,
                            plan.keywords.map((k) => ({
                                language: k.language,
                                keyword: k.text,
                                id: k.id,
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
                    guardSpend(
                        planCluster(site.db, site.config, { languages }).total,
                        site.config.spend_ask_above_usd,
                        options.yes,
                    );
                    const summary = await runCluster({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        languages,
                        refresh: options.refresh,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: ${summary.shortlisted} shortlisted in ${summary.languages.join(', ')}, ${summary.serpsFetched} new result pages, ${summary.serpsCached} cached, spent ${money(summary.cost)}\n`,
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
