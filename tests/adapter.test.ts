/** The Pi adapter: the Guard's wiring, the event translation, and the rule that
 *  keeps Pi inside one folder.
 *
 *  Nothing here talks to a model. The two things worth testing about an adapter
 *  are the decision table in front of tool execution and the shape of what comes
 *  out the other side, and both are reachable with plain objects: tool calls are
 *  fabricated, Pi's events are object literals, the Timeline is a stub that
 *  records the order it was called in. No credentials, no network, no session
 *  file on anybody's disk.
 *
 *  What is *not* covered, and cannot be without a signed-in account: that Pi
 *  actually calls our `tool_call` handler at run time, and that `session.prompt`
 *  produces the events we translate. Those are one `createAgentSession` call
 *  away and both need a model. The interception point is asserted from Pi's own
 *  source instead — see "the interception point" below. */

import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  Confirmations,
  createGuardInterceptor,
  createSession,
  takingBack,
  type Decision,
  type Interception,
  type SnapshotSource,
} from '../src/agent/pi/adapter';
import { EventRelay, translatePiEvent } from '../src/agent/pi/events';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { AgentEvent, ToolCall } from '../src/agent/types';

const ROOT = '/Users/mira/Projects/portfolio';
const facts: GuardFacts = { projectRoot: ROOT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 'call-1', name, input };
}
function bash(command: string): ToolCall {
  return call('bash', { command });
}

/** A session's worth of wiring, with everything the Guard leans on replaced by
 *  something that writes down what happened to it. */
function harness(options: {
  failSnapshot?: boolean;
  withTimeline?: boolean;
  guardFacts?: GuardFacts;
} = {}) {
  const order: string[] = [];
  const events: AgentEvent[] = [];
  const relay = new EventRelay((event) => {
    events.push(event);
    order.push(event.type);
  });
  const confirmations = new Confirmations();

  const timeline: SnapshotSource = {
    snapshot: async () => {
      order.push('snapshot');
      if (options.failSnapshot === true) throw new Error('the folder is locked');
      return null;
    },
  };

  const review = createGuardInterceptor({
    facts: options.guardFacts ?? facts,
    relay,
    confirmations,
    timeline: options.withTimeline === false ? undefined : timeline,
  });

  /** Stands in for Pi's agent loop: it only reaches the tool when the
   *  interceptor let it through, which is the whole property under test. */
  const runThroughPi = async (toolCall: ToolCall): Promise<Interception> => {
    const outcome = await review(toolCall);
    if (outcome === undefined) order.push('executed');
    return outcome;
  };

  return { order, events, confirmations, review, runThroughPi };
}

/* ========================================================================== */
/* The Guard runs before anything else does                                    */
/* ========================================================================== */

describe('a call the Guard allows', () => {
  it('runs, silently, with no restore point and no question', async () => {
    const { order, events, runThroughPi } = harness();
    const outcome = await runThroughPi(call('read', { path: 'src/App.tsx' }));

    expect(outcome).toBeUndefined();
    expect(order).toEqual(['tool-start', 'executed']);
    expect(events.some((event) => event.type === 'needs-confirmation')).toBe(false);
  });
});

describe('a call the Guard denies', () => {
  it('never reaches execution', async () => {
    const { order, runThroughPi } = harness();
    const outcome = await runThroughPi(bash('rm -rf /'));

    expect(outcome?.block).toBe(true);
    expect(order).not.toContain('executed');
    expect(order).not.toContain('snapshot');
  });

  it('tells the model why, in words it can act on', async () => {
    const { events, runThroughPi } = harness();
    const outcome = await runThroughPi(bash('cat ~/.ssh/id_rsa'));

    // A sentence, not a code. The model has to be able to read it and change
    // its approach, and the same words go straight into the activity feed.
    expect(outcome?.reason).toMatch(/^[A-Z].*\.$/s);
    expect(outcome?.reason).not.toMatch(/id_rsa|\.ssh/);
    const blocked = events.find((event) => event.type === 'blocked');
    expect(blocked).toBeDefined();
    if (blocked?.type !== 'blocked') return;
    // The same sentence the user reads. One story, not two.
    expect(blocked.reason).toBe(outcome?.reason);
    expect(blocked.call.name).toBe('bash');
  });

  it('emits blocked and nothing that looks like work starting', async () => {
    const { order, runThroughPi } = harness();
    await runThroughPi(call('write', { path: '../../../etc/hosts', content: 'x' }));
    expect(order).toEqual(['blocked']);
  });
});

