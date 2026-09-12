import { Command } from 'commander';

import { collectSeeds, planKeywords, runKeywords } from '@seo/core';

import { emit, guardSpend, money } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

export function keywordsCommand(): Command {
    return new Command('keywords')
        .description(
            'phase 3: expand the seeds into every keyword the market types, priced at the first place',
        )
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '--max-competitor-seeds <n>',
            'competitor keywords to seed from, by volume',
            (v) => Number.parseInt(v, 10),
            60,
        )
        .option(
            '--suggestions-limit <n>',
            'rows per suggestions call',
            (v) => Number.parseInt(v, 10),
            300,
        )
        .option('--ideas-limit <n>', 'rows for the ideas call', (v) => Number.parseInt(v, 10), 500)
        .option('--refresh', 'ignore cached answers and call again', false)
        .option(
            '-y, --yes',
            'run even when the estimate exceeds the site spending threshold',
            false,
        )
        .option('--dry-run', 'print the seeds and the calls without making them', false)
        .action(
            async (
                options: {
                    site?: string;
                    slug?: string;
                    maxCompetitorSeeds: number;
                    suggestionsLimit: number;
                    ideasLimit: number;
                    refresh: boolean;
                    dryRun: boolean;
                    yes: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                const site = openSite(options);
                try {
                    const seedOptions = { maxCompetitorSeeds: options.maxCompetitorSeeds };
                    if (options.dryRun) {
                        const seeds = collectSeeds(site.db, site.config, seedOptions);
                        const plan = planKeywords(seeds, site.config, site.reference, {
                            suggestionsLimit: options.suggestionsLimit,
                            ideasLimit: options.ideasLimit,
                        });
                        emit(
                            json ?? false,
                            { seeds, plan },
                            seeds.map((s) => ({
                                language: s.language,
                                origin: s.origin,
                                seed: s.text,
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
                        planKeywords(
                            collectSeeds(site.db, site.config, seedOptions),
                            site.config,
                            site.reference,
                            {
                                suggestionsLimit: options.suggestionsLimit,
                                ideasLimit: options.ideasLimit,
                            },
                        ).total,
                        site.config.spend_ask_above_usd,
                        options.yes,
                    );
                    const summary = await runKeywords({
                        db: site.db,
                        client: site.client(),
                        config: site.config,
                        reference: site.reference,
                        ...seedOptions,
                        suggestionsLimit: options.suggestionsLimit,
                        ideasLimit: options.ideasLimit,
                        refresh: options.refresh,
                        log: (line) => process.stderr.write(`${line}\n`),
                    });
                    const written = writeSiteReport(site);
                    emit(json ?? false, { summary, written });
                    if (!json) {
                        process.stdout.write(
                            `run #${summary.runId}: seeds ${JSON.stringify(summary.seeds)}, ${summary.suggestions} suggestions, ${summary.ideas} ideas${summary.ideasAbandoned ? ` (abandoned at ${Math.round((summary.ideasTopicality ?? 0) * 100)}% topicality)` : ''}, ${summary.adsIdeas} ads ideas, ${summary.volumesFetched} city volumes, ${summary.difficulties} difficulties, ${summary.intents} intents, ${summary.cachedCalls} cached calls, spent ${money(summary.cost)}\n`,
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
