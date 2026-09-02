/** A long conversation, read without waiting for it and searched without
 *  scrolling it.
 *
 * Reopening a sitting folded its whole history into the page: ten thousand
 * events, one array. It draws the tail now and offers the rest. And the
 * browser's own find only ever reached what was drawn, which after that change
 * is the tail, so finding a word is the app's job.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { AT_FIRST, lastTurns } from '../src/lib/hydrate';
import { findIn, nextFound, threadWords, wordsOf } from '../src/lib/threadview';
import { said } from '../src/lib/thread';
import type { Turn } from '../src/lib/thread';

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const bar = readFileSync(
  fileURLToPath(new URL('../src/components/FindInThread.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(fileURLToPath(new URL('../src/App.css', import.meta.url)), 'utf8');

const many = (count: number): readonly Turn[] =>
  Array.from({ length: count }, (_, at) => said('you', `Turn ${String(at)}`));

describe('drawing the tail of a long conversation', () => {
  it('leaves a short one whole, with nothing to load', () => {
    const turns = many(12);
    expect(lastTurns(turns, AT_FIRST)).toEqual({ turns, earlier: 0 });
  });

  it('keeps the newest, because nobody reopens a sitting to read the top', () => {
    const paged = lastTurns(many(1200), AT_FIRST);
    expect(paged.turns).toHaveLength(AT_FIRST);
    expect(paged.earlier).toBe(700);
    expect(wordsOf(paged.turns[0] as Turn)).toBe('Turn 700');
  });

  it('says how many, because "load more" gives nobody an idea of the cost', () => {
    expect(threadWords.earlier(700)).toBe('Show 700 earlier turns');
    expect(threadWords.earlier(1)).toBe('Show 1 earlier turn');
  });

  it('is drawn by the thread, and asking for more asks for a page at a time', () => {
    expect(app).toContain('const paged = lastTurns(desk.turns, drawing);');
    expect(app).toContain('setDrawing((was) => was + AT_FIRST)');
  });

  it('starts again for each conversation, so one tab does not draw the next', () => {
    expect(app).toContain('setDrawing(AT_FIRST);\n  }, [shownConversation]);');
  });
});

describe('finding a word in it', () => {
  const turns: readonly Turn[] = [
    said('you', 'the pricing page needs work'),
    said('graphe', 'I rewrote the header'),
    said('you', 'and the pricing table'),
  ];

  it('searches every turn, not the ones on screen', () => {
    expect(findIn(turns, 'pricing').map((one) => one.at)).toEqual([0, 2]);
    expect(app).toContain('turns={desk.turns}');
  });

  it('carries the line each result sits on, so a result is legible unopened', () => {
    expect(findIn(turns, 'header')[0]?.line).toBe('I rewrote the header');
  });

  it('wraps at the end rather than stopping there', () => {
    expect(nextFound(findIn(turns, 'pricing'), 2)).toBe(0);
    expect(nextFound(findIn(turns, 'nothing'), null)).toBeNull();
  });

  it('draws enough of the conversation to reach the result before scrolling', () => {
    expect(bar).toContain('onAt(to, turns.length - to);');
    expect(app).toContain('setDrawing((was) => Math.max(was, showFrom));');
  });

  it('marks where it landed, and lets the mark fade', () => {
    expect(app).toContain("row.turn.id === foundId ? 'thread__row--found' : ''");
    expect(styles).toContain('.thread__row--found {');
  });

  it('says nothing was found rather than showing an empty count', () => {
    expect(bar).toContain('threadWords.nothingFound');
  });
});
