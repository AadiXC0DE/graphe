/** Holding a run between steps, so somebody can take the machine back.
 *
 *  Stop ends a turn. This does not: it parks the agent loop where it stands —
 *  genuinely parked, the promise the extension hook handed back has not
 *  resolved — so nothing else happens until it is let go, and what happens next
 *  reads the world again rather than trusting what it remembered.
 */

import { describe, expect, it } from 'vitest';

import { Paused } from '../src/agent/pi/adapter';

describe('a run held between steps', () => {
  it('lets everything through while nobody is holding it', async () => {
    const paused = new Paused();
    expect(paused.on).toBe(false);
    await expect(paused.gate()).resolves.toBeUndefined();
  });

  it('holds until it is let go, and then carries on', async () => {
    const paused = new Paused();
    paused.hold(true);
    expect(paused.on).toBe(true);

    let through = false;
    const waiting = paused.gate().then(() => {
      through = true;
    });
    // Still there. A held run that quietly carries on is not a held run.
    await Promise.resolve();
    expect(through).toBe(false);

    paused.hold(false);
    await waiting;
    expect(through).toBe(true);
    expect(paused.on).toBe(false);
  });

  it('lets go of everything waiting, not only the first', async () => {
    const paused = new Paused();
    paused.hold(true);
    let done = 0;
    const all = Promise.all([
      paused.gate().then(() => { done += 1; }),
      paused.gate().then(() => { done += 1; }),
      paused.gate().then(() => { done += 1; }),
    ]);
    paused.hold(false);
    await all;
    expect(done).toBe(3);
  });

  /** A held turn must never outlive the stop that was meant to end it. */
  it('is released by a stop as well as by a resume', async () => {
    const paused = new Paused();
    paused.hold(true);
    const waiting = paused.gate();
    paused.letGo();
    await expect(waiting).resolves.toBeUndefined();
    // Still holding, so the next step waits too — stopping releases the ones
    // already waiting rather than turning the hold off behind somebody's back.
    expect(paused.on).toBe(true);
  });

  it('holds again after being let go', async () => {
    const paused = new Paused();
    paused.hold(true);
    paused.hold(false);
    await expect(paused.gate()).resolves.toBeUndefined();
    paused.hold(true);
    let through = false;
    void paused.gate().then(() => { through = true; });
    await Promise.resolve();
    expect(through).toBe(false);
    paused.hold(false);
  });
});
