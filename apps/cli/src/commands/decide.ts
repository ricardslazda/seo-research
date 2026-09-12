import { readFileSync } from 'node:fs';

import { Command } from 'commander';

import { decide, type DecideInput, type MadeBy } from '@seo/core';

import { emit } from '../output.js';
import { writeSiteReport } from '../report.js';
import { openSite } from '../site.js';

const MADE_BY: MadeBy[] = ['claude', 'human'];

function parseDecisionPair(pair: string): { kind: string; value: string } {
    const index = pair.indexOf('=');
    if (index <= 0) throw new Error(`--decision expects kind=value, got "${pair}"`);
    return { kind: pair.slice(0, index), value: pair.slice(index + 1) };
}

export function decideCommand(): Command {
    return new Command('decide')
        .description('record a judgment as a decision row; the latest per subject and kind wins')
        .argument('[subject_type]', 'candidate, domain, keyword or threshold')
        .argument('[subject_id]', 'candidate id, domain, keyword id, or screen:<language>')
        .option('-s, --site <dir>', 'site folder')
        .option('--slug <slug>', 'site slug under sites/')
        .option(
            '-d, --decision <kind=value>',
            'decision, repeatable',
            (value: string, all: string[]) => [...all, value],
            [] as string[],
        )
        .option('-r, --reason <text>', 'why, in one sentence')
        .option('--by <who>', 'claude or human', 'claude')
        .option('--evidence <raw_id>', 'raw response id the decision rests on', (value) =>
            Number.parseInt(value, 10),
        )
        .option('--run <id>', 'run id', (value) => Number.parseInt(value, 10))
        .option('--batch <file>', 'JSON array of decisions; "-" reads stdin')
        .option('--no-report', 'do not re-render out/ afterwards')
        .action(
            (
                subjectType: string | undefined,
                subjectId: string | undefined,
                options: {
                    site?: string;
                    slug?: string;
                    decision: string[];
                    reason?: string;
                    by: string;
                    evidence?: number;
                    run?: number;
                    batch?: string;
                    report: boolean;
                },
                command: Command,
            ) => {
                const { json } = command.optsWithGlobals<{ json?: boolean }>();
                if (!MADE_BY.includes(options.by as MadeBy))
                    throw new Error('--by must be claude or human');
                const inputs: DecideInput[] = [];
                if (options.batch) {
                    const text =
                        options.batch === '-'
                            ? readFileSync(0, 'utf8')
                            : readFileSync(options.batch, 'utf8');
                    const items = JSON.parse(text) as Partial<
                        DecideInput & { decisions: { kind: string; value: string }[] }
                    >[];
                    for (const item of items) {
                        if (
                            !item.subjectType ||
                            !item.subjectId ||
                            !item.decisions ||
                            !item.reason
                        ) {
                            throw new Error(
                                'each batch item needs subjectType, subjectId, decisions and reason',
                            );
                        }
                        inputs.push({
                            subjectType: item.subjectType,
                            subjectId: String(item.subjectId),
                            decisions: item.decisions,
                            reason: item.reason,
                            madeBy: (item.madeBy as MadeBy | undefined) ?? (options.by as MadeBy),
                            runId: item.runId ?? options.run ?? null,
                            evidenceRawId: item.evidenceRawId ?? null,
                        });
                    }
                } else {
                    if (!subjectType || !subjectId)
                        throw new Error('pass <subject_type> <subject_id> or --batch');
                    if (!options.reason) throw new Error('--reason is required');
                    inputs.push({
                        subjectType,
                        subjectId,
                        decisions: options.decision.map(parseDecisionPair),
                        reason: options.reason,
                        madeBy: options.by as MadeBy,
                        runId: options.run ?? null,
                        evidenceRawId: options.evidence ?? null,
                    });
                }
                const site = openSite(options);
                try {
                    const ids = inputs.flatMap((input) => decide(site.db, input));
                    const written = options.report ? writeSiteReport(site) : [];
                    emit(json ?? false, { ids, written });
                    if (!json)
                        process.stdout.write(
                            `recorded ${ids.length} decision${ids.length === 1 ? '' : 's'}${written.length > 0 ? `, rewrote ${written.join(', ')}` : ''}\n`,
                        );
                } finally {
                    site.close();
                }
            },
        );
}
