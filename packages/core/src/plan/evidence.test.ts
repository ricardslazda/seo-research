import { describe, expect, it } from 'vitest';

import { haversineKm, seasonality } from './evidence.js';

describe('evidence helpers', () => {
    it('measures a fifth of a degree of longitude near the equator at about 22 kilometres', () => {
        const km = haversineKm({ lat: 1, lng: 1 }, { lat: 1, lng: 1.2 });
        expect(km).toBeGreaterThan(22);
        expect(km).toBeLessThan(22.5);
    });
    it('finds the peak and trough months across series', () => {
        const a = [6, 7, 8].map((month) => ({ month, search_volume: 100 }));
        const b = [
            { month: 1, search_volume: 5 },
            { month: 7, search_volume: 50 },
        ];
        expect(seasonality([a, b])).toEqual({
            peakMonths: ['July', 'June', 'August'],
            troughMonth: expect.any(String),
        });
        expect(seasonality([])).toEqual({ peakMonths: [], troughMonth: null });
    });
});
