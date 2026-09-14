/** Waiting out a provider's bad minute without doing the work twice.
 *
 * 9.5 asks that an idempotent retry is distinguishable from repeating a
 * side-effecting tool, and that the retry state is visible. The two lists
 * themselves (which wording is settled, which is worth waiting) are proven in
 * `tests/transient.test.ts`, the helper's shorter ladder in
 * `tests/helpers-keep-going.test.ts`, the wait as a line on screen in
 * `tests/holding.test.ts`, and the billing split in `tests/cost-wiring.test.ts`.
 *
 * What is left for here is the distinction itself, said once: a transient
 * failure resumes with an instruction to carry on and the *wait* is what makes
 * it safe, so the wait has a ceiling as well as a floor, and a settled failure
 * never reaches the ladder at all. That is the difference between retrying an
 * idempotent request and running somebody's tool a second time.
 */

import { describe, expect, it } from 'vitest';

import { CARRY_ON, HELPER_WAITS_MS, isTransientStreamError, WAITS_MS } from '../../src/agent/pi/transient';

const minutes = (ms: readonly number[]): number => ms.reduce((total, one) => total + one, 0) / 60_000;

/* ========================================================================== */

describe('a failure that is worth waiting for', () => {
  it('is waited out, and the work is picked up rather than started again', () => {
    expect(isTransientStreamError('429 Too Many Requests')).toBe(true);
    expect(isTransientStreamError('upstream connect error or disconnect')).toBe(true);
    // The instruction never repeats the request — the finished part of the work
    // is still in the conversation, and asking for it twice is how a list gets
    // done twice.
    expect(CARRY_ON).toContain('Do not start again');
    expect(CARRY_ON).toContain('do not repeat anything already finished');
    expect(CARRY_ON).toContain('Pick up exactly where you left off');
  });

  it('is waited for a bounded time, so a retry cannot hold a turn for ever', () => {
    expect(WAITS_MS.length).toBeGreaterThan(0);
    // Monotonic, and about three quarters of an hour in total rather than an
    // afternoon: a provider that is down for longer than this is a thing to
    // tell somebody about, not to keep waiting on.
    for (let at = 1; at < WAITS_MS.length; at += 1) {
      expect(WAITS_MS[at]!).toBeGreaterThan(WAITS_MS[at - 1]!);
    }
    expect(minutes(WAITS_MS)).toBeGreaterThan(30);
    expect(minutes(WAITS_MS)).toBeLessThanOrEqual(60);
  });

  it('fits inside the turn a helper is measured against', () => {
    // A helper is killed if it says nothing for five minutes, so its ladder has
    // to end inside that or the later rungs could never be reached.
    expect(minutes(HELPER_WAITS_MS)).toBeLessThan(5);
    expect(HELPER_WAITS_MS[HELPER_WAITS_MS.length - 1]!).toBeLessThan(5 * 60_000);
  });
});

describe('a failure that is an answer rather than a wobble', () => {
  it('never reaches the ladder, so nothing is run a second time', () => {
    // A key that is not allowed, an account with nothing left in it, a
    // permission that will not change in the next half hour. Waiting changes
    // none of them, and a retry would re-run whatever tool was in flight.
    for (const settled of [
      'insufficient_quota',
      'You exceeded your current quota',
      'billing hard limit reached',
      'invalid_api_key',
      'Permission denied',
      'not authorized',
      'authentication failed',
    ]) {
      expect(isTransientStreamError(settled), settled).toBe(false);
    }
  });

  it('is not confused by a number that is not a status', () => {
    // `\b429\b` is a rate limit; "1429 tokens" is a length.
    expect(isTransientStreamError('the response was 1429 tokens long')).toBe(false);
    expect(isTransientStreamError('Retrying request: 429')).toBe(true);
  });

  it('is nothing at all when there is nothing to read', () => {
    expect(isTransientStreamError(null)).toBe(false);
    expect(isTransientStreamError(undefined)).toBe(false);
    expect(isTransientStreamError('')).toBe(false);
  });
});
