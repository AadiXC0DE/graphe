/** What a saved conversation holds, read back whole.
 *
 * `session-replay.test.ts` proves the translation and the journey onto the
 * desk. This is the half of it that was missing: a step's own output, the
 * picture it took, the file it handed back, the message an add-on wrote, how a
 * step ended, and where the conversation was tidied. The fixtures are built
 * from the installed Pi package's own entry types rather than from shapes
 * invented here, so a change in what Pi writes is a type error in this file
 * instead of a quietly empty replay.
 */

import type { ContentBlock } from '@modelcontextprotocol/sdk/types.js';
import type {
  BranchSummaryEntry,
  CompactionEntry,
  CustomMessageEntry,
  SessionEntry,
  SessionMessageEntry,
} from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../src/agent/types';
import { eventsFromEntries, momentsFromEntries } from '../src/agent/pi/history';
import { applyEvent, type Turn } from '../src/lib/thread';

/* Pi's own message and content types, taken off the entry that carries them
   rather than imported from a package this repo does not depend on directly. */
type Stored = SessionMessageEntry['message'];
type Assistant = Extract<Stored, { role: 'assistant' }>;
type Result = Extract<Stored, { role: 'toolResult' }>;
type Words = Extract<Result['content'][number], { type: 'text' }>;
type Picture = Extract<Result['content'][number], { type: 'image' }>;
type Call = Extract<Assistant['content'][number], { type: 'toolCall' }>;

/** Fold a saved conversation the way the window does when a project opens. */
function revived(entries: readonly SessionEntry[]): readonly Turn[] {
  return (eventsFromEntries(entries) as AgentEvent[]).reduce(applyEvent, []);
}

/* ========================================================================== */
/* Fixtures, in Pi's own shapes                                                */
/* ========================================================================== */

const T0 = Date.parse('2026-09-14T09:00:00.000Z');

function stamp(step: number): string {
  return new Date(T0 + step * 1_000).toISOString();
}

function entry(id: string, step: number, message: Stored): SessionMessageEntry {
  return { type: 'message', id, parentId: null, timestamp: stamp(step), message };
}

