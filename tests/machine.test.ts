/** How much this computer can carry, and the queue that stopped it falling over.
 *
 * The incident these cover: four pieces of background work started together on
 * a sixteen-gigabyte laptop, each one putting a gigabyte and a half of
 * dependencies back at the same time. The machine had to be restarted with the
 * power button.
 */

import { describe, expect, it } from 'vitest';

import { EACH_NEEDS, KEPT_BACK, howManyFit, oneAtATime } from '../src/work/machine';

const GB = 1024 ** 3;

describe('howManyFit — asking the computer instead of assuming', () => {
  it('never hands back more than was asked for', () => {
    expect(howManyFit({ memory: 128 * GB, cores: 64 }, 4)).toBe(4);
  });

  it('gives a small machine fewer than a board would have started', () => {
    // Eight gigabytes: four kept back for the person, four left — two pieces.
    expect(howManyFit({ memory: 8 * GB, cores: 8 }, 4)).toBe(2);
  });

  it('never answers zero, because work that never starts is worse than slow', () => {
    expect(howManyFit({ memory: 2 * GB, cores: 1 }, 4)).toBe(1);
    expect(howManyFit({ memory: 0, cores: 0 }, 4)).toBe(1);
  });

  it('leaves the machine half its processors', () => {
    expect(howManyFit({ memory: 256 * GB, cores: 4 }, 8)).toBe(2);
  });

  it('keeps enough back for the app and whoever owns the laptop', () => {
    const room = howManyFit({ memory: 16 * GB, cores: 16 }, 8);
    expect(room * EACH_NEEDS).toBeLessThanOrEqual(16 * GB - KEPT_BACK);
  });
});

describe('oneAtATime — the install that took the laptop down', () => {
  it('never lets two run together', async () => {
    const inTurn = oneAtATime();
    let going = 0;
    let most = 0;
    const job = async (): Promise<void> => {
      going += 1;
      most = Math.max(most, going);
      await new Promise((done) => setTimeout(done, 5));
      going -= 1;
    };
    await Promise.all([1, 2, 3, 4].map(() => inTurn(job)));
    expect(most).toBe(1);
  });

  it('runs them in the order they asked', async () => {
    const inTurn = oneAtATime();
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        inTurn(async () => {
          await new Promise((done) => setTimeout(done, 5));
          order.push(n);
        }),
      ),
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it('does not pass one copy’s failure on to the next', async () => {
    const inTurn = oneAtATime();
    await expect(inTurn(() => Promise.reject(new Error('install failed')))).rejects.toThrow(
      'install failed',
    );
    await expect(inTurn(() => Promise.resolve('installed'))).resolves.toBe('installed');
  });
});
