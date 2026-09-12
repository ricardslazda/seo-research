import type { ClusterReading } from '../phases/cluster/readings.js';
import type { DerivedEvidence } from './evidence.js';

export function serviceAngle(cluster: ClusterReading | null, term: string | null): string {
    if (!cluster)
        return `The conversion page for ${term ?? 'this service'}: what it includes, what it costs, how fast the callback comes.`;
    const members = cluster.members.filter((m) => m.role === 'member').map((m) => m.text);
    const question = cluster.questions[0];
    const parts = [`The one page for "${cluster.primaryKeyword}"`];
    if (members.length > 0)
        parts.push(`answering ${members.map((m) => `"${m}"`).join(' and ')} on the page`);
    if (question) parts.push(`and the question "${question}"`);
    parts.push(
        cluster.intentFinal === 'informational'
            ? 'as a guide with figures rather than a sales page'
            : 'with its own price rows and a callback',
    );
    return parts.join(', ') + '.';
}

export function homeAngle(cluster: ClusterReading | null, basePlace: string): string {
    return `The ${cluster?.primaryKeyword ?? 'trade'} hub for ${basePlace}: every service, its starting price and the response promise on one page.`;
}

export function guideAngle(cluster: ClusterReading): string {
    return `Answers "${cluster.primaryKeyword}" in figures, updated when prices move, and links to the service that does the work.`;
}

export function areaAngle(town: string, derived: DerivedEvidence | null): string {
    if (!derived)
        return `${town}: the services with demand here, who already serves the town, and how far it is from base.`;
    const distance =
        derived.distanceKm !== null
            ? `${derived.distanceKm} km from base`
            : 'within the service area';
    const competition =
        derived.competitorsWithTownPage.length === 0
            ? 'no other town page yet'
            : `${derived.competitorsWithTownPage.length} other town pages`;
    const pack = derived.packSize !== null ? `a pack of ${derived.packSize}` : 'no pack';
    return `${town}: ${distance}, ${competition}, ${pack}; leads with ${derived.servicesWithDemand.slice(0, 3).join(', ') || 'the trade term'}.`;
}
