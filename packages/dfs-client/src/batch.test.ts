import { describe, expect, it } from 'vitest';

import { isAdsSafeKeyword, uniqueKeywords } from './batch.js';

describe('isAdsSafeKeyword', () => {
    it('refuses punctuation the volume endpoint rejects', () => {
        expect(isAdsSafeKeyword('plumbers r us, ltd')).toBe(false);
        expect(isAdsSafeKeyword('how much does a plumber cost?')).toBe(false);
        expect(isAdsSafeKeyword('plumber northbridge')).toBe(true);
        expect(isAdsSafeKeyword('café plumbing')).toBe(true);
        expect(isAdsSafeKeyword('')).toBe(false);
    });
});

describe('uniqueKeywords', () => {
    it('dedupes by lowercase nfc form and keeps the first spelling', () => {
        expect(uniqueKeywords(['Boiler Repair', 'boiler repair', ' boiler  repair '])).toEqual([
            'Boiler Repair',
        ]);
    });
});
