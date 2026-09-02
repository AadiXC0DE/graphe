/** The helper board: what a piece of work sent off says about itself.
 *
 * Every case here is something that was on screen and wrong. A helper is the
 * one thing in this app that works out of sight, so the card is the only
 * evidence there is — a card that loses the question, or reports "nothing said
 * yet" about a helper that answered in full, is worse than no card.
 */

import { describe, expect, it } from 'vitest';

import type { AgentEvent, ToolCall } from '../src/agent/types';
import { applyEvent, type Turn } from '../src/lib/thread';
import { nowDoing } from '../src/lib/projects';

const HELP: ToolCall = {
  id: 'call-1',
  name: 'task',
  input: { task: 'Find every page that loads a font from somewhere else' },
};

function fold(events: readonly AgentEvent[]): readonly Turn[] {
  return events.reduce<readonly Turn[]>((turns, event) => applyEvent(turns, event), []);
}

describe('a piece of work sent to a helper', () => {
  it('keeps the question once the first answer arrives', () => {
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-progress', id: 'call-1', text: 'Reading the layout files…' },
    ]);
    const [helper] = nowDoing(turns).helpers;

    // Both, not one overwriting the other.
    expect(helper?.task).toBe('Find every page that loads a font from somewhere else');
    expect(helper?.saying).toBe('Reading the layout files…');
  });

  it('still says what it found after it has finished', () => {
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-progress', id: 'call-1', text: 'Two of them do: the blog and the changelog.' },
      { type: 'tool-end', id: 'call-1', ok: true },
    ]);
    const [helper] = nowDoing(turns).helpers;

    expect(helper?.state).toBe('done');
    expect(helper?.saying).toBe('Two of them do: the blog and the changelog.');
  });

  it('says nothing only when nothing was said', () => {
    const turns = fold([{ type: 'tool-start', call: HELP }, { type: 'tool-end', id: 'call-1', ok: true }]);
    expect(nowDoing(turns).helpers[0]?.saying).toBeNull();
  });

  /* A builder running a test suite has no findings yet and is not stuck. The
     step it is on is the only honest thing to draw. */
  it('shows the step a helper is on before it has found anything', () => {
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-progress', id: 'call-1', text: 'Running npm test' },
    ]);
    const [helper] = nowDoing(turns).helpers;

    expect(helper?.state).toBe('running');
    expect(helper?.saying).toBe('Running npm test');
  });

  it('keeps what it has found above the step it is on', () => {
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-progress', id: 'call-1', text: 'Two pages do.\n\nRunning npm test' },
    ]);

    expect(nowDoing(turns).helpers[0]?.saying).toBe('Two pages do.\n\nRunning npm test');
  });

  it('counts from when it began, not from when the board was drawn', () => {
    const before = Date.now();
    const turns = fold([{ type: 'tool-start', call: HELP }]);
    const [helper] = nowDoing(turns, before + 60_000).helpers;

    expect(helper?.startedAt).toBeGreaterThanOrEqual(before);
    expect(helper?.startedAt).toBeLessThan(before + 60_000);
  });

  it('keeps several apart, and each with its own question', () => {
    const second: ToolCall = { id: 'call-2', name: 'task', input: { task: 'Check the contrast on every button' } };
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-start', call: second },
      { type: 'tool-progress', id: 'call-2', text: 'Three fail at the smallest size.' },
      { type: 'tool-end', id: 'call-2', ok: true },
    ]);
    const { helpers } = nowDoing(turns);

    expect(helpers).toHaveLength(2);
    expect(helpers[0]?.state).toBe('running');
    expect(helpers[0]?.saying).toBeNull();
    expect(helpers[1]?.task).toBe('Check the contrast on every button');
    expect(helpers[1]?.saying).toBe('Three fail at the smallest size.');
  });

  /* A real piece of work is a paragraph, and the detail every other step gets
     is dropped past 64 characters. That rule threw the whole question away, so
     the card read "Asked" and then nothing. */
  it('keeps a long question whole', () => {
    const long =
      'Go through every page and tell me which ones load a font from somewhere other than our own server, and what each one is loading.';
    const turns = fold([
      { type: 'tool-start', call: { id: 'call-3', name: 'task', input: { task: long } } },
    ]);

    expect(nowDoing(turns).helpers[0]?.task).toBe(long);
  });

  /* The board shows everything a helper has said. Only the feed row is short,
     and it is shortened where it is drawn. */
  it('keeps every line of what it said, not the last one', () => {
    const found = 'Two pages do.\nThe blog loads Inter from Google.\nThe changelog loads it too.';
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-progress', id: 'call-1', text: found },
      { type: 'tool-end', id: 'call-1', ok: true },
    ]);

    expect(nowDoing(turns).helpers[0]?.saying).toBe(found);
  });

  it('marks one that stopped as stopped', () => {
    const turns = fold([
      { type: 'tool-start', call: HELP },
      { type: 'tool-end', id: 'call-1', ok: false },
    ]);
    expect(nowDoing(turns).helpers[0]?.state).toBe('failed');
  });

  /* Somebody else's tool can be called `subagent` and mean something else
     entirely. It wore the helper's words and drew a card that said only "a
     piece of work" — a label nobody wrote, where the question belongs. */
  it('is not a helper when no piece of work was handed over', () => {
    const turns = fold([
      { type: 'tool-start', call: { id: 'call-1', name: 'subagent', input: { action: 'status' } } },
    ]);
    expect(nowDoing(turns).helpers).toEqual([]);
    expect(turns[0]).toMatchObject({ kind: 'did', label: 'Working on your project' });
  });
});