describe('the explicit full-access mode', () => {
  it('does not reintroduce a project boundary or restore-point check in the adapter', async () => {
    const { order, events, runThroughPi } = harness({
      failSnapshot: true,
      guardFacts: { ...facts, howFar: 'doing' },
    });
    const outcome = await runThroughPi(
      bash('nohup npm run dev -- --host 127.0.0.1 --port 5173 >/tmp/site.log 2>&1 &'),
    );

    expect(outcome).toBeUndefined();
    expect(order).toEqual(['tool-start', 'executed']);
    expect(events.some((event) => event.type === 'blocked')).toBe(false);
    expect(events.some((event) => event.type === 'needs-confirmation')).toBe(false);
  });
});

describe('a call that needs a restore point first', () => {
  it('snapshots before it runs, not after', async () => {
    const { order, runThroughPi } = harness();
    const outcome = await runThroughPi(bash('rm src/old-header.tsx'));

    expect(outcome).toBeUndefined();
    expect(order).toEqual(['snapshot', 'tool-start', 'executed']);
    expect(order.indexOf('snapshot')).toBeLessThan(order.indexOf('executed'));
  });

  it('does not run at all when the restore point could not be saved', async () => {
    const { order, events, runThroughPi } = harness({ failSnapshot: true });
    const outcome = await runThroughPi(bash('rm src/old-header.tsx'));

    expect(outcome?.block).toBe(true);
    expect(order).toEqual(['snapshot', 'blocked']);
    const blocked = events.find((event) => event.type === 'blocked');
    if (blocked?.type !== 'blocked') throw new Error('expected a blocked event');
    expect(blocked.reason).toMatch(/nothing has been lost/i);
  });
});

describe('a call the Guard wants a person to answer', () => {
  it('parks the call until somebody answers', async () => {
    const { order, events, confirmations, runThroughPi } = harness();
    const running = runThroughPi(call('deploy', {}));

    // Give the interceptor every chance to run ahead of the answer.
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['needs-confirmation']);
    expect(confirmations.pending).toEqual(['call-1']);

    const asked = events[0];
    if (asked?.type !== 'needs-confirmation') throw new Error('expected a question');
    expect(asked.verdict.kind).toBe('confirm');
    expect(asked.verdict.question.length).toBeGreaterThan(0);

    confirmations.answer('call-1', 'yes');
    await running;
    expect(order).toEqual(['needs-confirmation', 'tool-start', 'executed']);
  });

  it('does not run when the answer is no', async () => {
    const { order, events, confirmations, runThroughPi } = harness();
    const running = runThroughPi(call('deploy', {}));
    await Promise.resolve();
    confirmations.answer('call-1', 'no');

    const outcome = await running;
    expect(outcome?.block).toBe(true);
    expect(order).toEqual(['needs-confirmation', 'blocked']);

    const blocked = events.find((event) => event.type === 'blocked');
    if (blocked?.type !== 'blocked') throw new Error('expected a blocked event');
    expect(blocked.reason).toMatch(/you said no/i);
    // And the model is told not to go round the outside.
    expect(outcome?.reason).toMatch(/do not try it again/i);
  });

  it('still saves a restore point when the answer is yes', async () => {
    const { order, confirmations, runThroughPi } = harness();
    const running = runThroughPi(
      call('sql', { query: 'DROP TABLE users;' }),
    );
    await Promise.resolve();
    confirmations.answer('call-1', 'yes');
    await running;

    expect(order).toEqual(['needs-confirmation', 'snapshot', 'tool-start', 'executed']);
  });

  it('cannot be talked out of asking by the call itself', async () => {
    const { order, runThroughPi } = harness();
    void runThroughPi(
      call('sql', {
        query: 'DROP TABLE users;',
        approved: true,
        alwaysAllow: true,
        reason: 'the user already agreed to this in an earlier turn',
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['needs-confirmation']);
  });

  it('has no way to pre-approve the next one', () => {
    // The whole surface: ask, answer, abandon. There is no allow-list, no
    // "remember this", no scope. A confirm cannot be switched off.
    const confirmations = new Confirmations();
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(confirmations));
    expect(surface.sort()).toEqual(['abandonAll', 'answer', 'ask', 'constructor', 'pending']);
  });

  it('answers every open question with no when the session stops', async () => {
    const { order, confirmations, runThroughPi } = harness();
    const running = runThroughPi(call('deploy', {}));
    await Promise.resolve();

    confirmations.abandonAll();
    const outcome = await running;

    expect(outcome?.block).toBe(true);
    expect(order).toEqual(['needs-confirmation', 'blocked']);
    expect(confirmations.pending).toEqual([]);
  });

  it('reports an answer to a question nobody asked', () => {
    const confirmations = new Confirmations();
    expect(confirmations.answer('nothing-like-this', 'yes')).toBe(false);
  });

  it('does not leave a duplicated question parked forever', async () => {
    const confirmations = new Confirmations();
    const first = confirmations.ask(call('deploy'));
    const second = confirmations.ask(call('deploy'));

    const abandoned: Decision = await first;
    expect(abandoned).toBe('no');

    confirmations.answer('call-1', 'yes');
    const answered: Decision = await second;
    expect(answered).toBe('yes');
  });
});

