import type { LanguageReading, ScreenBatch } from '../phases/screen/readings.js';

export interface ReportMeta {
    site: string;
    generatedAt: string;
    costUsd: number;
}

export interface DomainRow {
    domain: string;
    kind: string;
    kind_by: string | null;
    referring_domains: number | null;
    appearances: number;
    services?: number;
    places?: number;
    best_rank: number;
}

const cell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    return String(value).replace(/\|/g, '\\|');
};

const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

function volumeCell(reading: LanguageReading): string {
    if (reading.volumeStatus === 'measured') return String(reading.volume);
    return reading.volumeStatus === 'below_floor' ? 'below floor' : 'missing';
}

function aboveCell(reading: LanguageReading): string {
    const parts = Object.entries(reading.above).map(([type, count]) => `${count} ${type}`);
    return parts.length > 0 ? parts.join(', ') : 'none';
}

function packCell(reading: LanguageReading): string {
    if (!reading.pack) return 'none';
    const reviews = reading.pack.medianReviews === null ? '?' : String(reading.pack.medianReviews);
    return `#${reading.pack.rank}, ${reading.pack.size} listed, median ${reviews} reviews`;
}

function quartileLine(
    name: string,
    q: { p25: number; p50: number; p75: number; max: number } | null,
): string {
    if (!q) return `- **${name}**: no measured rows`;
    return `- **${name}**: p25 ${q.p25}, median ${q.p50}, p75 ${q.p75}, max ${q.max}`;
}

export function renderScreenReport(
    batch: ScreenBatch,
    meta: ReportMeta,
    domains: DomainRow[],
): string {
    const lines: string[] = [];
    lines.push(`# Market screen: ${meta.site}`, '');
    lines.push(`- **Generated**: ${meta.generatedAt}`);
    lines.push(`- **Candidates**: ${batch.rows.length}`);
    lines.push(`- **Languages**: ${batch.languages.join(', ')}`);
    lines.push(`- **Spent so far**: ${meta.costUsd.toFixed(4)} USD`, '');

    lines.push('## Calibration', '');
    lines.push(
        'Cut lines are set from this batch, never carried in from another market. A blank volume row is the absence of evidence and rejects nothing on its own.',
        '',
    );
    for (const language of batch.languages) {
        const distribution = batch.distribution[language];
        const thresholds = batch.thresholds[language] ?? {};
        lines.push(`### ${language}`, '');
        if (distribution) {
            lines.push(
                `- **Rows**: ${distribution.measured} measured, ${distribution.belowFloor} below floor, ${distribution.missing} missing, ${distribution.formSuspect} with a suspect form`,
            );
            lines.push(quartileLine('Volume', distribution.volume));
            lines.push(
                quartileLine('Referring domains, median of top five', distribution.rdMedianTop5),
            );
            lines.push(quartileLine('Pack median reviews', distribution.packMedianReviews));
            lines.push(quartileLine('Top-of-page bid', distribution.bidHigh));
        }
        const set = Object.entries(thresholds);
        lines.push(
            set.length > 0
                ? `- **Cut lines**: ${set.map(([k, v]) => `${k} = ${v}`).join(', ')}`
                : '- **Cut lines**: not set yet',
        );
        lines.push('');
    }

    lines.push('## Candidates', '');
    for (const language of batch.languages) {
        lines.push(`### ${language}`, '');
        lines.push(
            table(
                [
                    'Service',
                    'Place',
                    'Keyword',
                    'Volume',
                    'Probe',
                    'Bid',
                    'First organic',
                    'Above it',
                    'Pack',
                    'Directories in top 10',
                    'RD median top 5',
                    'Evidence',
                    'Local facts',
                    'Verdict',
                ],
                batch.rows.map((row) => {
                    const reading = row.languages[language];
                    if (!reading)
                        return [
                            row.service,
                            row.place,
                            '',
                            '',
                            '',
                            '',
                            '',
                            '',
                            '',
                            '',
                            '',
                            '',
                            row.localFacts,
                            row.verdict,
                        ];
                    return [
                        row.service,
                        row.place,
                        `\`${reading.keyword}\``,
                        volumeCell(reading),
                        reading.probe ?? '',
                        reading.bidHigh ?? '',
                        reading.firstOrganicRank ?? (reading.serpId === null ? 'no page' : 'none'),
                        aboveCell(reading),
                        packCell(reading),
                        reading.directoriesTop10,
                        reading.rdMedianTop5 ?? '',
                        reading.rdMedianBusinesses ?? '',
                        reading.demandEvidence.join(', ') || 'none',
                        row.localFacts ?? '',
                        row.chosen ? `${row.verdict ?? ''} (chosen)` : (row.verdict ?? ''),
                    ];
                }),
            ),
            '',
        );
    }

    const flagged = batch.rows.filter((row) => row.flags.length > 0);
    lines.push('## Flags', '');
    if (flagged.length === 0) lines.push('None.', '');
    for (const row of flagged)
        lines.push(`- **${row.service} in ${row.place}**: ${row.flags.join(', ')}`);
    if (flagged.length > 0) lines.push('');

    lines.push('## Questions the result pages offered', '');
    let anyQuestion = false;
    for (const row of batch.rows) {
        for (const [language, reading] of Object.entries(row.languages)) {
            if (!reading || (reading.paa.length === 0 && reading.related.length === 0)) continue;
            anyQuestion = true;
            lines.push(
                `- **${row.service} in ${row.place}, ${language}**: ${[...reading.paa, ...reading.related].map((q) => `\`${q}\``).join(', ')}`,
            );
        }
    }
    if (!anyQuestion) lines.push('None.');
    lines.push('');

    lines.push('## Domains seen', '');
    lines.push(
        table(
            [
                'Domain',
                'Kind',
                'Decided by',
                'Referring domains',
                'Pages',
                'Services',
                'Places',
                'Best rank',
            ],
            domains.map((d) => [
                d.domain,
                d.kind,
                d.kind_by ?? '',
                d.referring_domains ?? '',
                d.appearances,
                d.services ?? '',
                d.places ?? '',
                d.best_rank,
            ]),
        ),
        '',
    );

    lines.push('## Verdicts', '');
    const chosen = batch.rows.filter((row) => row.chosen);
    const rejected = batch.rows.filter((row) => row.verdict === 'reject');
    const open = batch.rows.filter((row) => row.verdict === null);
    lines.push(
        chosen.length > 0
            ? `- **Chosen**: ${chosen.map((r) => `${r.service} in ${r.place}`).join(', ')}`
            : '- **Chosen**: nothing yet',
    );
    lines.push(`- **Rejected, kept on purpose**: ${rejected.length}`);
    for (const row of rejected)
        lines.push(
            `  - ${row.service} in ${row.place}: ${row.verdictReason ?? 'no reason recorded'}`,
        );
    lines.push(`- **Awaiting a verdict**: ${open.length}`);
    lines.push('');
    return lines.join('\n');
}
