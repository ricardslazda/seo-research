import type { KeywordsBatch } from '../phases/keywords/readings.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderKeywordsReport(batch: KeywordsBatch): string {
    const lines: string[] = [];
    lines.push('## Keywords', '');
    if (batch.rows.length === 0) {
        lines.push('None expanded yet. Run `seo keywords`.', '');
        return lines.join('\n');
    }
    for (const language of batch.languages) {
        const counts = batch.counts[language];
        const own = batch.rows.filter((r) => r.language === language);
        lines.push(`### ${language}`, '');
        if (counts) {
            lines.push(
                `- **Expanded**: ${counts.total} keywords in ${counts.forms} form groups; ${counts.measuredCity} with measured city volume`,
            );
            lines.push(
                `- **By source**: ${Object.entries(counts.bySource)
                    .map(([k, v]) => `${k} ${v}`)
                    .join(', ')}`,
            );
            const excluded = Object.entries(counts.excluded);
            lines.push(
                `- **Excluded by rule or decision**: ${excluded.length > 0 ? excluded.map(([k, v]) => `${k} ${v}`).join(', ') : 'none'}`,
            );
            const t = Object.entries(batch.thresholds[language] ?? {});
            lines.push(
                t.length > 0
                    ? `- **Decisions**: ${t.map(([k, v]) => `${k} = ${v}`).join(', ')}`
                    : '- **Decisions**: page budget and second-language verdict not set yet',
            );
            lines.push('');
        }
        lines.push(
            table(
                [
                    'Keyword',
                    'Service',
                    'City volume',
                    'Country volume',
                    'Bid',
                    'Difficulty',
                    'Intent label',
                    'Modifiers',
                    'Sources',
                ],
                own
                    .filter((r) => !r.excluded && r.formPrimary)
                    .slice(0, 50)
                    .map((r) => [
                        `\`${r.text}\``,
                        r.primaryService ?? '',
                        r.volumeCityStatus === 'measured' ? r.volumeCity : r.volumeCityStatus,
                        r.volumeCountry ?? '',
                        r.bidHigh ?? '',
                        r.difficulty ?? '',
                        r.intent ?? '',
                        r.modifiers.join(', '),
                        r.sources.join(', '),
                    ]),
            ),
            '',
        );
        const questions = own
            .filter((r) => !r.excluded && r.modifiers.includes('question'))
            .slice(0, 20);
        if (questions.length > 0)
            lines.push(`- **Questions**: ${questions.map((r) => `\`${r.text}\``).join(', ')}`, '');
        const exclusions = own.filter((r) => r.excluded).slice(0, 25);
        if (exclusions.length > 0)
            lines.push(
                `- **Excluded, examples**: ${exclusions.map((r) => `\`${r.text}\` (${r.excluded})`).join(', ')}`,
                '',
            );
    }
    return lines.join('\n');
}
