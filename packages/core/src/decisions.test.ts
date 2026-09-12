import { describe, expect, it } from 'vitest';

import { openDatabase } from './db/open.js';
import { currentDecision, currentDecisions, writeDecision } from './decisions.js';

describe('decisions', () => {
    it('keeps history and answers with the latest per subject and kind', () => {
        const { db, close } = openDatabase(':memory:');
        const base = {
            subjectType: 'candidate',
            subjectId: '7',
            reason: 'x',
            madeBy: 'rule' as const,
        };
        writeDecision(db, {
            ...base,
            kind: 'verdict',
            value: 'caution',
            madeAt: '2026-09-01T00:00:00Z',
        });
        writeDecision(db, {
            ...base,
            kind: 'verdict',
            value: 'go',
            madeBy: 'human',
            madeAt: '2026-09-02T00:00:00Z',
        });
        writeDecision(db, {
            ...base,
            kind: 'local_facts',
            value: 'yes',
            madeAt: '2026-09-02T00:00:00Z',
        });
        writeDecision(db, {
            ...base,
            subjectId: '8',
            kind: 'verdict',
            value: 'reject',
            madeAt: '2026-09-02T00:00:00Z',
        });
        expect(currentDecision(db, 'candidate', '7', 'verdict')?.value).toBe('go');
        expect(currentDecision(db, 'candidate', '7', 'verdict')?.madeBy).toBe('human');
        expect(currentDecisions(db, 'candidate').size).toBe(3);
        expect(currentDecision(db, 'keyword', '7', 'verdict')).toBeUndefined();
        close();
    });
});
