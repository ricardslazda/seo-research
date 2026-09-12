import type { Plan } from '../plan/schema.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderPlanReport(plan: Plan): string {
    const lines: string[] = [];
    const languages = plan.site.languages;
    lines.push('## Plan', '');
    const counts: Record<string, number> = {};
    for (const p of plan.pages) counts[p.status] = (counts[p.status] ?? 0) + 1;
    const derived = plan.pages.filter((p) => p.evidence?.level === 'derived').length;
    const verified = plan.pages.filter((p) => p.evidence?.level === 'verified').length;
    lines.push(
        `- **Pages**: ${plan.pages.length} per locale; ${counts['planned'] ?? 0} planned, ${counts['blocked'] ?? 0} blocked, ${counts['not-written'] ?? 0} not written; town evidence derived for ${derived}, verified for ${verified}`,
    );
    lines.push(
        `- **Budget**: ${languages.map((l) => `${l} ${plan.site.pageBudget[l] ?? 'unset'}`).join(', ')}`,
    );
    lines.push(
        '- **Build order**: home, then services with their price rows, then areas, then intersections, then guides. Every page below the home has two body-copy referrers.',
        '',
    );
    lines.push(
        table(
            [
                'Tier',
                'Key',
                'Type',
                ...languages.flatMap((l) => [`${l} path`, `${l} primary keyword`, `${l} demand`]),
                'Linked from',
                'Status',
            ],
            plan.pages.map((p) => [
                p.buildTier,
                p.translationKey,
                p.type,
                ...languages.flatMap((l) => [
                    p.locales[l]?.path ?? '',
                    p.locales[l]?.primaryKeyword ? `\`${p.locales[l]!.primaryKeyword}\`` : '',
                    p.locales[l]?.demand ?? '',
                ]),
                p.linkedFrom.join(', '),
                p.status,
            ]),
        ),
        '',
    );
    lines.push('## Angles and evidence', '');
    for (const p of plan.pages) {
        lines.push(`- **${p.translationKey}**: ${p.angle ?? '(no angle)'}`);
        if (p.evidence) for (const fact of p.evidence.localFacts) lines.push(`  - ${fact}`);
    }
    lines.push('');
    const withNotes = plan.pages.filter((p) => p.notes.length > 0);
    lines.push('## What each page still needs', '');
    if (withNotes.length === 0) lines.push('Nothing. Every brief is complete.', '');
    for (const p of withNotes) lines.push(`- **${p.translationKey}**: ${p.notes.join('; ')}`);
    if (withNotes.length > 0) lines.push('');
    lines.push('## Not written, and why', '');
    if (plan.notWritten.length === 0) lines.push('Nothing was refused.', '');
    for (const n of plan.notWritten) lines.push(`- **${n.subject}**: ${n.reason}`);
    if (plan.notWritten.length > 0) lines.push('');
    return lines.join('\n');
}