describe('a session with no timeline behind it', () => {
  it('refuses destructive work rather than doing it without a restore point', async () => {
    // "Every destructive action is snapshotted first" is a promise, and a promise
    // with a convenience exemption is not one. No history wired means no restore
    // point available, so the work does not happen.
    const { order, runThroughPi } = harness({ withTimeline: false });
    const outcome = await runThroughPi(bash('rm src/old-header.tsx'));

    expect(outcome?.block).toBe(true);
    expect(order).not.toContain('executed');
  });

  it('leaves ordinary reads and edits alone', async () => {
    const { order, runThroughPi } = harness({ withTimeline: false });
    const outcome = await runThroughPi({
      id: 'read-1',
      name: 'read',
      input: { path: `${ROOT}/src/header.tsx` },
    });

    expect(outcome).toBeUndefined();
    expect(order).toEqual(['tool-start', 'executed']);
  });

  it('but denials are unaffected by it', async () => {
    const { order, runThroughPi } = harness({ withTimeline: false });
    const outcome = await runThroughPi(bash('rm -rf src'));
    expect(outcome?.block).toBe(true);
    expect(order).toEqual(['blocked']);
  });
});

describe('the standing "ask me first" instruction', () => {
  it('reaches the interceptor along with everything else', async () => {
    const order: string[] = [];
    const relay = new EventRelay((event) => order.push(event.type));
    const confirmations = new Confirmations();
    const review = createGuardInterceptor({
      facts: { projectRoot: ROOT, askBeforeEveryChange: true },
      relay,
      confirmations,
    });

    void review(call('write', { path: 'src/App.tsx', content: 'hello' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(order).toEqual(['needs-confirmation']);
  });

  it('leaves reads silent', async () => {
    const order: string[] = [];
    const relay = new EventRelay((event) => order.push(event.type));
    const review = createGuardInterceptor({
      facts: { projectRoot: ROOT, askBeforeEveryChange: true },
      relay,
      confirmations: new Confirmations(),
    });

    await review(call('read', { path: 'src/App.tsx' }));
    expect(order).toEqual(['tool-start']);
  });
});

/* ========================================================================== */
/* Pi's events, in our words                                                   */
/* ========================================================================== */

describe('translating one event', () => {
  it('turns streamed text into a message delta', () => {
    expect(
      translatePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'text_delta', contentIndex: 0, delta: 'Making the ' },
      }),
    ).toEqual({ type: 'message-delta', text: 'Making the ' });
  });

  it('ignores thinking and tool-argument deltas', () => {
    expect(
      translatePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'thinking_delta', delta: 'hmm' },
      }),
    ).toBeNull();
    expect(
      translatePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'toolcall_delta', delta: '{"path":' },
      }),
    ).toBeNull();
  });

  it('reads a streaming failure out of whichever field carries it', () => {
    expect(
      translatePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'error', reason: 'error', error: { errorMessage: 'rate limited' } },
      }),
    ).toEqual({ type: 'error', message: 'rate limited' });

    expect(
      translatePiEvent({
        type: 'message_update',
        assistantMessageEvent: { type: 'error', errorMessage: 'the connection dropped' },
      }),
    ).toEqual({ type: 'error', message: 'the connection dropped' });
  });

  it('never leaves an error without something a person can read', () => {
    const translated = translatePiEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'error' },
    });
    if (translated?.type !== 'error') throw new Error('expected an error');
    expect(translated.message.length).toBeGreaterThan(0);
  });

  it('ends a message only when it was the agent talking', () => {
    expect(translatePiEvent({ type: 'message_end', message: { role: 'assistant' } })).toEqual({
      type: 'message-end',
    });
    expect(translatePiEvent({ type: 'message_end', message: { role: 'toolResult' } })).toBeNull();
    expect(translatePiEvent({ type: 'message_end', message: { role: 'user' } })).toBeNull();
  });

  it('reports a failed turn as an error rather than a finished message', () => {
    expect(
      translatePiEvent({
        type: 'message_end',
        message: { role: 'assistant', errorMessage: 'the request was refused' },
      }),
    ).toEqual({ type: 'error', message: 'the request was refused' });
  });

  it('closes a tool call off, with whether it worked', () => {
    expect(
      translatePiEvent({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', isError: false }),
    ).toEqual({ type: 'tool-end', id: 'c1', ok: true });
    expect(
      translatePiEvent({ type: 'tool_execution_end', toolCallId: 'c1', toolName: 'read', isError: true }),
    ).toEqual({ type: 'tool-end', id: 'c1', ok: false });
  });

  it('keeps a failed tool call’s explanation beside its status', () => {
    expect(
      translatePiEvent({
        type: 'tool_execution_end',
        toolCallId: 'c1',
        toolName: 'bash',
        isError: true,
        result: { content: [{ type: 'text', text: 'git push: authentication failed' }] },
      }),
    ).toEqual({
      type: 'tool-end',
      id: 'c1',
      ok: false,
      detail: 'git push: authentication failed',
    });
  });

  /* E5. A helper's words travel as the tool's partial result, which Pi sends in
     the same shape a tool result takes — an object with a `content` list, not a
     string. Reading only the string form is what made every helper come back
     "Nothing said yet" while having answered in full. */
  it('reads a helper\'s progress out of the object-form partial result', () => {
    expect(
      translatePiEvent({
        type: 'tool_execution_update',
        toolCallId: 'c2',
        toolName: 'task',
        args: {},
        partialResult: {
          content: [{ type: 'text', text: 'Reading the layout files…' }],
          details: {},
        },
      }),
    ).toEqual({ type: 'tool-progress', id: 'c2', text: 'Reading the layout files…' });
  });

  it('reads a helper\'s progress out of a plain-string partial result too', () => {
    expect(
      translatePiEvent({
        type: 'tool_execution_update',
        toolCallId: 'c2',
        toolName: 'task',
        args: {},
        partialResult: 'Two of them do: the blog and the changelog.',
      }),
    ).toEqual({ type: 'tool-progress', id: 'c2', text: 'Two of them do: the blog and the changelog.' });
  });

  /* Whole, not a line of it: the helper board shows everything a helper has
     said, and only the feed row is short. Trimming here threw away the findings
     before anything had a chance to show them. */
  it('keeps everything the step has said so far', () => {
    expect(
      translatePiEvent({
        type: 'tool_execution_update',
        toolCallId: 'c3',
        toolName: 'task',
        args: {},
        partialResult: {
          content: [{ type: 'text', text: '  Two pages use it.\n\nThe blog and the changelog.\n' }],
          details: {},
        },
      }),
    ).toEqual({
      type: 'tool-progress',
      id: 'c3',
      text: 'Two pages use it.\n\nThe blog and the changelog.',
    });
  });

  /* F8. Tidying a long conversation is Pi's own compaction and never ours
     (REUSE-PI.md), so the only thing on our side is the narration — and it has
     to cover the case where Pi decided by itself, or the app goes quiet for
     twenty seconds with no explanation. */
  it('narrates a long conversation being tidied, whoever asked for it', () => {
    for (const reason of ['manual', 'threshold', 'overflow']) {
      expect(translatePiEvent({ type: 'compaction_start', reason })).toEqual({ type: 'tidying' });
    }
  });

  it('closes the tidying off, and does not dress a failed one up as done', () => {
    expect(
      translatePiEvent({ type: 'compaction_end', reason: 'manual', aborted: false }),
    ).toEqual({ type: 'tidied', ok: true });
    expect(
      translatePiEvent({ type: 'compaction_end', reason: 'threshold', aborted: true }),
    ).toEqual({ type: 'tidied', ok: false });
    expect(
      translatePiEvent({
        type: 'compaction_end',
        reason: 'overflow',
        aborted: false,
        errorMessage: 'the summary call failed',
      }),
    ).toEqual({ type: 'tidied', ok: false });
  });

  it('says nothing about the events that are not ours', () => {
    for (const event of [
      { type: 'agent_start' },
      { type: 'agent_end', messages: [] },
      { type: 'turn_start' },
      // Pi announces a tool call before the Guard has decided about it. Ours
      // comes from the Guard instead, so this one is dropped on purpose.
      { type: 'tool_execution_start', toolCallId: 'c1', toolName: 'bash', args: {} },
    ]) {
      expect(translatePiEvent(event)).toBeNull();
    }
  });

  /* What is waiting behind the run. It used to be dropped, which is why the
     window could not draw the line or offer to take it back — a queued message
     was handed to the agent and then existed nowhere anybody could see. */
  it('carries what is waiting behind the run', () => {
    expect(
      translatePiEvent({
        type: 'queue_update',
        steering: ['do the footer first'],
        followUp: ['then the header'],
      }),
    ).toEqual({ type: 'queued', steering: ['do the footer first'], followUp: ['then the header'] });
  });

  it('says an empty line is an empty line, rather than nothing at all', () => {
    // The difference matters: nothing means "the queue did not speak", and the
    // window would keep drawing a line that is no longer there.
    expect(translatePiEvent({ type: 'queue_update', steering: [], followUp: [] })).toEqual({
      type: 'queued',
      steering: [],
      followUp: [],
    });
  });

  it('keeps only the words, whatever else arrives in the list', () => {
    expect(
      translatePiEvent({ type: 'queue_update', steering: ['keep', 7, null], followUp: 'not a list' }),
    ).toEqual({ type: 'queued', steering: ['keep'], followUp: [] });
  });

  /* The agent has begun on one of the queued messages. Pi's own bookkeeping
     removal is exact-text and can silently no-op, so the waiting line is drawn
     from this instead: the message that starts is the message that is no
     longer waiting. */
  it('says when the agent begins on a message, by its words', () => {
    expect(
      translatePiEvent({
        type: 'message_start',
        message: { role: 'user', content: [{ type: 'text', text: 'then the header' }] },
      }),
    ).toEqual({ type: 'message-started', text: 'then the header' });
    // A string-typed content, as an earlier version of Pi carried it.
    expect(
      translatePiEvent({ type: 'message_start', message: { role: 'user', content: 'do it' } }),
    ).toEqual({ type: 'message-started', text: 'do it' });
  });

  it('does not call the line for anything that is not the person speaking', () => {
    for (const message of [
      // The agent's reply, and tool results: neither is a queued message.
      { role: 'assistant', content: [{ type: 'text', text: 'on it' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'ok' }] },
      // A message with nothing to say: the waiting line has no use for it.
      { role: 'user', content: [{ type: 'image', data: 'aaa' }] },
      { role: 'user', content: [] },
    ]) {
      expect(translatePiEvent({ type: 'message_start', message })).toBeNull();
    }
    expect(translatePiEvent({ type: 'message_start' })).toBeNull();
  });

  it('does not fall over on a payload that changed shape underneath us', () => {
    for (const event of [null, undefined, 42, 'message_end', [], {}, { type: 7 }]) {
      expect(translatePiEvent(event)).toBeNull();
    }
    expect(translatePiEvent({ type: 'tool_execution_end', isError: false })).toBeNull();
    expect(translatePiEvent({ type: 'message_update' })).toBeNull();
  });
});

