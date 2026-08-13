/** The path money takes: Pi's own pricing → the adapter → the shell's ledger →
 *  the window.
 *
 *  Everything here is plain objects. Pi's events are literals, the ledger is
 *  ours, and the window's end of it is a fold — so the whole route can be run
 *  end to end with no model, no account, no Electron and no browser. What the
 *  tests below are actually protecting is three promises:
 *
 *   1. Nothing counted ever leaves src/agent/pi/. The window is handed money.
 *   2. The split between work and our own retries survives every hand-off. It
 *      is the one number no competitor can print (COST-DESIGN §3), so it is
 *      worth proving it is not quietly recomputed, rounded away, or relabelled.
 *   3. No spend means no meter. Somebody with no account connected sees no
 *      cost interface at all — not a zero, not an error.
 */

import { describe, expect, it } from 'vitest';

import { EventRelay } from '../src/agent/pi/events';
import { DEFAULT_SPEND_LABEL } from '../src/agent/pi/spend';
import {
  PI_CURRENCY,
  Purse,
  cacheHitShare,
  priceOfPiMessage,
  shortModelName,
  usageOfPiMessage,
} from '../src/agent/pi/usage';
import type { AgentEvent, SpendSummary, ToolCall } from '../src/agent/types';
import { formatMoney, toMajor } from '../src/cost/money';
import * as phrasing from '../src/cost/phrasing';
import { SpendRecorder } from '../src/cost/recorder';
import { bridge } from '../src/lib/bridge';
import { describeCall } from '../src/lib/describe';
import { applySpend, type SpendView } from '../src/lib/spend';

/* -------------------------------------------------------------------------- */
/* Pi's side of the wire, as literals                                          */
/* -------------------------------------------------------------------------- */

/** An assistant turn, priced the way Pi prices one: the provider works the cost
 *  out from the model's own catalog rates and hangs it on the message. */
function pricedTurn(total: number): unknown {
  return {
    type: 'message_end',
    message: {
      role: 'assistant',
      usage: { input: 4210, output: 260, cacheRead: 0, cacheWrite: 0, cost: { total } },
    },
  };
}

function toolEnded(id: string, failed: boolean): unknown {
  return { type: 'tool_execution_end', toolCallId: id, toolName: 'edit', isError: failed };
}

function call(id: string, name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id, name, input };
}

const SETTLED = { type: 'agent_settled' };

/** A relay wired the way `createSession` wires one, collecting what the shell
 *  would have been handed. */
function session(billedSoFar: () => number | null = () => null) {
  const events: AgentEvent[] = [];
  const relay = new EventRelay((event) => events.push(event), { billedSoFar });
  const spends = (): Extract<AgentEvent, { type: 'spend' }>[] =>
    events.filter((event): event is Extract<AgentEvent, { type: 'spend' }> => event.type === 'spend');
  return { events, relay, spends };
}

/* ========================================================================== */
/* What Pi charges, read as money                                              */
/* ========================================================================== */

describe('reading what Pi says a turn cost', () => {
  it('takes the price Pi worked out rather than working one out again', () => {
    expect(priceOfPiMessage(pricedTurn(0.0431))).toBe(0.0431);
  });

  it('reads cache fields the same way Pi totals them', () => {
    const usage = usageOfPiMessage({
      type: 'message_end',
      message: {
        role: 'assistant',
        provider: 'anthropic',
        model: 'claude-sonnet-4-20250514',
        usage: {
          input: 200,
          output: 40,
          cacheRead: 800,
          cacheWrite: 0,
          cost: { total: 0.01 },
        },
      },
    });
    expect(usage).toMatchObject({
      input: 200,
      cacheRead: 800,
      cacheWrite: 0,
      costTotal: 0.01,
      model: 'claude-sonnet-4-20250514',
    });
    expect(cacheHitShare(usage!)).toBeCloseTo(0.8);
    expect(shortModelName(usage!.model!)).toBe('claude-sonnet-4');
  });

  it('does not invent a cache hit when the provider never reports caching', () => {
    expect(cacheHitShare({ input: 1000, cacheRead: 0, cacheWrite: 0 })).toBeNull();
  });

  it('ignores everything that is not the assistant being billed', () => {
    expect(priceOfPiMessage({ type: 'message_end', message: { role: 'user' } })).toBeNull();
    // Tool results can carry usage of their own. It is not what the model was
    // billed for, and counting it would inflate every number the user sees.
    expect(
      priceOfPiMessage({
        type: 'message_end',
        message: { role: 'toolResult', usage: { cost: { total: 9 } } },
      }),
    ).toBeNull();
    expect(priceOfPiMessage({ type: 'message_end', message: { role: 'assistant' } })).toBeNull();
  });

  it('does not fall over on a payload that changed shape underneath us', () => {
    for (const event of [null, undefined, 42, 'message_end', [], {}, { message: null }]) {
      expect(priceOfPiMessage(event)).toBeNull();
    }
    for (const total of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '0.4']) {
      expect(priceOfPiMessage(pricedTurn(total as number))).toBeNull();
    }
  });
});

