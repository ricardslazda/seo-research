import { eq } from 'drizzle-orm';

import type { Db } from './db/open.js';
import { candidates, domains, keywords } from './db/schema.js';
import { writeDecision, type MadeBy } from './decisions.js';

type Check = (value: string) => string | null;

const oneOf =
    (values: string[]): Check =>
    (value) =>
        values.includes(value) ? null : `must be one of ${values.join(', ')}`;
const numeric: Check = (value) => (Number.isFinite(Number(value)) ? null : 'must be a number');
const text: Check = (value) => (value.trim().length > 0 ? null : 'must not be empty');

export const DECISION_KINDS: Record<string, Record<string, Check>> = {
    candidate: {
        local_facts: oneOf(['yes', 'no']),
        verdict: oneOf(['go', 'caution', 'reject']),
        chosen: oneOf(['true', 'false']),
    },
    domain: {
        competitor: oneOf(['true', 'false']),
        strongest: oneOf(['true', 'false']),
        kind: oneOf([
            'business',
            'directory',
            'classifieds',
            'social',
            'marketplace',
            'government',
            'directory_suspect',
            'unknown',
        ]),
    },
    keyword: {
        probe: oneOf(['measured', 'below_floor', 'form_suspect', 'missing']),
        exclude: text,
        shortlist: oneOf(['true', 'false']),
        service: text,
        form_primary: oneOf(['true', 'false']),
        cluster: text,
        intent: oneOf(['commercial', 'informational', 'navigational', 'transactional']),
        page_type: oneOf(['home', 'service', 'place', 'intersection', 'guide', 'other']),
    },
    citation: {
        verdict: oneOf(['pursue', 'review', 'ignore']),
    },
    page: {
        angle: text,
        justification: text,
        fact_1: text,
        fact_2: text,
        fact_3: text,
        source: text,
        build: oneOf(['true', 'false']),
    },
    threshold: {
        reject_below_volume: numeric,
        reject_above_rd: numeric,
        pack_ceiling: numeric,
        bid_floor: numeric,
        page_budget: numeric,
        second_language: oneOf(['take', 'leave']),
    },
};

export interface DecideInput {
    subjectType: string;
    subjectId: string;
    decisions: { kind: string; value: string }[];
    reason: string;
    madeBy: MadeBy;
    runId?: number | null;
    evidenceRawId?: number | null;
}

export class DecideError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'DecideError';
    }
}

function assertSubject(db: Db, subjectType: string, subjectId: string): void {
    if (subjectType === 'candidate') {
        const id = Number(subjectId);
        if (
            !Number.isInteger(id) ||
            !db.select({ id: candidates.id }).from(candidates).where(eq(candidates.id, id)).get()
        ) {
            throw new DecideError(`candidate ${subjectId} does not exist`);
        }
    } else if (subjectType === 'keyword') {
        const id = Number(subjectId);
        if (
            !Number.isInteger(id) ||
            !db.select({ id: keywords.id }).from(keywords).where(eq(keywords.id, id)).get()
        ) {
            throw new DecideError(`keyword ${subjectId} does not exist`);
        }
    } else if (subjectType === 'domain') {
        if (
            !db
                .select({ domain: domains.domain })
                .from(domains)
                .where(eq(domains.domain, subjectId))
                .get()
        ) {
            throw new DecideError(
                `domain ${subjectId} was never seen; it must appear in a stored result page`,
            );
        }
    } else if (subjectType === 'citation') {
        if (!/^[a-z0-9.-]+$/.test(subjectId))
            throw new DecideError('citation subject must be a domain');
    } else if (subjectType === 'page') {
        if (!/^[a-z0-9-]+$/.test(subjectId))
            throw new DecideError('page subject must be a translation key');
    } else if (subjectType === 'threshold') {
        if (!/^(screen|keywords):[a-z]{2}$/.test(subjectId)) {
            throw new DecideError(
                'threshold subject must look like screen:<language> or keywords:<language>',
            );
        }
    }
}

export function decide(db: Db, input: DecideInput): number[] {
    const kinds = DECISION_KINDS[input.subjectType];
    if (!kinds)
        throw new DecideError(
            `unknown subject type "${input.subjectType}"; one of ${Object.keys(DECISION_KINDS).join(', ')}`,
        );
    if (input.decisions.length === 0)
        throw new DecideError('at least one --decision kind=value is required');
    if (!input.reason.trim()) throw new DecideError('a reason is required');
    for (const { kind, value } of input.decisions) {
        const check = kinds[kind];
        if (!check)
            throw new DecideError(
                `unknown kind "${kind}" for ${input.subjectType}; one of ${Object.keys(kinds).join(', ')}`,
            );
        const problem = check(value);
        if (problem) throw new DecideError(`${kind}=${value}: ${problem}`);
    }
    assertSubject(db, input.subjectType, input.subjectId);
    return input.decisions.map(({ kind, value }) =>
        writeDecision(db, {
            runId: input.runId ?? null,
            subjectType: input.subjectType,
            subjectId: input.subjectId,
            kind,
            value,
            reason: input.reason,
            madeBy: input.madeBy,
            evidenceRawId: input.evidenceRawId ?? null,
        }),
    );
}