describe('the stream the app sees', () => {
  function relayInto(events: AgentEvent[]): EventRelay {
    return new EventRelay((event) => events.push(event));
  }

  it('closes off a call it announced', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    relay.started(call('read', { path: 'src/App.tsx' }));
    relay.fromPi({ type: 'tool_execution_end', toolCallId: 'call-1', isError: false });

    expect(events.map((event) => event.type)).toEqual(['tool-start', 'tool-end']);
  });

  it('does not report a blocked call as a failed one as well', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    relay.blocked(call('bash', { command: 'rm -rf /' }), 'stopped');
    // Pi reports the block back to the model as a tool error, and emits this.
    relay.fromPi({ type: 'tool_execution_end', toolCallId: 'call-1', isError: true });

    expect(events.map((event) => event.type)).toEqual(['blocked']);
  });

  it('drops a result for something it never announced', () => {
    const events: AgentEvent[] = [];
    relayInto(events).fromPi({ type: 'tool_execution_end', toolCallId: 'never-seen', isError: false });
    expect(events).toEqual([]);
  });

  it('closes a call off exactly once', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    relay.started(call('read'));
    relay.fromPi({ type: 'tool_execution_end', toolCallId: 'call-1', isError: false });
    relay.fromPi({ type: 'tool_execution_end', toolCallId: 'call-1', isError: false });

    expect(events.filter((event) => event.type === 'tool-end')).toHaveLength(1);
  });

  it('passes text through in order', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    for (const delta of ['I have ', 'made the ', 'header sticky.']) {
      relay.fromPi({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta } });
    }
    relay.fromPi({ type: 'message_end', message: { role: 'assistant' } });

    expect(events).toEqual([
      { type: 'message-delta', text: 'I have ' },
      { type: 'message-delta', text: 'made the ' },
      { type: 'message-delta', text: 'header sticky.' },
      { type: 'message-end' },
    ]);
  });

  it('does not claim the agent stopped when Pi recovers from an API error', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    relay.fromPi({ type: 'message_end', message: { role: 'assistant', errorMessage: 'terminated' } });
    expect(events).toEqual([]);

    relay.fromPi({ type: 'auto_retry_start', attempt: 1, maxAttempts: 3 });
    relay.fromPi({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Recovered.' } });
    relay.fromPi({ type: 'message_end', message: { role: 'assistant' } });
    relay.fromPi({ type: 'agent_settled' });

    expect(events.some((event) => event.type === 'error')).toBe(false);
    expect(events.map((event) => event.type)).toEqual(['message-delta', 'message-end', 'settled']);
  });

  it('reports an API error only when the agent really settles without recovering', () => {
    const events: AgentEvent[] = [];
    const relay = relayInto(events);
    relay.fromPi({ type: 'message_end', message: { role: 'assistant', errorMessage: 'terminated' } });
    relay.fromPi({ type: 'agent_settled' });

    expect(events).toEqual([
      { type: 'error', message: 'terminated' },
      { type: 'settled' },
    ]);
  });
});