describe('prices become money, exactly', () => {
  it('is whole minor units and nothing else — no floats reach the ledger', () => {
    const purse = new Purse('USD');
    const paid = purse.take(0.4231, 'work');
    expect(paid).toEqual({ minor: 42, currency: 'USD' });
    expect(Number.isSafeInteger(paid?.minor)).toBe(true);
  });

  it('keeps what is smaller than a coin instead of rounding it away', () => {
    // A third of a cent a turn is ordinary. Rounded per turn it is zero every
    // time, and a hundred of them are a real amount the meter would never show.
    const purse = new Purse('USD');
    const naiveRounding = Math.round(0.004 * 100);
    expect(naiveRounding).toBe(0);

    let emitted = 0;
    for (let turn = 0; turn < 250; turn += 1) {
      emitted += purse.take(0.004, 'work')?.minor ?? 0;
    }

    // $1.00 went through. Nothing was lost: what has been paid out plus what is
    // still owed is what was charged, and the meter is never more than one
    // minor unit behind.
    expect(purse.chargedMajor).toBeCloseTo(1, 9);
    expect(emitted + purse.outstandingMinor()).toBeCloseTo(100, 6);
    expect(emitted).toBeGreaterThanOrEqual(99);
    expect(emitted).toBeLessThanOrEqual(100);
  });

  it('never pays a retry out of the work remainder, or the other way round', () => {
    const purse = new Purse('USD');
    // Each on its own is half a coin. Sharing one remainder would turn two
    // halves into a whole unit under whichever reason asked last — and the one
    // number this design exists to keep honest is which of the two it was.
    expect(purse.take(0.005, 'work')).toBeNull();
    expect(purse.take(0.005, 'retry-after-failure')).toBeNull();
    expect(purse.take(0.005, 'work')).toEqual({ minor: 1, currency: 'USD' });
    expect(purse.take(0.005, 'retry-after-failure')).toEqual({ minor: 1, currency: 'USD' });
  });

  it('prices in what Pi prices in, and says so out loud', () => {
    expect(PI_CURRENCY).toBe('USD');
    expect(new Purse().currency).toBe('USD');
  });
});

/* ========================================================================== */
/* Whose fault the money was                                                   */
/* ========================================================================== */

