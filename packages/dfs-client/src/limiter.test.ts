import { describe, expect, it } from 'vitest';

import { createLimiter } from './limiter.js';

describe('createLimiter', () => {
    it('keeps a minimum gap between starts', async () => {
        let clock = 0;
        const slept: number[] = [];
        const limit = createLimiter(
            { concurrency: 1, minGapMs: 5000 },
            {
                now: () => clock,
                sleep: async (ms) => {
                    slept.push(ms);
                    clock += ms;
                },
            },
        );
        const starts: number[] = [];
        for (let i = 0; i < 3; i++) {
            await limit(async () => {
                starts.push(clock);
            });
        }
        expect(slept).toEqual([5000, 5000]);
        expect(starts).toEqual([0, 5000, 10000]);
    });

    it('never runs more than the allowed concurrency at once', async () => {
        const limit = createLimiter({ concurrency: 2 });
        let active = 0;
        let peak = 0;
        const releases: (() => void)[] = [];
        const work = () =>
            limit(
                () =>
                    new Promise<void>((resolve) => {
                        active++;
                        peak = Math.max(peak, active);
                        releases.push(() => {
                            active--;
                            resolve();
                        });
                    }),
            );
        const all = Promise.all([work(), work(), work()]);
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(active).toBe(2);
        releases.shift()?.();
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(active).toBe(2);
        releases.shift()?.();
        releases.shift()?.();
        await all;
        expect(peak).toBe(2);
    });

    it('releases the slot when the work throws', async () => {
        const limit = createLimiter({ concurrency: 1 });
        await expect(
            limit(async () => {
                throw new Error('boom');
            }),
        ).rejects.toThrow('boom');
        await expect(limit(async () => 'ok')).resolves.toBe('ok');
    });
});
