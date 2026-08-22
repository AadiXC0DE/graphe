/** What is worth waiting out, and what is an answer.
 *
 * Two retry ladders shipped without a single test, and neither had ever run:
 * the engine reports a provider failure by settling the turn with it, not by
 * throwing, so both `catch` blocks were unreachable. These cover the list that
 * decides, and the exclusions that keep a run from waiting three quarters of an
 * hour on a thing that will never change.
 */

import { describe, expect, it } from 'vitest';

import { CARRY_ON, isTransientStreamError, WAITS_MS } from '../src/agent/pi/transient';

describe('failures worth waiting out', () => {
  const waits = [
    'overloaded_error: Overloaded',
    '503 Service Unavailable',
    'Error 502 Bad Gateway',
    'HTTP 429 Too Many Requests',
    'rate limit reached for requests',
    'socket hang up',
    'ECONNRESET',
    'read ECONNRESET on the other side closed',
    'getaddrinfo EAI_AGAIN api.example.com',
    'fetch failed',
    'Anthropic stream ended before message_stop',
    'OpenAI Responses stream ended before a terminal response event',
    'terminated',
    'upstream connect error or disconnect/reset before headers',
    'Internal server error',
    'Provider returned error',
    'request timed out',
    'you can retry your request',
  ];
  for (const said of waits) {
    it(`waits out: ${said.slice(0, 44)}`, () => {
      expect(isTransientStreamError(new Error(said))).toBe(true);
    });
  }
});

describe('answers, however unwelcome', () => {
  const settled = [
    'insufficient_quota: You exceeded your current quota',
    'Your available balance is too low',
    'billing hard limit reached',
    'usage limit reached for this month',
    'invalid_api_key: Incorrect API key provided',
    'authentication failed',
  ];
  for (const said of settled) {
    it(`does not wait on: ${said.slice(0, 44)}`, () => {
      expect(isTransientStreamError(new Error(said))).toBe(false);
    });
  }

  it('leaves a conversation that outgrew its window alone', () => {
    // The engine shortens and carries on by itself. Waiting would only make
    // the conversation longer.
    expect(isTransientStreamError(new Error('context length exceeded'))).toBe(false);
    expect(isTransientStreamError(new Error('maximum context length is 200000 tokens'))).toBe(
      false,
    );
  });

  it('does not read a number in the middle of a sentence as a failure', () => {
    expect(isTransientStreamError(new Error('the prompt was 1429 tokens'))).toBe(false);
    expect(isTransientStreamError(new Error('wrote 5031 bytes'))).toBe(false);
  });

  it('says no to nothing at all', () => {
    expect(isTransientStreamError(null)).toBe(false);
    expect(isTransientStreamError(undefined)).toBe(false);
    expect(isTransientStreamError('')).toBe(false);
  });

  it('reads a plain sentence as well as an error', () => {
    expect(isTransientStreamError('503 Service Unavailable')).toBe(true);
  });
});

describe('the ladder', () => {
  it('is long enough to walk away from', () => {
    const total = WAITS_MS.reduce((sum, one) => sum + one, 0);
    expect(total).toBeGreaterThan(40 * 60_000);
  });

  it('gets longer each time, so a real outage is not hammered', () => {
    for (let at = 1; at < WAITS_MS.length; at += 1) {
      expect(WAITS_MS[at]!).toBeGreaterThan(WAITS_MS[at - 1]!);
    }
  });

  it('picks the work up rather than asking for it again', () => {
    // Asking for the original request twice is how a list gets done twice.
    expect(CARRY_ON.toLowerCase()).toContain('do not start again');
    expect(CARRY_ON.toLowerCase()).toContain('already finished');
  });
});
