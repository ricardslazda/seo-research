import { describe, expect, it } from 'vitest';

import { ladderOf, meaningOf } from './readings.js';

describe('rank ladder', () => {
    it('reads a position into the band it belongs to', () => {
        expect(ladderOf(null, false)).toBe('unread');
        expect(ladderOf(null, true)).toBe('absent');
        expect(ladderOf(2, true)).toBe('top');
        expect(ladderOf(7, true)).toBe('first_page');
        expect(ladderOf(12, true)).toBe('edge');
        expect(ladderOf(18, true)).toBe('second_page');
        expect(meaningOf('edge', true)).toMatch(/rewrite pays/);
        expect(meaningOf('first_page', false)).toMatch(/different page/);
        expect(meaningOf('absent', null)).toMatch(/indexing/);
    });
});
