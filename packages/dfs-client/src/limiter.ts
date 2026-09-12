import type { Family } from './endpoint.js';

export interface LimiterConfig {
    concurrency?: number;
    minGapMs?: number;
}

export interface LimiterClock {
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
}

export type Limiter = <T>(work: () => Promise<T>) => Promise<T>;

export function createLimiter(config: LimiterConfig = {}, clock: LimiterClock = {}): Limiter {
    const concurrency = config.concurrency ?? Number.POSITIVE_INFINITY;
    const minGap = config.minGapMs ?? 0;
    const now = clock.now ?? (() => performance.now());
    const sleep = clock.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));

    let active = 0;
    let lastSlot = Number.NEGATIVE_INFINITY;
    const waiting: (() => void)[] = [];

    const release = (): void => {
        active--;
        const resume = waiting.shift();
        if (resume) resume();
    };

    return async (work) => {
        if (active >= concurrency) {
            await new Promise<void>((resolve) => waiting.push(resolve));
        }
        active++;
        try {
            const slot = Math.max(now(), lastSlot + minGap);
            lastSlot = slot;
            const wait = slot - now();
            if (wait > 0) await sleep(wait);
            return await work();
        } finally {
            release();
        }
    };
}

export const familyLimits: Record<Family, LimiterConfig> = {
    ads: { concurrency: 1, minGapMs: 5000 },
    serp: { concurrency: 5 },
    labs: { concurrency: 5 },
    backlinks: { concurrency: 2 },
    onpage: { concurrency: 5 },
    free: {},
};

export function createFamilyLimiters(clock: LimiterClock = {}): Record<Family, Limiter> {
    const out = {} as Record<Family, Limiter>;
    for (const family of Object.keys(familyLimits) as Family[]) {
        out[family] = createLimiter(familyLimits[family], clock);
    }
    return out;
}
