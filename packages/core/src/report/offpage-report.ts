import type { OffpageBatch } from '../phases/offpage/readings.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderOffpageReport(batch: OffpageBatch): string {
    const lines: string[] = [];
    lines.push('## Off-page', '');
    if (batch.citations.length === 0 && batch.listings.length === 0) {
        lines.push('Nothing read yet. Run `seo offpage`.', '');
        return lines.join('\n');
    }
    lines.push(
        `- **Citations**: ${batch.counts.pursue} to pursue, ${batch.counts.review} to review, ${batch.counts.ignore} to ignore, read from the strongest competitor's profile`,
        '',
    );
    lines.push('### Citations to pursue', '');
    lines.push(
        table(
            ['Domain', 'Kind', 'Rank', 'Links', 'Spam', 'First seen', 'Reason'],
            batch.citations
                .filter((c) => c.verdict === 'pursue')
                .map((c) => [
                    c.domain,
                    c.kind,
                    c.rank ?? '',
                    c.backlinks ?? '',
                    c.spamScore ?? '',
                    (c.firstSeen ?? '').slice(0, 10),
                    c.reason,
                ]),
        ),
        '',
    );
    const review = batch.citations.filter((c) => c.verdict === 'review');
    if (review.length > 0)
        lines.push(
            `- **To review**: ${review.map((c) => `${c.domain} (${c.reason})`).join('; ')}`,
            '',
        );
    lines.push('### Business listings', '');
    lines.push(
        'Per place: listings in the category within the radius, those matching the trade, the share claimed, the median review count of the matching listings (what the pack costs to enter), and who is already there.',
        '',
    );
    lines.push(
        table(
            [
                'Place',
                'Listings',
                'Matching',
                'Claimed',
                'Median reviews',
                'Top listings',
                'Competitors listed',
                'Own listing',
            ],
            batch.listings.map((l) => [
                l.place,
                l.total,
                l.matching,
                l.claimedShare === null ? '' : `${Math.round(l.claimedShare * 100)}%`,
                l.medianVotes ?? '',
                l.top.map((t) => `${t.title} (${t.rating ?? '?'}, ${t.votes ?? 0})`).join('; '),
                l.competitorsListed.join(', '),
                l.own ? `${l.own.title} (${l.own.rating ?? '?'}, ${l.own.votes ?? 0})` : 'none',
            ]),
        ),
        '',
    );
    return lines.join('\n');
}
