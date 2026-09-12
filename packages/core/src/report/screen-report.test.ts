import { describe, expect, it } from 'vitest';

import type { ScreenBatch } from '../phases/screen/readings.js';
import { renderScreenReport } from './screen-report.js';

const batch: ScreenBatch = {
    languages: ['en'],
    thresholds: { en: { reject_above_rd: '150' } },
    distribution: {
        en: {
            measured: 1,
            belowFloor: 1,
            missing: 0,
            formSuspect: 0,
            volume: { p25: 210, p50: 210, p75: 210, max: 210 },
            rdMedianTop5: null,
            rdMedianBusinesses: { p25: 12, p50: 12, p75: 12, max: 12 },
            packMedianReviews: { p25: 34.5, p50: 34.5, p75: 34.5, max: 34.5 },
            bidHigh: { p25: 2.34, p50: 2.34, p75: 2.34, max: 2.34 },
        },
    },
    rows: [
        {
            candidateId: 1,
            service: 'plumber',
            place: 'northbridge',
            localFacts: 'yes',
            verdict: 'go',
            verdictReason: 'demand and a soft field',
            chosen: true,
            flags: ['better_form:en:plumbers northbridge'],
            languages: {
                en: {
                    keywordId: 10,
                    keyword: 'plumber northbridge',
                    volume: 210,
                    volumeStatus: 'measured',
                    probe: 'measured',
                    controlVolume: 320,
                    cpc: 2.49,
                    bidHigh: 2.34,
                    valueProxy: 491.4,
                    aggregatedWith: [],
                    bestForm: { text: 'plumbers northbridge', volume: 260 },
                    serpId: 3,
                    firstOrganicRank: 1,
                    above: {},
                    pack: { rank: 3, size: 2, medianReviews: 34.5 },
                    directoriesTop10: 6,
                    rdMedianTop5: null,
                    rdMedianBusinesses: 12,
                    top10: [],
                    paa: ['How much does a plumber cost?'],
                    related: [],
                    demandEvidence: ['volume', 'paa', 'pack'],
                },
            },
        },
        {
            candidateId: 2,
            service: 'plumber',
            place: 'eastfield',
            localFacts: null,
            verdict: 'reject',
            verdictReason: 'the page shows nothing but directories and the pack is closed',
            chosen: false,
            flags: [],
            languages: {
                en: {
                    keywordId: 11,
                    keyword: 'plumber eastfield',
                    volume: null,
                    volumeStatus: 'below_floor',
                    probe: 'below_floor',
                    controlVolume: 320,
                    cpc: null,
                    bidHigh: null,
                    valueProxy: null,
                    aggregatedWith: [],
                    bestForm: null,
                    serpId: 4,
                    firstOrganicRank: 4,
                    above: { paid: 1, local_pack: 2 },
                    pack: { rank: 2, size: 2, medianReviews: null },
                    directoriesTop10: 8,
                    rdMedianTop5: 40,
                    rdMedianBusinesses: null,
                    top10: [],
                    paa: [],
                    related: [],
                    demandEvidence: ['pack'],
                },
            },
        },
    ],
};

describe('renderScreenReport', () => {
    it('renders calibration, candidates, flags, questions, domains and verdicts', () => {
        const report = renderScreenReport(
            batch,
            {
                site: 'northbridge-plumbing',
                generatedAt: '2026-09-02T12:00:00.000Z',
                costUsd: 0.204,
            },
            [
                {
                    domain: 'directory-one.example',
                    kind: 'directory',
                    kind_by: 'rule',
                    referring_domains: 410,
                    appearances: 2,
                    services: 1,
                    places: 1,
                    best_rank: 1,
                },
            ],
        );
        expect(report).toContain('# Market screen: northbridge-plumbing');
        expect(report).toContain('reject_above_rd = 150');
        expect(report).toContain('median 210');
        expect(report).toContain(
            '| plumber | northbridge | `plumber northbridge` | 210 | measured | 2.34 | 1 | none | #3, 2 listed, median 34.5 reviews | 6 |  | 12 | volume, paa, pack | yes | go (chosen) |',
        );
        expect(report).toContain(
            '| plumber | eastfield | `plumber eastfield` | below floor | below_floor |  | 4 | 1 paid, 2 local_pack | #2, 2 listed, median ? reviews | 8 | 40 |  | pack |  | reject |',
        );
        expect(report).toContain(
            '- **plumber in northbridge**: better_form:en:plumbers northbridge',
        );
        expect(report).toContain('`How much does a plumber cost?`');
        expect(report).toContain(
            '| directory-one.example | directory | rule | 410 | 2 | 1 | 1 | 1 |',
        );
        expect(report).toContain('- **Chosen**: plumber in northbridge');
        expect(report).toContain(
            '  - plumber in eastfield: the page shows nothing but directories and the pack is closed',
        );
    });
});
