import type { RankBatch } from '../phases/rank/readings.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderRankReport(batch: RankBatch): string {
    const lines: string[] = [];
    lines.push('## Rank', '');
    if (!batch.domain || batch.rows.every((r) => r.ladder === 'unread')) {
        lines.push(
            'No reading yet. Set `domain` in the site config once the site is live and run `seo rank`.',
            '',
        );
        return lines.join('\n');
    }
    lines.push(
        `- **Domain**: ${batch.domain}, read ${batch.readAt?.slice(0, 10) ?? ''} on the same mobile, city-level, depth-twenty pages the screen used`,
    );
    lines.push(
        `- **Ladder**: ${batch.counts.top} top three, ${batch.counts.first_page} first page, ${batch.counts.edge} on the edge, ${batch.counts.second_page} second page, ${batch.counts.absent} absent, ${batch.counts.unread} unread`,
    );
    lines.push(`- **Wrong page ranking**: ${batch.mismatches}`);
    lines.push(
        `- **By page type**: ${Object.entries(batch.byPageType)
            .map(([t, v]) => `${t} ${v.firstPage}/${v.tracked} on the first page`)
            .join(', ')}`,
        '',
    );
    lines.push(
        table(
            [
                'Keyword',
                'Language',
                'Page',
                'Role',
                'Position',
                'Ranking URL',
                'Matches plan',
                'Pack',
                'Meaning',
            ],
            batch.rows.map((r) => [
                `\`${r.keyword}\``,
                r.language,
                r.pageKey,
                r.role,
                r.position ?? (r.ladder === 'unread' ? '' : 'absent'),
                r.url ?? '',
                r.pathMatches === null ? '' : r.pathMatches ? 'yes' : 'no',
                r.packPresent === null
                    ? ''
                    : r.packHasBusiness
                      ? 'in it'
                      : r.packPresent
                        ? 'not in it'
                        : 'none',
                r.meaning,
            ]),
        ),
        '',
    );
    return lines.join('\n');
}
