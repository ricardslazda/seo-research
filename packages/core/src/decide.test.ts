import { describe, expect, it } from 'vitest';

import { openDatabase } from './db/open.js';
import { candidates, places, services } from './db/schema.js';
import { DecideError, decide } from './decide.js';
import { currentDecision } from './decisions.js';

const seeded = () => {
    const { db, close } = openDatabase(':memory:');
    db.insert(services).values({ key: 'plumber', headJson: '{}' }).run();
    db.insert(places)
        .values({ slug: 'northbridge', locationCode: 1, kind: 'city', nameJson: '{}' })
        .run();
    db.insert(candidates).values({ serviceKey: 'plumber', placeSlug: 'northbridge' }).run();
    return { db, close };
};

describe('decide', () => {
    it('writes validated decisions for a candidate', () => {
        const { db, close } = seeded();
        const ids = decide(db, {
            subjectType: 'candidate',
            subjectId: '1',
            decisions: [
                { kind: 'local_facts', value: 'yes' },
                { kind: 'verdict', value: 'go' },
            ],
            reason: 'first screen',
            madeBy: 'human',
        });
        expect(ids).toHaveLength(2);
        expect(currentDecision(db, 'candidate', '1', 'verdict')?.value).toBe('go');
        decide(db, {
            subjectType: 'threshold',
            subjectId: 'keywords:en',
            decisions: [
                { kind: 'page_budget', value: '36' },
                { kind: 'second_language', value: 'take' },
            ],
            reason: 'sized against the teardown',
            madeBy: 'claude',
        });
        expect(currentDecision(db, 'threshold', 'keywords:en', 'page_budget')?.value).toBe('36');
        close();
    });

    it('refuses unknown subjects, kinds and values', () => {
        const { db, close } = seeded();
        const base = { reason: 'r', madeBy: 'claude' as const };
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'candidate',
                subjectId: '9',
                decisions: [{ kind: 'verdict', value: 'go' }],
            }),
        ).toThrow(/does not exist/);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'candidate',
                subjectId: '1',
                decisions: [{ kind: 'verdict', value: 'maybe' }],
            }),
        ).toThrow(/one of go, caution, reject/);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'candidate',
                subjectId: '1',
                decisions: [{ kind: 'colour', value: 'red' }],
            }),
        ).toThrow(/unknown kind/);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'planet',
                subjectId: '1',
                decisions: [{ kind: 'x', value: 'y' }],
            }),
        ).toThrow(DecideError);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'threshold',
                subjectId: 'screen:en',
                decisions: [{ kind: 'reject_below_volume', value: 'ten' }],
            }),
        ).toThrow(/must be a number/);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'threshold',
                subjectId: 'en',
                decisions: [{ kind: 'reject_below_volume', value: '10' }],
            }),
        ).toThrow(/screen:<language>/);
        expect(() =>
            decide(db, {
                ...base,
                subjectType: 'candidate',
                subjectId: '1',
                decisions: [{ kind: 'verdict', value: 'go' }],
                reason: ' ',
            }),
        ).toThrow(/reason is required/);
        close();
    });
});
