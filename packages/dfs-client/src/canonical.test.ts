import { describe, expect, it } from 'vitest';

import { canonicalJson, requestHash } from './canonical.js';

const path = '/v3/keywords_data/google_ads/search_volume/live';
const unordered = { unorderedArrays: ['keywords'] };

describe('requestHash', () => {
    it('ignores key order', () => {
        expect(requestHash(path, { a: 1, b: 2 })).toBe(requestHash(path, { b: 2, a: 1 }));
    });

    it('sorts and dedupes the arrays declared unordered', () => {
        const a = requestHash(path, { keywords: ['b', 'a', 'a'] }, unordered);
        const b = requestHash(path, { keywords: ['a', 'b'] }, unordered);
        expect(a).toBe(b);
    });

    it('keeps the order of every other array', () => {
        const a = requestHash(path, { filters: ['x', 'y'] }, unordered);
        const b = requestHash(path, { filters: ['y', 'x'] }, unordered);
        expect(a).not.toBe(b);
    });

    it('normalizes strings to NFC and trims them', () => {
        const composed = 'caf\u00e9';
        const decomposed = 'cafe\u0301';
        expect(requestHash(path, { keyword: ` ${decomposed} ` })).toBe(
            requestHash(path, { keyword: composed }),
        );
    });

    it('drops null and undefined fields', () => {
        expect(requestHash(path, { a: 1, b: null, c: undefined })).toBe(
            requestHash(path, { a: 1 }),
        );
    });

    it('formats whole floats like integers', () => {
        expect(canonicalJson({ depth: 20.0 })).toBe('{"depth":20}');
    });

    it('refuses a non-finite number', () => {
        expect(() => canonicalJson({ depth: Number.NaN })).toThrow(/non-finite/);
    });

    it('separates the same body on different paths', () => {
        expect(requestHash('/a', { k: 1 })).not.toBe(requestHash('/b', { k: 1 }));
    });
});
