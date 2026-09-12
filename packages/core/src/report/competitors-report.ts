import type { CompetitorsData } from '../phases/competitors/readings.js';

const cell = (value: unknown): string =>
    value === null || value === undefined ? '' : String(value).replace(/\|/g, '\\|');
const table = (columns: string[], rows: unknown[][]): string =>
    [
        `| ${columns.join(' | ')} |`,
        `| ${columns.map(() => '---').join(' | ')} |`,
        ...rows.map((row) => `| ${row.map(cell).join(' | ')} |`),
    ].join('\n');

export function renderCompetitorsReport(data: CompetitorsData, languages: string[]): string {
    const lines: string[] = [];
    lines.push('## Competitors', '');
    if (data.rows.length === 0) {
        lines.push('None read yet. Run `seo competitors`.', '');
        return lines.join('\n');
    }
    lines.push(
        table(
            [
                'Domain',
                'Kind',
                'Pages on screen',
                'Services',
                'Places',
                'Referring domains',
                'Database keywords',
                'Earning pages',
                'Site keywords',
                'Home words',
                'Questions',
                'Phones',
                'Prices',
                'Rating',
                'Menu items',
            ],
            data.rows.map((r) => [
                r.strongest ? `**${r.domain}**` : r.domain,
                r.kind,
                r.pages,
                r.services,
                r.places,
                r.referringDomains ?? '',
                r.labsKeywords ?? '',
                r.earningPages,
                r.siteIdeas,
                r.homeWords ?? '',
                r.homeQuestions ?? '',
                r.homePhones ?? '',
                r.homePrices === null ? '' : r.homePrices ? 'yes' : 'no',
                r.homeRating !== null ? `${r.homeRating} (${r.homeRatingCount ?? '?'})` : '',
                r.menuItems ?? '',
            ]),
        ),
        '',
    );

    lines.push('## What earns', '');
    lines.push(
        'Ranked by estimated traffic value per keyword, so a page punching above its weight comes first.',
        '',
    );
    lines.push(
        table(
            [
                'Page',
                'Type',
                'Keywords',
                'Value',
                'Value per keyword',
                'Words',
                'Questions',
                'Prices',
            ],
            data.pages
                .slice(0, 20)
                .map((p) => [
                    p.url,
                    p.pageType,
                    p.keywordsCount ?? '',
                    p.etv ?? '',
                    p.valuePerKeyword ?? '',
                    p.wordCount ?? '',
                    p.questionsCount ?? '',
                    p.hasPrices === null ? '' : p.hasPrices ? 'yes' : 'no',
                ]),
        ),
        '',
    );

    lines.push('## Service menus', '');
    lines.push(
        'The navigation of each competitor home page: what they chose to have a page for.',
        '',
    );
    for (const row of data.rows) {
        const items = data.menus.filter((m) => m.domain === row.domain);
        if (items.length === 0) continue;
        lines.push(
            `- **${row.domain}**: ${items.map((m) => `${m.text} (${m.pageType})`).join('; ')}`,
        );
    }
    lines.push('');

    lines.push('## Seed keywords', '');
    lines.push(
        'Observed forms: what competitors rank for and what Google Ads derives from their sites. Volume is at the location the source used.',
        '',
    );
    lines.push(
        table(
            [
                'Keyword',
                'Language',
                'Source',
                'Volume',
                'Bid',
                'Difficulty',
                'Intent label',
                'Competitors',
                'Best position',
            ],
            data.seeds
                .slice(0, 60)
                .map((s) => [
                    `\`${s.text}\``,
                    s.language,
                    s.source,
                    s.volumeStatus === 'measured' ? s.volume : s.volumeStatus,
                    s.bidHigh ?? '',
                    s.difficulty ?? '',
                    s.intent ?? '',
                    s.domains,
                    s.bestPosition ?? '',
                ]),
        ),
        '',
    );

    lines.push('## Coverage and gaps', '');
    lines.push(
        'Per service and place: how many competitors hold a purpose-built page in the top ten, per language. A gap is a cell nobody holds.',
        '',
    );
    const services = [...new Set(data.coverage.map((c) => c.service))];
    const places = [...new Set(data.coverage.map((c) => c.place))];
    lines.push(
        table(
            ['Service', ...places],
            services.map((service) => [
                service,
                ...places.map((place) =>
                    languages
                        .map((language) => {
                            const c = data.coverage.find(
                                (x) =>
                                    x.service === service &&
                                    x.place === place &&
                                    x.language === language,
                            );
                            if (!c) return `${language}: -`;
                            return `${language}: ${c.competitorsWithPage.length}/${c.servicePagesAnywhere}${c.packPresent ? ' +pack' : ''}`;
                        })
                        .join(', '),
                ),
            ]),
        ),
        '',
    );
    const gaps = data.coverage.filter((c) => c.gap);
    lines.push(`- **Gaps**: ${gaps.length} of ${data.coverage.length} cells`);
    for (const language of languages) {
        const own = gaps.filter((g) => g.language === language);
        if (own.length > 0)
            lines.push(
                `  - ${language}: ${own.map((g) => `${g.service} in ${g.place}`).join(', ')}`,
            );
    }
    lines.push('');
    return lines.join('\n');
}