describe('work, and attempts that did not work', () => {
  it('charges a turn that follows a failed tool call to the failure', () => {
    const { relay, spends } = session();

    relay.fromPi(pricedTurn(0.03)); // the turn that asked for the edit
    relay.started(call('c1', 'edit', { path: '/p/contact.html' }));
    relay.fromPi(toolEnded('c1', true)); // it failed
    relay.fromPi(pricedTurn(0.02)); // the model dealing with its own mess

    expect(spends().map((event) => [event.reason, event.label, event.amount.minor])).toEqual([
      ['work', DEFAULT_SPEND_LABEL, 3],
      ['retry-after-failure', 'Changing contact.html', 2],
    ]);
  });

  it('stops blaming itself once the failure has been answered', () => {
    const { relay, spends } = session();

    relay.started(call('c1', 'edit', { path: '/p/contact.html' }));
    relay.fromPi(toolEnded('c1', true));
    relay.fromPi(pricedTurn(0.02)); // retry
    relay.started(call('c2', 'edit', { path: '/p/contact.html' }));
    relay.fromPi(toolEnded('c2', false)); // it worked this time
    relay.fromPi(pricedTurn(0.05)); // back to the job

    expect(spends().map((event) => event.reason)).toEqual(['retry-after-failure', 'work']);
  });

  it('counts what Pi itself calls a retry, even with no tool involved', () => {
    const { relay, spends } = session();

    relay.fromPi({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3, delayMs: 500 });
    relay.fromPi(pricedTurn(0.04));
    relay.fromPi({ type: 'auto_retry_end', success: true, attempt: 1 });
    relay.fromPi(pricedTurn(0.04));

    expect(spends().map((event) => event.reason)).toEqual(['retry-after-failure', 'work']);
  });

  it('does not bill the user for our own safety net', () => {
    const { relay, spends } = session();

    // Pi hands a blocked call back to the model as a failed one. The user said
    // no; charging that to "attempts that didn't work" would be a lie, and a
    // flattering one, since it would make the Guard look like our mistake.
    const stopped = call('c1', 'bash', { command: 'rm -rf /' });
    relay.blocked(stopped, 'I have left it alone.');
    relay.fromPi(toolEnded('c1', true));
    relay.fromPi(pricedTurn(0.03));

    expect(spends().map((event) => event.reason)).toEqual(['work']);
  });

  it('names the thing it keeps getting wrong, not the last thing it touched', () => {
    const { relay, spends } = session();

    relay.started(call('c1', 'edit', { path: '/p/contact.html' }));
    relay.fromPi(toolEnded('c1', true));
    relay.fromPi(pricedTurn(0.02));
    relay.started(call('c2', 'edit', { path: '/p/contact.html' }));
    relay.fromPi(toolEnded('c2', true)); // the same action, failing again
    relay.started(call('c3', 'read', { path: '/p/styles.css' }));
    relay.fromPi(toolEnded('c3', true)); // and something incidental
    relay.fromPi(pricedTurn(0.02));

    expect(spends().map((event) => event.label)).toEqual([
      'Changing contact.html',
      'Changing contact.html',
    ]);
  });

  it('claims what Pi billed but never reported as a turn', () => {
    // Tidying a long conversation up and summarising an abandoned branch are
    // billed and produce no assistant message. A meter that reads under the
    // real bill is the failure this whole feature exists to prevent.
    const { relay, spends } = session(() => 0.1);

    relay.fromPi(pricedTurn(0.04));
    relay.fromPi(SETTLED);

    expect(spends().map((event) => event.amount.minor)).toEqual([4, 6]);
    expect(spends().every((event) => event.reason === 'work')).toBe(true);
  });

  it('claims nothing when Pi’s own total agrees, or cannot be read', () => {
    for (const billed of [() => 0.04, () => null, () => Number.NaN]) {
      const { relay, spends } = session(billed);
      relay.fromPi(pricedTurn(0.04));
      relay.fromPi(SETTLED);
      expect(spends()).toHaveLength(1);
    }
  });

  it('says nothing at all when there is no money — no account, no meter', () => {
    const { events, relay } = session();

    relay.started(call('c1', 'read', { path: '/p/index.html' }));
    relay.fromPi(toolEnded('c1', false));
    relay.fromPi({ type: 'message_end', message: { role: 'assistant' } });
    relay.fromPi(SETTLED);

    expect(events.map((event) => event.type)).toEqual([
      'tool-start',
      'tool-end',
      'message-end',
      'settled',
    ]);
  });
});

/* ========================================================================== */
/* The whole path                                                              */
/* ========================================================================== */

/** One sitting: a turn, a failed edit, the model fixing it, then the job. */
function aSitting(): AgentEvent[] {
  const { events, relay } = session();

  relay.fromPi(pricedTurn(0.03));
  relay.started(call('c1', 'edit', { path: '/p/contact.html' }));
  relay.fromPi(toolEnded('c1', true));
  relay.fromPi(pricedTurn(0.02));
  relay.started(call('c2', 'edit', { path: '/p/contact.html' }));
  relay.fromPi(toolEnded('c2', false));
  relay.fromPi(pricedTurn(0.01));
  relay.fromPi(SETTLED);

  return events;
}

