/** T28, T29, T31: reading a saved conversation back.
 *
 * A transcript the app is asked to open is not always one this version wrote:
 * it can be truncated, it can hold entries from a newer Pi, it can hold tools
 * and messages that belong to an add-on, and it can end in the middle of a step
 * because the app was closed. Phase 10.2 asks for all three as named cases.
 *
 * The entries are built in the installed Pi package's own types, so a change in
 * what Pi writes fails to compile here rather than quietly replaying as nothing.
 * The finer-grained replay properties are in `tests/session-replay-fidelity.test.ts`;
 * what is here is the whole-file behaviour those cases are about.
 */

import type {
  CustomMessageEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../../src/agent/types';
import { eventsFromEntries } from '../../src/agent/pi/history';
import { applyEvent, type Turn } from '../../src/lib/thread';

type Stored = SessionMessageEntry['message'];
type Assistant = Extract<Stored, { role: 'assistant' }>;
type Result = Extract<Stored, { role: 'toolResult' }>;
type Words = Extract<Result['content'][number], { type: 'text' }>;
type Call = Extract<Assistant['content'][number], { type: 'toolCall' }>;

const T0 = Date.parse('2026-09-14T09:00:00.000Z');

const USAGE: Assistant['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

function entry(id: string, message: Stored): SessionMessageEntry {
  return { type: 'message', id, parentId: null, timestamp: new Date(T0).toISOString(), message };
}

function personSaid(id: string, text: string): SessionMessageEntry {
  return entry(id, { role: 'user', content: text, timestamp: T0 });
}

function spoke(id: string, content: Assistant['content'], how: Assistant['stopReason'] = 'toolUse'): SessionMessageEntry {
  return entry(id, {
    role: 'assistant',
    content,
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'claude-sonnet-4-5',
    usage: USAGE,
    stopReason: how,
    timestamp: T0,
  });
}

function callOn(id: string, name: string, input: Record<string, unknown>): Call {
  return { type: 'toolCall', id, name, arguments: input };
}

function cameBack(id: string, callId: string, content: Result['content'], isError = false): SessionMessageEntry {
  return entry(id, {
    role: 'toolResult',
    toolCallId: callId,
    toolName: 'bash',
    content,
    isError,
    timestamp: T0,
  });
}

function addonWrote(id: string, customType: string, text: string, display = true): CustomMessageEntry {
  return {
    type: 'custom_message',
    id,
    parentId: null,
    timestamp: new Date(T0).toISOString(),
    customType,
    content: [{ type: 'text', text }],
    display,
  } as CustomMessageEntry;
}

const WORDS = (text: string): Words => ({ type: 'text', text });

/** The conversation as somebody sitting in front of it would see it. */
function revived(entries: readonly unknown[]): readonly Turn[] {
  return (eventsFromEntries(entries) as readonly AgentEvent[]).reduce(applyEvent, []);
}

/* -------------------------------------------------------------------------- */

describe('T28: a transcript that is partial or corrupt', () => {
  it('keeps every readable line and drops only what it cannot read', () => {
    const entries: unknown[] = [
      personSaid('e-1', 'make the header sticky'),
      // What a file written by a dying process, a newer version or another tool
      // looks like: half an entry, an entry of an unknown kind, and values that
      // are not entries at all.
      null,
      42,
      {},
      { type: 'something-new-from-pi' },
      { type: 'message', id: 'e-cut', message: { role: 'assistant' } },
      spoke('e-2', [{ type: 'text', text: 'Doing it now.' }], 'toolUse'),
    ];

    const events = eventsFromEntries(entries);
    expect(() => events).not.toThrow();
    expect(events).toEqual([
      { type: 'user-said', text: 'make the header sticky' },
      { type: 'message-delta', text: 'Doing it now.' },
      { type: 'message-end' },
    ]);

    const turns = revived(entries);
    expect(turns.map((one) => one.kind)).toEqual(['said', 'said']);
    expect(turns[1]).toMatchObject({ kind: 'said', from: 'graphe', streaming: false, text: 'Doing it now.' });
  });

  it('leaves no step running when the record ends before the result', () => {
    // The app was closed mid-step. A call with no result must come back closed,
    // because a replay that leaves one open comes back on a spinner that never
    // stops.
    const entries: unknown[] = [
      personSaid('e-1', 'run the tests'),
      spoke('e-2', [callOn('call-1', 'bash', { command: 'npm test' })]),
    ];
    const turns = revived(entries);
    const step = turns.find((one) => one.kind === 'did');
    expect(step).toMatchObject({ kind: 'did', state: 'interrupted' });
    expect(turns.every((one) => one.kind !== 'did' || one.state !== 'running')).toBe(true);
  });

  it('answers with no event at all for an entry it does not recognise', () => {
    /* Phase 10.2 also asks that an "error/recovery entry" be visible. The replay
       layer has none to give: an unreadable entry produces nothing, and the
       window's `Trouble` line is fed by the shell rather than by this reader, so
       the clause is recorded in the catalogue rather than asserted here. */
    expect(eventsFromEntries([{ type: 'something-new-from-pi' }, {}, 42])).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('T29: history written by tools and add-ons this build does not know', () => {
  it('brings back a tool it has never heard of, with its own name and its result', () => {
    const entries: unknown[] = [
      personSaid('e-1', 'count the words'),
      spoke('e-2', [callOn('call-1', 'count_words_from_an_addon', { file: 'notes.md' })]),
      cameBack('e-3', 'call-1', [WORDS('412 words')]),
    ];
    const turns = revived(entries);

    const step = turns.find((one) => one.kind === 'did');
    expect(step).toMatchObject({ kind: 'did', state: 'done' });
    // The add-on's own names travel with the step, and so does what it answered:
    // a replay that lost either is a conversation nobody can learn from.
    expect(step?.kind === 'did' ? step.real : '').toContain('count_words_from_an_addon');
    expect(step?.kind === 'did' ? step.detail : '').toContain('412 words');
  });

  it('brings back a message an add-on wrote as the add-on, not as the person', () => {
    const entries: unknown[] = [
      personSaid('e-1', 'check the linter'),
      addonWrote('e-2', 'linting-helper', 'The linter found 3 problems.'),
      addonWrote('e-3', 'linting-helper', 'internal bookkeeping', false),
    ];
    const events = eventsFromEntries(entries);

    expect(events).toEqual([
      { type: 'user-said', text: 'check the linter' },
      { type: 'extension-said', from: 'linting-helper', text: 'The linter found 3 problems.' },
    ]);
    const turns = revived(entries);
    expect(turns[1]).toMatchObject({ kind: 'said', from: 'add-on' });
    expect(turns).toHaveLength(2);
  });
});

/* -------------------------------------------------------------------------- */

describe('T31: a provider that went away in the middle of a tool', () => {
  it('keeps what was already written down, and closes the step honestly', () => {
    const entries: unknown[] = [
      personSaid('e-1', 'build the site'),
      spoke('e-2', [{ type: 'text', text: 'Starting the build.' }]),
      spoke('e-3', [callOn('call-1', 'bash', { command: 'npm run build' })]),
      // The result never arrived: the connection went, or the app was closed
      // waiting for it.
    ];
    const turns = revived(entries);

    expect(turns[0]).toMatchObject({ kind: 'said', from: 'you', text: 'build the site' });
    expect(turns[1]).toMatchObject({ kind: 'said', from: 'graphe', text: 'Starting the build.' });
    const step = turns[2];
    expect(step).toMatchObject({ kind: 'did', state: 'interrupted' });
    expect(step?.kind === 'did' ? step.state : '').not.toBe('failed');
  });

  it('does not quietly drop a result that is there when the next call is not', () => {
    const entries: unknown[] = [
      spoke('e-1', [callOn('call-1', 'bash', { command: 'npm test' })]),
      cameBack('e-2', 'call-1', [WORDS('all 12 tests passed')]),
      spoke('e-3', [callOn('call-2', 'bash', { command: 'npm run build' })]),
    ];
    const turns = revived(entries);
    const steps = turns.filter((one) => one.kind === 'did');

    expect(steps).toHaveLength(2);
    expect(steps[0]).toMatchObject({ state: 'done' });
    expect(steps[0]?.kind === 'did' ? steps[0].detail : '').toContain('all 12 tests passed');
    expect(steps[1]).toMatchObject({ state: 'interrupted' });
  });
});
