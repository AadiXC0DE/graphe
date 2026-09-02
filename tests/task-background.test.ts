/** Work handed to a helper that carries on after the reply.
 *
 *  The only thing an outside orchestrating add-on offered that this app did not
 *  was work that runs in the background. It has a board for exactly that, so
 *  `task` sends work there rather than a second machinery growing beside it —
 *  and the board is where somebody is already watching, so the work stays
 *  visible and stoppable from where their hand already is.
 */

import { describe, expect, it } from 'vitest';

import {
  TASK_BACKGROUND_WORDS,
  grapheTools,
  taskMode,
  taskTool,
  type PutOnBoard,
} from '../src/agent/pi/tools';
import { ROLES } from '../src/agent/pi/child';

type Asked = { doing: string; after: string | null };

/** A board that says yes and remembers what it was asked. */
function board(): { put: PutOnBoard; asked: Asked[] } {
  const asked: Asked[] = [];
  const put: PutOnBoard = (doing, after) => {
    asked.push({ doing, after });
    return Promise.resolve({ ok: true as const, id: `work-${String(asked.length)}` });
  };
  return { put, asked };
}

async function send(
  params: { task: string; role?: string; mode?: string },
  put?: PutOnBoard,
): Promise<string> {
  const answer = await taskTool('/tmp/agent', null, undefined, undefined, put).execute(
    'call-1',
    params,
    undefined,
    undefined,
    undefined as never,
  );
  const [first] = answer.content;
  return first !== undefined && first.type === 'text' ? first.text : '';
}

/* ========================================================================== */
/* Onto the board                                                              */
/* ========================================================================== */

describe('work sent to the background', () => {
  it('puts one piece on the board and answers straight away', async () => {
    const { put, asked } = board();
    const said = await send({ task: 'Port the settings panel to the new tokens', mode: 'background' }, put);

    expect(asked).toHaveLength(1);
    expect(asked[0]?.after).toBeNull();
    expect(said).toBe(TASK_BACKGROUND_WORDS.went('helper'));
  });

  it('answers without waiting for the work to finish', async () => {
    // The board's answer is the whole of it: a piece that never settles must
    // not hold the reply open.
    const never: PutOnBoard = () =>
      Promise.resolve({ ok: true as const, id: 'work-1' });
    const said = await send({ task: 'Rewrite the changelog', mode: 'background' }, never);
    expect(said).toContain('on the board');
  });

  it('sends the work with the role it was given', async () => {
    const { put, asked } = board();
    const said = await send(
      { task: 'Add a dark mode toggle', role: 'builder', mode: 'background' },
      put,
    );

    expect(asked[0]?.doing.startsWith(ROLES.builder.spoken)).toBe(true);
    expect(asked[0]?.doing).toContain('Add a dark mode toggle');
    expect(said).toContain('builder');
  });

  it('falls back to the plain helper for a role nobody recognises', async () => {
    const { put, asked } = board();
    const said = await send({ task: 'Look into the flicker', role: 'wizard', mode: 'background' }, put);
    expect(asked[0]?.doing.startsWith(ROLES.helper.spoken)).toBe(true);
    expect(said).toBe(TASK_BACKGROUND_WORDS.went('helper'));
  });

  it('tells the model to stop rather than sit and wait for it', async () => {
    const { put } = board();
    const said = await send({ task: 'Check every link', mode: 'background' }, put);
    expect(said).toMatch(/do not wait/i);
    expect(said).toMatch(/the person/i);
  });

  it('says the board refused it, and why, rather than reporting work that never started', async () => {
    const full: PutOnBoard = () =>
      Promise.resolve({ ok: false as const, because: 'The board is full.' });
    const said = await send({ task: 'Rebuild the pricing page', mode: 'background' }, full);
    expect(said).toBe(TASK_BACKGROUND_WORDS.refused('The board is full.'));
    expect(said).toContain('The board is full.');
  });

  it('still refuses an empty piece of work before it reaches the board', async () => {
    const { put, asked } = board();
    const said = await send({ task: '   ', mode: 'background' }, put);
    expect(asked).toHaveLength(0);
    expect(said).toContain('I need a piece of work');
  });
});

/* ========================================================================== */
/* Where there is no board                                                     */
/* ========================================================================== */

describe('a run with no board of its own', () => {
  it('says so plainly instead of quietly running it here', async () => {
    // A helper, or a piece already running on the board, holds no board tool —
    // and a piece that can fill the board it is running on is a loop.
    const said = await send({ task: 'Read the release notes', mode: 'background' });
    expect(said).toBe(TASK_BACKGROUND_WORDS.noBoard);
    expect(said).toMatch(/no board/i);
    expect(said).toMatch(/inside this call/i);
  });

  it('offers the board tools only alongside the board itself', () => {
    const { put } = board();
    const without = grapheTools('/tmp/agent').map((tool) => tool.name);
    const with_ = grapheTools('/tmp/agent', null, null, undefined, undefined, put).map(
      (tool) => tool.name,
    );
    expect(without).toContain('task');
    expect(without).not.toContain('set_going');
    expect(with_).toContain('task');
    expect(with_).toContain('set_going');
  });
});

/* ========================================================================== */
/* Nothing changes unless it is asked for                                      */
/* ========================================================================== */

describe('the helper that answers here', () => {
  /* Nothing is built when the tests run, so reaching the missing helper program
     is how we know the work went to a process rather than to the board. */
  const NOT_BUILT = 'not built into this copy of the app';

  it('is what a piece of work with no mode still gets', async () => {
    const { put, asked } = board();
    await expect(send({ task: 'Find out what the licence says.' }, put)).rejects.toThrow(NOT_BUILT);
    expect(asked).toHaveLength(0);
  });

  it("is what 'now' gets, said out loud", async () => {
    const { put, asked } = board();
    await expect(send({ task: 'Find out what the licence says.', mode: 'now' }, put)).rejects.toThrow(
      NOT_BUILT,
    );
    expect(asked).toHaveLength(0);
  });

  it('is what anything other than the one word gets', async () => {
    const { put, asked } = board();
    await expect(
      send({ task: 'Find out what the licence says.', mode: 'Background' }, put),
    ).rejects.toThrow(NOT_BUILT);
    expect(asked).toHaveLength(0);
  });
});

describe('which mode a call asked for', () => {
  it('is now unless the one word was said', () => {
    expect(taskMode(undefined)).toBe('now');
    expect(taskMode('now')).toBe('now');
    expect(taskMode('background')).toBe('background');
  });

  it('never guesses at something it does not recognise', () => {
    for (const asked of ['Background', 'bg', 'async', 'later', '']) {
      expect(taskMode(asked)).toBe('now');
    }
  });
});

describe('what the model is told about the choice', () => {
  it('names both modes where the model reads the parameters', () => {
    const tool = taskTool('/tmp/agent');
    const shape = JSON.stringify(tool.parameters);
    expect(shape).toContain('mode');
    expect(shape).toContain("'background'");
    expect(shape).toContain("'now'");
  });

  it('points at the mode rather than at another tool', () => {
    const tool = taskTool('/tmp/agent');
    const guidance = (tool.promptGuidelines ?? []).join('\n');
    expect(guidance).toMatch(/background/i);
    expect(guidance).toMatch(/the board/i);
  });
});
