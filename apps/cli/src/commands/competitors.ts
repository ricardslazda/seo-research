import { Command } from 'commander';

import { planCompetitors, runCompetitors, selectCompetitors } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function competitorsCommand(): Command {
    return new Command('competitors')
        .description(
            'phase 2: read the domains that rank as businesses: keywords, earning pages, site keywords and page anatomy',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '--domains <list>',
            'comma-separated domains to read instead of the screen selection',
        )
        .option(
            '--min-pages <n>',
            'screen result pages a domain must appear on',
            (v) => Number.parseInt(v, 10),
            5,
        )
        .option('--max <n>', 'most domains to read', (v) => Number.parseInt(v, 10), 12)
        .option(
            '--pages-per-domain <n>',
            'earning pages to parse per domain, plus the home page',
            (v) => Number.parseInt(v, 10),
            3,
        )
        .option('--refresh', 'ignore cached answers and call again', false)
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option('--dry-run', 'print the selection and the calls without making them', false)
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    domains?: string;
                    minPages: number;
                    max: number;
                    pagesPerDomain: number;
                    refresh: boolean;
                    dryRun: boolean;
                    yes: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    const select = {
                        domains: options.domains
                            ?.split(',')
                            .map((d) => d.trim())
                            .filter(Boolean),
                        minPages: options.minPages,
                        max: options.max,
                    };
                    if (options.dryRun) {
                        const candidates = selectCompetitors(
                            site.db,
                            site.config,
                            site.reference,
                            select,
                        );
                        const plan = planCompetitors(
                            candidates,
                            site.config,
                            site.reference,
                            options.pagesPerDomain,
                        );
                        emit(
                            json ?? false,
                            { candidates, plan },
                            candidates.map((c) => ({
                                domain: c.domain,
                                kind: c.kind,
                                pages: c.pages,
                                services: c.services,
                                places: c.places,
                                referring_domains: c.referringDomains,
                            })),
                        );
                        if (!json) {
                            process.stdout.write(
                                plan.calls
                                    .map((c) => `${c.endpoint}: ${c.count} calls, ${money(c.cost)}`)
                                    .join('\n') + `\nestimated total ${money(plan.total)}\n`,
                            );
                        }
                        return;
                    }
                    guardSpend(
                        planCompetitors(
                            selectCompetitors(site.db, site.config, site.reference, select),
                            site.config,
                            site.reference,
                            options.pagesPerDomain,
                        ).total,
                        site.config.spend_ask_above_usd,
                        options.yes,
                    );
                    const summary = await runCompetitors({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        ...select,
                        pagesPerDomain: options.pagesPerDomain,
                        refresh: options.refresh,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: ${summary.competitors.length} competitors, ${summary.rankedKeywords} ranked keywords, ${summary.relevantPages} earning pages, ${summary.siteIdeas} site keywords, ${summary.pagesParsed} pages parsed, ${summary.cachedCalls} cached calls, spent ${money(summary.cost)}\n`,
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