/* ========================================================================== */
/* Pi stays in one folder                                                      */
/* ========================================================================== */

const SOURCE_ROOT = fileURLToPath(new URL('../src/', import.meta.url));
const ADAPTER_FOLDER = 'agent/pi';
const PI_PACKAGE = '@earendil-works/';

function sourceFiles(folder: string, prefix = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(join(SOURCE_ROOT, folder), { withFileTypes: true })) {
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      found.push(...sourceFiles(join(folder, entry.name), relative));
      continue;
    }
    if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) found.push(relative);
  }
  return found;
}

function read(relative: string): string {
  return readFileSync(join(SOURCE_ROOT, relative), 'utf8');
}

describe('the adapter boundary', () => {
  it('is the only place in the app that names Pi', () => {
    const offenders = sourceFiles('.')
      .filter((file) => !file.startsWith(ADAPTER_FOLDER))
      .filter((file) => read(file).includes(PI_PACKAGE));

    expect(offenders).toEqual([]);
  });

  it('lets no Pi value cross into our runtime', () => {
    // Every mention of Pi in the adapter is either a type position, which is
    // erased, or the one dynamic import inside createSession. A plain
    // `import { x } from '@earendil-works/...'` at the top of this file would
    // put Pi in the Electron main process at startup and, worse, make it
    // possible to hand a Pi object straight out through the public API.
    for (const file of sourceFiles(ADAPTER_FOLDER, ADAPTER_FOLDER)) {
      for (const line of read(file).split('\n')) {
        if (!line.includes(PI_PACKAGE)) continue;
        const allowed =
          line.trimStart().startsWith('*') ||
          line.trimStart().startsWith('//') ||
          line.includes('import type') ||
          line.includes('typeof import(') ||
          line.includes('= import(') ||
          line.includes('await import(');
        expect({ file, line: line.trim(), allowed }).toMatchObject({ allowed: true });
      }
    }
  });

  it('keeps the event translation free of Pi entirely', () => {
    expect(read(`${ADAPTER_FOLDER}/events.ts`)).not.toContain(PI_PACKAGE);
  });

  it('exposes a session made only of our own vocabulary', () => {
    // A signature check, not a call: constructing a session needs a model.
    expect(typeof createSession).toBe('function');
    expect(createSession.length).toBe(1);

    const events: AgentEvent[] = [];
    const relay = new EventRelay((event) => events.push(event));
    relay.started(call('read', { path: 'src/App.tsx' }));
    relay.fromPi({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'read',
      isError: false,
      // Pi carries its own details on this event. None of it may come through.
      result: { content: [{ type: 'text', text: 'export default App' }], details: { lines: 12 } },
    });

    expect(events).toEqual([
      { type: 'tool-start', call: { id: 'call-1', name: 'read', input: { path: 'src/App.tsx' } } },
      { type: 'tool-end', id: 'call-1', ok: true },
    ]);
  });
});