/** The shell's end: record everything, and forward what comes back. */
function throughTheShell(stream: readonly AgentEvent[]): {
  toTheWindow: AgentEvent[];
  recorder: SpendRecorder;
} {
  const recorder = new SpendRecorder();
  const toTheWindow: AgentEvent[] = [];
  for (const event of stream) {
    toTheWindow.push(event);
    for (const also of recorder.observe(event)) toTheWindow.push(also);
  }
  return { toTheWindow, recorder };
}

function inTheWindow(stream: readonly AgentEvent[]): SpendView | null {
  let view: SpendView | null = null;
  for (const event of stream) view = applySpend(view, event);
  return view;
}

describe('the split survives the whole path', () => {
  it('arrives in the window as the same money the adapter reported', () => {
    const { toTheWindow, recorder } = throughTheShell(aSitting());
    const view = inTheWindow(toTheWindow);

    expect(view).not.toBeNull();
    expect(view?.total).toEqual({ minor: 6, currency: 'USD' });
    expect(view?.split?.work).toEqual({ minor: 4, currency: 'USD' });
    expect(view?.split?.retry).toEqual({ minor: 2, currency: 'USD' });
    expect(view?.split?.largestRetry?.label).toBe('Changing contact.html');
    // Adds up, and adds up to what the shell's own ledger says.
    expect(recorder.ledger?.summary().total).toEqual(view?.total);
  });

  it('is the ledger’s own summary rather than a second reckoning', () => {
    const { toTheWindow, recorder } = throughTheShell(aSitting());
    const summary = toTheWindow.find((event) => event.type === 'spend-summary');

    expect(summary).toBeDefined();
    expect(summary?.type === 'spend-summary' && summary.summary).toEqual(
      recorder.ledger?.summary(),
    );
  });

  it('shows the meter from the first spend and never takes it away', () => {
    const stream = throughTheShell(aSitting()).toTheWindow;
    const seen: (SpendView | null)[] = [];
    let view: SpendView | null = null;
    for (const event of stream) {
      view = applySpend(view, event);
      seen.push(view);
    }

    const firstSpend = stream.findIndex((event) => event.type === 'spend');
    expect(seen.slice(0, firstSpend).every((step) => step === null)).toBe(true);
    expect(seen.slice(firstSpend).every((step) => step !== null)).toBe(true);
  });

  it('shows nothing at all when nothing was spent', () => {
    const stream: AgentEvent[] = [
      { type: 'message-delta', text: 'Working on it.' },
      { type: 'message-end' },
      { type: 'settled' },
    ];
    const { toTheWindow, recorder } = throughTheShell(stream);

    expect(recorder.ledger).toBeNull();
    expect(toTheWindow).toEqual(stream); // no summary, no zero state
    expect(inTheWindow(toTheWindow)).toBeNull();
  });

  it('keeps the book in the shell, so a window that missed events is still right', () => {
    const stream = throughTheShell(aSitting()).toTheWindow;
    // A window that only caught the tail of a sitting — a reload, a late
    // subscribe. The summary is authoritative and puts it straight.
    const late = stream.slice(stream.findIndex((event) => event.type === 'spend-summary'));

    expect(inTheWindow(late)?.total).toEqual({ minor: 6, currency: 'USD' });
  });

  it('lets a browser tab with no shell under it show a real meter', async () => {
    // What the screenshot harness captures. The numbers are invented; the path
    // they travel is the same one the desktop app uses.
    const seen: AgentEvent[] = [];
    const settled = new Promise<void>((resolve) => {
      // Each event now arrives with the folder it belongs to, so the window can
      // put a reply on the desk it started on — see `AgentNotice`.
      const stop = bridge.onEvent((notice) => {
        seen.push(notice.event);
        if (notice.event.type === 'spend-summary') {
          stop();
          resolve();
        }
      });
    });
    await settled;

    expect(bridge.desktop).toBe(false);
    const view = inTheWindow(seen);
    expect(view?.total.minor).toBeGreaterThan(0);
    expect(view?.split?.work.minor).toBeGreaterThan(0);
    expect(view?.split?.retry.minor).toBeGreaterThan(0);
    expect(formatMoney(view!.total)).toBe('$0.62');
  });
});

/* ========================================================================== */
/* Nothing counted crosses the wire                                            */
/* ========================================================================== */

