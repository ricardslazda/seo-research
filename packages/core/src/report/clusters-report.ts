import type { ClustersBatch } from '../phases/cluster/readings.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderClustersReport(batch: ClustersBatch): string {
    const lines: string[] = [];
    lines.push('## Clusters', '');
    if (batch.clusters.length === 0) {
        lines.push('None yet. Shortlist keywords, then run `seo cluster`.', '');
        return lines.join('\n');
    }
    lines.push(
        'Two keywords are one page when the search engine already answers them with three or more of the same results. A purpose-built page ranking on the narrow query but absent from the broad one, or a different set of pack occupants, keeps them apart.',
        '',
    );
    for (const language of batch.languages) {
        const d = batch.degenerate[language];
        const own = batch.clusters.filter((c) => c.language === language);
        lines.push(`### ${language}`, '');
        if (d)
            lines.push(
                `- **Pairs**: ${d.pairs}, ${d.samePage} sharing three or more results (${Math.round(d.share * 100)}%)${d.flagged ? '. The field is small and the overlap test is degenerate; read the tie-breakers.' : ''}`,
            );
        lines.push(`- **Clusters**: ${own.length}`, '');
        lines.push(
            table(
                [
                    'Primary keyword',
                    'Members',
                    'Volume',
                    'Intent (page / label)',
                    'Page type',
                    'Service',
                    'First organic',
                    'Pack',
                    'Questions',
                ],
                own.map((c) => [
                    `\`${c.primaryKeyword}\``,
                    c.members
                        .filter((m) => m.role === 'member')
                        .map((m) => `\`${m.text}\``)
                        .join(', ') || '-',
                    c.volumeSum,
                    `${c.intentSerp} / ${c.intentEndpoint ?? '-'}`,
                    c.pageType,
                    c.service ?? '',
                    c.firstOrganicRank ?? '',
                    c.packPresent ? 'yes' : 'no',
                    c.questions.length,
                ]),
            ),
            '',
        );
    }
    return lines.join('\n');
}
