/** One request, several pieces of work, no clicks.
 *
 * The board already ran pieces side by side in their own copies; only a person
 * could put anything on it. This is the tool that lets the agent that worked
 * out the list put the list on. What is checked here is the part that decides:
 * which pieces go on, what each one is told to wait for, and what is refused
 * rather than guessed at.
 */

import { describe, expect, it } from 'vitest';

import { APART_WORDS, MOST_APART, setGoingTool, type PutOnBoard } from '../src/agent/pi/tools';

/** A board that says yes and remembers what it was asked. */
function board(): { put: PutOnBoard; asked: { doing: string; after: string | null }[] } {
  const asked: { doing: string; after: string | null }[] = [];
  const put: PutOnBoard = (doing, after) => {
    asked.push({ doing, after });
    return Promise.resolve({ ok: true as const, id: `work-${String(asked.length)}` });
  };
  return { put, asked };
}

async function run(
  put: PutOnBoard,
  pieces: readonly { doing: string; after?: number }[],
): Promise<string> {
  const tool = setGoingTool(put);
  // Only the first two arguments matter here; the rest are Pi's own plumbing.
  const call = tool.execute as unknown as (
    id: string,
    params: { pieces: readonly { doing: string; after?: number }[] },
  ) => Promise<unknown>;
  const answer = await call('call-1', { pieces });
  const first = (answer as { content: readonly { text?: string }[] }).content[0];
  return first?.text ?? '';
}

/* ========================================================================== */
/* SG-01 what goes on the board                                                */
/* ========================================================================== */

describe('SG-01 several pieces at once', () => {
  it('puts each one on, in the order it was given', async () => {
    const { put, asked } = board();
    const said = await run(put, [
      { doing: 'Rebuild the pricing page' },
      { doing: 'Rewrite the footer' },
    ]);

    expect(asked.map((one) => one.doing)).toEqual(['Rebuild the pricing page', 'Rewrite the footer']);
    expect(asked.every((one) => one.after === null)).toBe(true);
    expect(said).toContain('Rebuild the pricing page');
    expect(said).toContain(APART_WORDS.dontWait);
  });

  it('turns a place in the list into the name the board gave that piece', async () => {
    const { put, asked } = board();
    await run(put, [
      { doing: 'Move the tokens' },
      { doing: 'Use them everywhere', after: 1 },
      { doing: 'Take the photographs', after: 2 },
    ]);

    expect(asked[1]?.after).toBe('work-1');
    expect(asked[2]?.after).toBe('work-2');
  });

  /* A piece cannot wait for one that has not been asked for yet, and a number
     that means nothing must not silently become "waits for nothing important". */
  it('refuses a wait that points nowhere rather than guessing', async () => {
    const { put, asked } = board();
    await run(put, [
      { doing: 'First', after: 2 },
      { doing: 'Second', after: 9 },
      { doing: 'Third', after: 0 },
    ]);

    expect(asked.map((one) => one.after)).toEqual([null, null, null]);
  });

  it('never lets a piece wait for itself', async () => {
    const { put, asked } = board();
    await run(put, [{ doing: 'Only one', after: 1 }]);
    expect(asked[0]?.after).toBeNull();
  });
});

/* ========================================================================== */
/* SG-02 what it will not do                                                   */
/* ========================================================================== */

describe('SG-02 the limits', () => {
  it('has nothing to do with an empty list, and says so', async () => {
    const { put, asked } = board();
    expect(await run(put, [])).toBe(APART_WORDS.none);
    expect(await run(put, [{ doing: '   ' }])).toBe(APART_WORDS.none);
    expect(asked).toHaveLength(0);
  });

  it('refuses more than a person could read, before starting any of them', async () => {
    const { put, asked } = board();
    const many = Array.from({ length: MOST_APART + 1 }, (_, at) => ({ doing: `Piece ${String(at)}` }));
    expect(await run(put, many)).toBe(APART_WORDS.tooMany);
    expect(asked).toHaveLength(0);
  });

  it('carries on past one the board refused, and names it', async () => {
    const asked: string[] = [];
    const put: PutOnBoard = (doing) => {
      asked.push(doing);
      return Promise.resolve(
        doing === 'Bad one'
          ? { ok: false as const, because: 'Nothing follows what did not land.' }
          : { ok: true as const, id: `work-${String(asked.length)}` },
      );
    };

    const said = await run(put, [{ doing: 'Bad one' }, { doing: 'Good one' }]);
    expect(asked).toEqual(['Bad one', 'Good one']);
    expect(said).toContain('Good one');
    expect(said).toContain('Nothing follows what did not land.');
  });

  it('says plainly when none of them went on', async () => {
    const put: PutOnBoard = () => Promise.resolve({ ok: false as const, because: 'No.' });
    const said = await run(put, [{ doing: 'One' }, { doing: 'Two' }]);
    expect(said).toContain('Nothing went on the board.');
    expect(said).not.toContain(APART_WORDS.dontWait);
  });
});

/* ========================================================================== */
/* SG-03 the words                                                             */
/* ========================================================================== */

describe('SG-03 what it tells the model', () => {
  it('counts what went on, in words', () => {
    expect(APART_WORDS.went(1)).toMatch(/^One piece of work is on the board/);
    expect(APART_WORDS.went(3)).toMatch(/^3 pieces of work are on the board/);
  });

  it('tells it not to sit and wait, because the board is where they are watched', () => {
    expect(APART_WORDS.dontWait).toMatch(/Do not wait for them/i);
  });

  it('keeps the machinery out of what a person could end up reading', () => {
    for (const said of [APART_WORDS.none, APART_WORDS.tooMany, APART_WORDS.went(2)]) {
      expect(said).not.toMatch(/\b(worktree|branch|commit|git|process|thread)\b/i);
    }
  });
});