const USAGE: Assistant['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** An assistant message, as Pi stores it. `how` is how its turn ended. */
function spoke(
  step: number,
  content: Assistant['content'],
  how: Assistant['stopReason'] = 'toolUse',
): SessionMessageEntry {
  return entry(`e-a${String(step)}`, step, {
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

function said(step: number, text: string): SessionMessageEntry {
  return entry(`e-u${String(step)}`, step, { role: 'user', content: text, timestamp: T0 });
}

/** What a tool came back with, as Pi stores it. */
function cameBack(
  step: number,
  callId: string,
  content: Result['content'],
  isError = false,
): SessionMessageEntry {
  return entry(`e-r${String(step)}`, step, {
    role: 'toolResult',
    toolCallId: callId,
    toolName: 'bash',
    content,
    isError,
    timestamp: T0,
  });
}

const WORDS = (text: string): Words => ({ type: 'text', text });
const PICTURE = (bytes: string): Picture => ({ type: 'image', data: bytes, mimeType: 'image/png' });

/* ========================================================================== */
/* RF-01 what a step came back with                                            */
/* ========================================================================== */

describe('RF-01 what a step came back with', () => {
  it('brings back what it printed, not only that it finished', () => {
    const entries = [cameBack(1, 'call-1', [WORDS('12 files changed, 3 insertions')])];
    expect(eventsFromEntries(entries)).toEqual([
      { type: 'tool-end', id: 'call-1', ok: true, detail: '12 files changed, 3 insertions' },
    ]);
  });

  it('draws the picture it took, and names the ones a line has no room for', () => {
    const entries = [cameBack(1, 'call-1', [WORDS('took two'), PICTURE('one'), PICTURE('two')])];
    expect(eventsFromEntries(entries)).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: true,
        detail: 'took two',
        shown: { bytes: 'two', mimeType: 'image/png' },
        kept: [{ what: '1 more picture it took', where: 'entry:e-r1' }],
      },
    ]);
  });

  it('bounds what a long output shows and says where the rest is', () => {
    const printed = 'x'.repeat(2_500);
    const [end] = eventsFromEntries([cameBack(1, 'call-1', [WORDS(printed)])]);
    if (end?.type !== 'tool-end') throw new Error('a step that never came back');

    const shown = end.detail ?? '';
    expect(shown.length).toBeLessThan(printed.length);
    // Nothing is lost: what was cut is counted, and the step says where the
    // whole of it sits in the record.
    expect(end.kept?.[0]).toEqual({
      what: `the rest of what it printed (${String(printed.length - shown.length)} more characters)`,
      where: 'entry:e-r1',
    });
  });

  it('keeps a file a tool handed back, by the uri it came from', () => {
    // An add-on's tool hands files back in the MCP SDK's own shape. Pi's result
    // type is text and pictures, so the block travels in a result untyped.
    const report: ContentBlock = {
      type: 'resource',
      resource: { uri: 'file:///tmp/report.csv', mimeType: 'text/csv', text: 'a,b\n1,2' },
    };
    const entries = [cameBack(1, 'call-1', [report] as unknown as Result['content'])];
    expect(eventsFromEntries(entries)).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: true,
        detail: 'a file it handed back (text/csv)',
        kept: [{ what: 'a file it handed back (text/csv)', where: 'file:///tmp/report.csv' }],
      },
    ]);
  });

  it('names a kind of content it has never heard of rather than dropping it', () => {
    const sound: ContentBlock = { type: 'audio', data: 'AAAA', mimeType: 'audio/wav' };
    const entries = [cameBack(1, 'call-1', [sound] as unknown as Result['content'])];
    expect(eventsFromEntries(entries)).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: true,
        detail: 'content this app does not draw (audio)',
        kept: [{ what: 'content this app does not draw (audio)', where: 'entry:e-r1' }],
      },
    ]);
  });

  it('names a picture rather than losing it when the step failed', () => {
    const entries = [cameBack(1, 'call-1', [WORDS('it broke after this'), PICTURE('png')], true)];
    expect(eventsFromEntries(entries)).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: false,
        detail: 'it broke after this',
        kept: [{ what: 'a picture it took', where: 'entry:e-r1' }],
        ending: 'failed',
      },
    ]);
  });

  it('keeps a note a step wrote under itself, with the output behind it', () => {
    const note = '2 errors, 1 request failed';
    const message: Result = {
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'run_checks',
      content: [WORDS(note)],
      details: { note },
      isError: false,
      timestamp: T0,
    };
    expect(eventsFromEntries([entry('e-r1', 1, message)])).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: true,
        detail: note,
        kept: [{ what: `what it printed (${String(note.length)} characters)`, where: 'entry:e-r1' }],
      },
    ]);
  });
});

/* ========================================================================== */
/* RF-02 a message an add-on wrote                                             */
/* ========================================================================== */

describe('RF-02 a message an add-on wrote', () => {
  const wrote = (display: boolean, content: CustomMessageEntry['content']): CustomMessageEntry => ({
    type: 'custom_message',
    id: 'c1',
    parentId: null,
    timestamp: stamp(2),
    customType: 'notes-from-the-team',
    content,
    display,
  });

  it('comes back with the extension that wrote it', () => {
    expect(eventsFromEntries([wrote(true, 'Run the migration before deploying.')])).toEqual([
      {
        type: 'extension-said',
        from: 'notes-from-the-team',
        text: 'Run the migration before deploying.',
      },
    ]);
  });

  it('is drawn as the add-on, not as the person and not as the app', () => {
    expect(revived([wrote(true, 'Run the migration before deploying.')])).toMatchObject([
      { kind: 'said', from: 'add-on', text: 'Run the migration before deploying.' },
    ]);
  });

  it('keeps a picture it sent', () => {
    const sent = wrote(true, [{ type: 'text', text: 'This chart:' }, PICTURE('png')]);
    expect(eventsFromEntries([sent])).toEqual([
      {
        type: 'extension-said',
        from: 'notes-from-the-team',
        text: 'This chart:',
        shown: { bytes: 'png', mimeType: 'image/png' },
      },
    ]);
  });

  it('honours an add-on that asked not to be shown', () => {
    expect(eventsFromEntries([wrote(false, 'Internal bookkeeping.')])).toEqual([]);
  });

  it('is not a moment the person can be taken back to', () => {
    expect(momentsFromEntries([wrote(true, 'Run the migration.')])).toEqual([]);
  });
});

