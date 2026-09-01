/** The moment the board goes quiet.
 *
 * Work set going carries on whether or not the conversation does — which used
 * to mean that when the last piece landed, nothing said so, and the
 * conversation that started it never learned the thing it was waiting for had
 * happened.
 */

import { describe, expect, it } from 'vitest';

import { quietWords, wentQuiet, type WorkState } from '../src/work/board';

const piece = (id: string, state: WorkState, doing = `work ${id}`) => ({
  id,
  doing,
  state,
  at: 1,
});

describe('BQ-01 when it has just gone quiet', () => {
  it('says so on the step from running to finished', () => {
    const over = wentQuiet([piece('a', 'running')], [piece('a', 'done')]);
    expect(over).toHaveLength(1);
    expect(over?.[0]?.id).toBe('a');
  });

  it('waits for the last one rather than reporting the first', () => {
    const mid = wentQuiet(
      [piece('a', 'running'), piece('b', 'running')],
      [piece('a', 'done'), piece('b', 'running')],
    );
    expect(mid).toBeNull();
    const end = wentQuiet(
      [piece('a', 'done'), piece('b', 'running')],
      [piece('a', 'done'), piece('b', 'done')],
    );
    expect(end).toHaveLength(2);
  });

  it('counts one that failed as over, because it is', () => {
    const over = wentQuiet([piece('a', 'running')], [piece('a', 'failed')]);
    expect(over).toHaveLength(1);
  });

  it('keeps waiting while a piece is still queued behind another', () => {
    expect(wentQuiet([piece('a', 'running'), piece('b', 'waiting')], [piece('a', 'done'), piece('b', 'waiting')])).toBeNull();
  });
});

describe('BQ-02 when it says nothing', () => {
  /* The loud failure this guards against: saying it every time anything moves. */
  it('says nothing about a board that was already quiet', () => {
    expect(wentQuiet([piece('a', 'done')], [piece('a', 'done')])).toBeNull();
  });

  it('says nothing on the very first notice, which has nothing to compare to', () => {
    expect(wentQuiet(undefined, [piece('a', 'done')])).toBeNull();
  });

  it('says nothing when everything was cleared away rather than finished', () => {
    expect(wentQuiet([piece('a', 'running')], [])).toBeNull();
  });

  it('says nothing while a piece is stopped on a question', () => {
    expect(wentQuiet([piece('a', 'running')], [piece('a', 'needs-you')])).toBeNull();
  });
});

describe('BQ-03 what it tells the conversation', () => {
  it('names each piece, so a model reading only this knows where to look', () => {
    const said = quietWords([piece('a', 'done', 'rewrite the header'), piece('b', 'done', 'add the tests')]);
    expect(said).toContain('rewrite the header');
    expect(said).toContain('add the tests');
    expect(said).toContain('2 pieces finished');
  });

  it('counts one piece as one piece', () => {
    expect(quietWords([piece('a', 'done', 'the only one')])).toContain('1 piece finished');
  });

  it('says plainly which did not work rather than folding it into the total', () => {
    const said = quietWords([piece('a', 'done', 'this worked'), piece('b', 'failed', 'this did not')]);
    expect(said).toContain('1 piece finished and 1 piece did not');
    expect(said).toContain('this did not (did not finish)');
  });

  it('asks for the work to be carried on, not merely reported', () => {
    expect(quietWords([piece('a', 'done')])).toContain('carry on with what you were doing');
  });
});
