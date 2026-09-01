/** What the second model cost, under its own name.
 *
 * The advisor is asked inside a tool call, so nothing about it looks like an
 * assistant turn: the breakdown named one model where two had been paid for,
 * and the more expensive of the two was the invisible one.
 */

import { describe, expect, it } from 'vitest';

import { SpendWatch } from '../src/agent/pi/spend';

const advisorEnd = (model: string, cost: number | undefined) => ({
  type: 'tool_execution_end',
  toolCallId: 'call-1',
  toolName: 'ask_advisor',
  isError: false,
  result: {
    details: {
      advisor: model,
      ...(cost === undefined ? {} : { usage: { cost, input: 900, output: 120 } }),
    },
  },
});

const turnEnd = (model: string, total: number) => ({
  type: 'message_end',
  message: {
    role: 'assistant',
    model,
    usage: { input: 100, output: 50, cacheRead: 0, cacheWrite: 0, cost: { total } },
  },
});

describe('AS-01 the advisor appears in the breakdown', () => {
  it('is named, beside the model that did the work', () => {
    const spend = new SpendWatch();
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    spend.fromPi(advisorEnd('anthropic/claude-opus-4-1-20250805', 0.08));

    const names = spend.usage().byModel.map((one) => one.name);
    expect(names).toHaveLength(2);
    expect(names.some((one) => one.includes('opus'))).toBe(true);
    expect(names.some((one) => one.includes('sonnet'))).toBe(true);
  });

  it('puts the more expensive one first, which is the point of the list', () => {
    const spend = new SpendWatch();
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    spend.fromPi(advisorEnd('anthropic/claude-opus-4-1-20250805', 0.08));
    expect(spend.usage().mostUsed).toContain('opus');
  });

  it('adds a second consultation to the first rather than replacing it', () => {
    const spend = new SpendWatch();
    spend.fromPi(advisorEnd('anthropic/claude-opus-4-1-20250805', 0.05));
    spend.fromPi({ ...advisorEnd('anthropic/claude-opus-4-1-20250805', 0.05), toolCallId: 'call-2' });
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    const opus = spend.usage().byModel.find((one) => one.name.includes('opus'));
    // 0.10 of 0.12 — two consultations, not one.
    expect(opus?.share).toBeCloseTo(0.1 / 0.12, 3);
  });
});

describe('AS-02 what it does not claim', () => {
  it('claims nothing when the advisor reported no cost', () => {
    const spend = new SpendWatch();
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    spend.fromPi(advisorEnd('anthropic/claude-opus-4-1-20250805', undefined));
    expect(spend.usage().byModel).toHaveLength(1);
  });

  it('claims nothing for a free consultation rather than listing a zero', () => {
    const spend = new SpendWatch();
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    spend.fromPi(advisorEnd('anthropic/claude-opus-4-1-20250805', 0));
    expect(spend.usage().byModel).toHaveLength(1);
  });

  /* Reading a cost off any tool that happened to carry one would price the
     wrong thing under a name nobody chose. */
  it('reads it from the advisor and from nothing else', () => {
    const spend = new SpendWatch();
    spend.fromPi(turnEnd('anthropic/claude-sonnet-4-5-20250929', 0.02));
    spend.fromPi({ ...advisorEnd('somebody/else', 5), toolName: 'websearch' });
    expect(spend.usage().byModel).toHaveLength(1);
  });

  it('survives an answer with no details on it at all', () => {
    const spend = new SpendWatch();
    expect(() =>
      spend.fromPi({ type: 'tool_execution_end', toolCallId: 'x', toolName: 'ask_advisor', result: null }),
    ).not.toThrow();
    expect(spend.usage().byModel).toHaveLength(0);
  });
});