/* ========================================================================== */
/* RF-03 how a step ended                                                      */
/* ========================================================================== */

describe('RF-03 how a step ended', () => {
  it('says a failure is a failure, with the reason it came back with', () => {
    const entries = [cameBack(1, 'call-1', [WORDS('ENOENT: no such file or directory')], true)];
    expect(eventsFromEntries(entries)).toEqual([
      {
        type: 'tool-end',
        id: 'call-1',
        ok: false,
        detail: 'ENOENT: no such file or directory',
        ending: 'failed',
      },
    ]);
  });

  it('reads a step somebody stopped as stopped, in Pi’s own words for it', () => {
    // `createErrorToolResult("Operation aborted")` is what the agent runtime
    // writes when the signal is aborted mid-call.
    const entries = [cameBack(1, 'call-1', [WORDS('Operation aborted')], true)];
    expect(eventsFromEntries(entries)).toEqual([
      { type: 'tool-end', id: 'call-1', ok: false, ending: 'stopped' },
    ]);
  });

  it('shows a step somebody stopped as stopped, never as one that failed', () => {
    const turns = revived([
      said(1, 'Run the tests.'),
      spoke(2, [callOn('call-1', 'bash', { command: 'npm test' })]),
      cameBack(3, 'call-1', [WORDS('Operation aborted')], true),
    ]);
    expect(turns[1]).toMatchObject({
      kind: 'did',
      callId: 'call-1',
      state: 'failed',
      detail: 'stopped',
    });
  });

  it('reads a step whose result never came as interrupted, not failed and not running', () => {
    const entries = [said(1, 'Rebuild the nav.'), spoke(2, [callOn('call-1', 'edit', { file: 'nav.tsx' })])];
    expect(eventsFromEntries(entries).filter((one) => one.type === 'tool-end')).toEqual([
      { type: 'tool-end', id: 'call-1', ok: false, ending: 'interrupted' },
    ]);
    const turns = revived(entries);
    expect(turns[1]).toMatchObject({ kind: 'did', callId: 'call-1', state: 'interrupted' });
    expect(turns.some((turn) => turn.kind === 'did' && turn.state === 'running')).toBe(false);
  });

  it('reads a call the person stopped before it ran as stopped', () => {
    const entries = [spoke(1, [callOn('call-1', 'rm', { path: 'old.html' })], 'aborted')];
    expect(eventsFromEntries(entries).filter((one) => one.type === 'tool-end')).toEqual([
      { type: 'tool-end', id: 'call-1', ok: false, ending: 'stopped' },
    ]);
  });

  it('reads a call the model failed on as failed', () => {
    const entries = [spoke(1, [callOn('call-1', 'bash', { command: 'npm test' })], 'error')];
    expect(eventsFromEntries(entries).filter((one) => one.type === 'tool-end')).toEqual([
      { type: 'tool-end', id: 'call-1', ok: false, ending: 'failed' },
    ]);
  });

  it('never says a step that came back was interrupted', () => {
    const entries = [
      spoke(1, [callOn('call-1', 'bash', { command: 'npm test' })]),
      cameBack(2, 'call-1', [WORDS('3 passed')]),
      spoke(3, [callOn('call-2', 'read', { file: 'a.ts' })]),
      cameBack(4, 'call-2', [WORDS('export {}')]),
    ];
    // One second apart in the record, so each step says it took one: the
    // duration comes off the two entry timestamps rather than a clock here.
    expect(eventsFromEntries(entries).filter((one) => one.type === 'tool-end')).toEqual([
      { type: 'tool-end', id: 'call-1', ok: true, detail: '3 passed', ms: 1_000 },
      { type: 'tool-end', id: 'call-2', ok: true, detail: 'export {}', ms: 1_000 },
    ]);
  });
});