describe('the window is told money and nothing else', () => {
  const stream = throughTheShell(aSitting()).toTheWindow;

  it('carries no count of anything on a spend event', () => {
    for (const event of stream) {
      if (event.type !== 'spend') continue;
      expect(Object.keys(event).sort()).toEqual(['amount', 'label', 'reason', 'type']);
      expect(Object.keys(event.amount).sort()).toEqual(['currency', 'minor']);
    }
  });

  it('carries none of Pi’s own accounting anywhere in the stream', () => {
    // Pi's events are full of it — usage blocks, cache counts, model ids. None
    // of it survives the translation, and this is the assertion that says so
    // about the serialised bytes rather than about the types.
    const wire = JSON.stringify(stream);
    for (const pattern of [/token/i, /usage/i, /cache/i, /context\s*window/i, /compact/i]) {
      expect(wire).not.toMatch(pattern);
    }
  });
});

/* ========================================================================== */
/* C-01, extended to everything this wiring can say                            */
/* ========================================================================== */

describe('C-01 — the language audit, over the new strings', () => {
  /** The same list the cost module is swept with, applied to the strings the
   *  wiring introduces: spend labels, and the sentences built from them. */
  const BANNED: { name: string; pattern: RegExp }[] = [
    { name: 'token', pattern: /token/i },
    { name: 'context window', pattern: /context\s*window/i },
    { name: 'compaction', pattern: /compact/i },
    { name: 'a raw model name', pattern: /\b(claude|sonnet|opus|haiku|gpt|gemini|llama|grok)\b/i },
    { name: 'a raw model name', pattern: /\b[a-z]+-(?:sonnet|opus|haiku)-?[0-9.]*\b/i },
    { name: 'a vendor name', pattern: /\b(anthropic|openai)\b/i },
    { name: 'a tool name', pattern: /\b(bash|grep|glob|stdout|str_replace|multiedit)\b/i },
  ];

  /** Every label a spend entry can carry, and every sentence made from one. */
  function everyString(): string[] {
    const found: string[] = [DEFAULT_SPEND_LABEL];

    // Labels come from the same translation the activity feed uses, so the
    // sweep has to cover every tool the agent can reach for.
    for (const name of [
      'read',
      'write',
      'edit',
      'delete',
      'ls',
      'grep',
      'glob',
      'bash',
      'fetch',
      'something_new',
    ]) {
      const described = describeCall(call('c1', name, { path: '/p/contact.html', command: 'ls' }));
      found.push(described.label);
      if (described.detail !== undefined) found.push(described.detail);
    }

    for (const event of throughTheShell(aSitting()).toTheWindow) {
      if (event.type === 'spend') found.push(event.label);
      if (event.type === 'spend-summary') {
        const summary: SpendSummary = event.summary;
        found.push(...phrasing.sessionSummary(summary).lines);
        found.push(phrasing.meter.today(summary.total));
        found.push(phrasing.meter.screenReaderLabel(summary.total));
        if (summary.largestRetry) found.push(summary.largestRetry.label);
      }
    }

    return found;
  }

  it('sweeps the strings this wiring actually produces', () => {
    expect(everyString().length).toBeGreaterThan(20);
    expect(everyString()).toContain('Changing contact.html');
  });

  it('would notice a violation if one were written', () => {
    const violations = ['Running a bash command', 'Retrying with claude-sonnet-5', '1,200 tokens'];
    for (const text of violations) {
      expect(BANNED.some(({ pattern }) => pattern.test(text))).toBe(true);
    }
  });

  it('uses none of the retired words', () => {
    const offences: string[] = [];
    for (const text of everyString()) {
      for (const { name, pattern } of BANNED) {
        if (pattern.test(text)) offences.push(`${name} → "${text}"`);
      }
    }
    expect(offences).toEqual([]);
  });

  it('reads as a sentence when the split is spoken aloud', () => {
    const summary = throughTheShell(aSitting()).recorder.ledger?.summary();
    const lines = phrasing.sessionSummary(summary as SpendSummary);

    expect(lines.headline).toBe('Today: $0.06');
    expect(lines.work).toBe('$0.04 building what you asked for');
    expect(lines.retry).toBe(
      '$0.02 on attempts that didn’t work — mostly me retrying changing contact.html',
    );
    // Money, in money. Not a fraction of a cent anywhere near a screen.
    expect(toMajor(summary!.total)).toBeCloseTo(0.06, 10);
  });
});
