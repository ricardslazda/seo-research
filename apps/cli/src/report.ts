import {
    costSummary,
    exportDecisions,
    loadScreen,
    readCompetitors,
    buildPlan,
    readClusters,
    readKeywords,
    readOffpage,
    readRank,
    readScreen,
    renderCompetitorsReport,
    renderClustersReport,
    renderPlanReport,
    renderKeywordsReport,
    renderOffpageReport,
    renderRankReport,
    renderScreenReport,
    screenDomainsQuery,
    writeOutputs,
    type DomainRow,
} from '@seo/core';

import type { OpenSite } from './site.js';

export function writeSiteReport(site: OpenSite): string[] {
    const batch = readScreen(loadScreen(site.db, site.config, site.reference));
    const context = {
        db: site.db,
        config: site.config,
        reference: site.reference,
        site: site.slug,
    };
    const domains = screenDomainsQuery.run(context, {}).rows as unknown as DomainRow[];
    const costUsd = costSummary(site.db).reduce((sum, row) => sum + row.cost, 0);
    const screen = renderScreenReport(
        batch,
        { site: site.slug, generatedAt: new Date().toISOString(), costUsd },
        domains,
    );
    const competitors = readCompetitors(site.db, site.config, site.reference);
    const sections = [screen];
    if (competitors.rows.length > 0)
        sections.push(renderCompetitorsReport(competitors, site.config.languages));
    const expanded = readKeywords(site.db, site.config);
    if (expanded.rows.length > 0) sections.push(renderKeywordsReport(expanded));
    const clusters = readClusters(site.db, site.config, site.reference);
    if (clusters.clusters.length > 0) sections.push(renderClustersReport(clusters));
    if (clusters.clusters.length > 0)
        sections.push(renderPlanReport(buildPlan(site.db, site.config, site.reference)));
    const offpage = readOffpage(site.db, site.config, site.reference);
    if (offpage.citations.length > 0 || offpage.listings.length > 0)
        sections.push(renderOffpageReport(offpage));
    const rank = readRank(site.db, site.config, site.reference);
    if (rank.rows.some((r) => r.ladder !== 'unread')) sections.push(renderRankReport(rank));
    return writeOutputs(site.siteDir, {
        'report.md': sections.join('\n'),
        'decisions.jsonl': exportDecisions(site.db),
    });
}