/* ========================================================================== */
/* RF-04 where the conversation was tidied                                     */
/* ========================================================================== */

describe('RF-04 where the conversation was tidied', () => {
  const tidied: CompactionEntry = {
    type: 'compaction',
    id: 'k1',
    parentId: null,
    timestamp: stamp(3),
    summary: 'The first half of this conversation, in short.',
    firstKeptEntryId: 'e-u2',
    tokensBefore: 120_000,
  };

  it('says where it happened rather than dropping the boundary', () => {
    expect(eventsFromEntries([tidied])).toEqual([{ type: 'tidying' }, { type: 'tidied', ok: true }]);
  });

  it('comes back as one line, in the place in the conversation it happened', () => {
    const entries: SessionEntry[] = [said(1, 'Start.'), tidied, said(2, 'And now this.')];
    expect(eventsFromEntries(entries).map((one) => one.type)).toEqual([
      'user-said',
      'tidying',
      'tidied',
      'user-said',
    ]);
    const turns = revived(entries);
    expect(turns.map((turn) => turn.kind)).toEqual(['said', 'tidying', 'said']);
    expect(turns[1]).toMatchObject({ kind: 'tidying', state: 'done' });
  });

  it('brings back a branch it came away from, with what that branch said it was', () => {
    const branch: BranchSummaryEntry = {
      type: 'branch_summary',
      id: 'b1',
      parentId: null,
      timestamp: stamp(1),
      fromId: 'e-u1',
      summary: 'The other branch tried a rewrite and left it unfinished.',
    };
    expect(eventsFromEntries([branch])).toEqual([
      {
        type: 'notice',
        what: 'This conversation came back from another branch.',
        because: 'The other branch tried a rewrite and left it unfinished.',
      },
    ]);
  });
});

/* ========================================================================== */
/* RF-05 a result and the call it answers                                      */
/* ========================================================================== */

describe('RF-05 a result and the call it answers', () => {
  it('closes the very step the result names, by its id', () => {
    const turns = revived([
      spoke(1, [callOn('call-7', 'bash', { command: 'npm test' })]),
      cameBack(2, 'call-7', [WORDS('3 passed')]),
    ]);
    expect(turns).toMatchObject([{ kind: 'did', callId: 'call-7', state: 'done', detail: '3 passed' }]);
  });

  it('does not close a step somebody else’s result names', () => {
    const ends = eventsFromEntries([
      spoke(1, [callOn('call-7', 'bash', { command: 'npm test' })]),
      cameBack(2, 'call-8', [WORDS('3 passed')]),
    ]).filter((one) => one.type === 'tool-end');
    expect(ends).toEqual([
      { type: 'tool-end', id: 'call-8', ok: true, detail: '3 passed' },
      { type: 'tool-end', id: 'call-7', ok: false, ending: 'interrupted' },
    ]);
  });

  it('keeps each step its own result when two arrive out of order', () => {
    const turns = revived([
      spoke(1, [callOn('call-1', 'read', { file: 'a.ts' }), callOn('call-2', 'read', { file: 'b.ts' })]),
      cameBack(2, 'call-2', [WORDS('export const b = 2;')]),
      cameBack(3, 'call-1', [WORDS('export const a = 1;')]),
    ]);
    expect(
      turns.map((turn) => (turn.kind === 'did' ? [turn.callId, turn.state, turn.detail] : turn.kind)),
    ).toEqual([
      ['call-1', 'done', 'export const a = 1;'],
      ['call-2', 'done', 'export const b = 2;'],
    ]);
  });
});