describe('the interception point', () => {
  /** Read out of the installed SDK rather than asserted from memory. If an
   *  upgrade moves the hook, this fails here rather than silently at run time
   *  in front of a user, with the Guard wired to nothing. */
  const sdk = fileURLToPath(
    new URL('../node_modules/@earendil-works/pi-coding-agent/', import.meta.url),
  );

  it('is a hook that runs before the tool does', () => {
    const session = readFileSync(join(sdk, 'dist/core/agent-session.js'), 'utf8');
    expect(session).toContain('this.agent.beforeToolCall');
    expect(session).toContain('emitToolCall');

    const loop = readFileSync(
      join(sdk, 'node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js'),
      'utf8',
    );
    // The block short-circuits into an immediate error result: `tool.execute`
    // is never reached, and `reason` is what the model is handed instead.
    expect(loop).toContain('if (beforeResult?.block)');
    expect(loop).toContain('createErrorToolResult(beforeResult.reason');
  });

  it('is reached by the options createSession actually passes', async () => {
    // The one test that loads the real SDK. It stops short of a model — there
    // is no account here and none is needed — but it does open a session with
    // exactly the options `createSession` uses, so an upgrade that renames
    // `noExtensions`, `extensionFactories` or `SessionManager.inMemory` fails
    // here instead of at run time with the Guard wired to nothing.
    const projectRoot = mkdtempSync(join(tmpdir(), 'graphe-project-'));
    const agentDir = mkdtempSync(join(tmpdir(), 'graphe-agent-'));
    try {
      const session = await createSession({
        projectRoot,
        agentDir,
        onEvent: () => {},
      });
      expect(session.awaitingAnswer).toEqual([]);
      expect(session.answer('nothing-like-this', 'yes')).toBe(false);
      session.dispose();
      session.dispose();

      // In memory unless a path was given: nothing landed in the project.
      expect(readdirSync(projectRoot)).toEqual([]);
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
    }
  }, 30_000);

  /* Reopening a project carries the last conversation on; pressing "new" must
     not. Both go through the same call, so the two have to be told apart here
     rather than in a window nobody can test. */
  it('carries the last conversation on, unless a new one was asked for', async () => {
    const projectRoot = mkdtempSync(join(tmpdir(), 'graphe-project-'));
    const agentDir = mkdtempSync(join(tmpdir(), 'graphe-agent-'));
    const sessionDir = mkdtempSync(join(tmpdir(), 'graphe-sessions-'));
    try {
      // A conversation with something in it. Pi writes the file once there is
      // an answer in it, so both halves of an exchange go in.
      const first = await createSession({ projectRoot, agentDir, sessionDir, onEvent: () => {} });
      first.dispose();

      // Written through Pi's own manager, because nothing here can reach a
      // model to produce a real exchange.
      const pi = await import('@earendil-works/pi-coding-agent');
      const manager = pi.SessionManager.continueRecent(projectRoot, sessionDir);
      manager.appendMessage({
        role: 'user',
        content: [{ type: 'text', text: 'Hello' }],
        timestamp: Date.now(),
      });
      // Pi writes the file when an answer arrives, not when a question does,
      // so both halves have to go in for there to be anything to resume.
      manager.appendMessage({
        role: 'assistant',
        content: [{ type: 'text', text: 'Working on it.' }],
        api: 'anthropic-messages',
        provider: 'anthropic',
        model: 'test',
        stopReason: 'stop',
        timestamp: Date.now(),
        usage: {
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
      });
      expect(readdirSync(sessionDir)).toHaveLength(1);

      const carried = await createSession({ projectRoot, agentDir, sessionDir, onEvent: () => {} });
      expect(carried.conversation).toBe(manager.getSessionFile());
      expect(carried.history.length).toBeGreaterThan(0);
      carried.dispose();

      const started = await createSession({
        projectRoot,
        agentDir,
        sessionDir,
        fresh: true,
        onEvent: () => {},
      });
      expect(started.conversation).not.toBe(manager.getSessionFile());
      expect(started.history).toEqual([]);
      started.dispose();
    } finally {
      rmSync(projectRoot, { recursive: true, force: true });
      rmSync(agentDir, { recursive: true, force: true });
      rmSync(sessionDir, { recursive: true, force: true });
    }
  }, 30_000);

  it('is not what the tool wrappers do, whatever their names suggest', () => {
    const wrapper = readFileSync(join(sdk, 'dist/core/extensions/wrapper.js'), 'utf8');
    expect(wrapper).toContain('Tool call and tool result interception is handled by AgentSession');
    // It runs the tool and then looks at what tools exist afterwards. There is
    // no path here that can refuse a call, and it only ever sees extension
    // tools — never bash, read, write or edit.
    expect(wrapper).toContain('const result = await execute(');
  });
});

/**
 * A queue that would not come back was reported as an empty one.
 *
 * The throw was swallowed and the answer was `{ steering: [], followUp: [] }` —
 * the same answer as "nothing was queued". The window read that as done and
 * cleared the line off the screen, while the agent still held every word of it.
 */
describe('taking the line back out of the agent\'s hands', () => {
  it('hands back what was queued, in the order it was queued', () => {
    const taken = takingBack(() => ({ steering: ['stop that'], followUp: ['then this'] }));
    expect(taken).toEqual({ ok: true, steering: ['stop that'], followUp: ['then this'] });
  });

  it('says an empty line is empty', () => {
    expect(takingBack(() => ({ steering: [], followUp: [] }))).toEqual({
      ok: true,
      steering: [],
      followUp: [],
    });
  });

  it('does not report a refusal as an empty line', () => {
    // WHY: this is the whole defect. Both answers used to be the same object,
    // so the only thing that can be asserted is that they now differ — and that
    // the failing one carries a reason.
    const refused = takingBack(() => {
      throw new Error('the run is between steps');
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.because).toBe('the run is between steps');
    expect(refused).not.toEqual(takingBack(() => ({ steering: [], followUp: [] })));
  });

  it('still has words for something thrown that was never an error', () => {
    const refused = takingBack(() => {
      throw 'nope';
    });
    expect(refused.ok).toBe(false);
    if (refused.ok) return;
    expect(refused.because.trim()).not.toBe('');
  });
});
