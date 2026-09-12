import { describe, expect, it } from 'vitest';

import { formatTable } from './output.js';

describe('formatTable', () => {
    it('pads columns to the widest cell and blanks nulls', () => {
        expect(
            formatTable([
                { a: 'x', b: 1 },
                { a: 'longer', b: null },
            ]),
        ).toBe(['a       b', '------  -', 'x       1', 'longer'].join('\n'));
    });
});
