/** What a server has said, kept by the line.
 *
 * The two things that break a naive buffer are a chunk that stops mid-line and
 * a line that never ends. Both are checked here, along with the ceiling holding
 * under a server that talks all afternoon.
 */

import { describe, expect, it } from 'vitest';

import { CUT, MOST_LINES, MOST_PER_LINE, scrollback, scrollbackWords } from '../src/lib/scrollback';

describe('what it keeps', () => {
  it('splits what arrives into lines', () => {
    const kept = scrollback();
    kept.push('one\ntwo\nthree\n');
    expect(kept.lines()).toEqual(['one', 'two', 'three']);
    expect(kept.count()).toBe(3);
  });

  it('holds a line that arrived in pieces until its newline', () => {
    const kept = scrollback();
    kept.push('Serv');
    expect(kept.lines()).toEqual(['Serv']);
    // Still one line, not two: the chunk boundary is not a line boundary.
    kept.push('er ready on ');
    kept.push('http://localhost:5173\n');
    expect(kept.lines()).toEqual(['Server ready on http://localhost:5173']);
    expect(kept.count()).toBe(1);
  });

  it('shows the line still being written before it ends', () => {
    const kept = scrollback();
    kept.push('done\nbuilding');
    expect(kept.lines()).toEqual(['done', 'building']);
    // And it is not counted as gone by, so the finished line is not skipped.
    expect(kept.count()).toBe(1);
  });

  it('drops the oldest lines rather than growing', () => {
    const kept = scrollback(5);
    for (let at = 1; at <= 50; at += 1) kept.push(`line ${String(at)}\n`);
    expect(kept.lines()).toEqual(['line 46', 'line 47', 'line 48', 'line 49', 'line 50']);
    expect(kept.dropped()).toBe(45);
    expect(kept.count()).toBe(50);
  });

  it('keeps ten thousand lines by default', () => {
    const kept = scrollback();
    for (let at = 0; at < MOST_LINES + 100; at += 1) kept.push('x\n');
    expect(kept.lines().length).toBe(MOST_LINES);
  });

  it('forgets everything when the thing restarts', () => {
    const kept = scrollback();
    kept.push('old\n');
    kept.clear();
    expect(kept.lines()).toEqual([]);
    expect(kept.count()).toBe(0);
    expect(kept.bytes()).toBe(0);
  });
});

describe('a line that never ends', () => {
  it('cuts one enormous line rather than holding all of it', () => {
    const kept = scrollback();
    kept.push('x'.repeat(2_000_000));
    const [only] = kept.lines();
    expect(only?.length).toBe(MOST_PER_LINE + CUT.length);
    expect(only?.endsWith(CUT)).toBe(true);
    expect(kept.bytes()).toBeLessThan(MOST_PER_LINE * 2);
  });

  it('stays cut however many chunks it arrives in', () => {
    const kept = scrollback();
    for (let at = 0; at < 500; at += 1) kept.push('y'.repeat(10_000));
    expect(kept.bytes()).toBeLessThan(MOST_PER_LINE * 2);
    expect(kept.lines().length).toBe(1);
  });

  /* A progress bar writes over its own row with a carriage return, so it is one
     line that changes rather than thousands of lines that pile up. */
  it('lets a carriage return write the line again', () => {
    const kept = scrollback();
    kept.push('building 10%\rbuilding 50%\rbuilding 100%');
    expect(kept.lines()).toEqual(['building 100%']);
    kept.push('\ndone\n');
    expect(kept.lines()).toEqual(['building 100%', 'done']);
  });

  it('reads a Windows line ending as one ending, not two', () => {
    const kept = scrollback();
    kept.push('one\r\ntwo\r\n');
    expect(kept.lines()).toEqual(['one', 'two']);
  });

  it('holds bytes down under a progress bar that redraws forever', () => {
    const kept = scrollback();
    for (let at = 0; at <= 100_000; at += 1) kept.push(`\r${String(at)}%`);
    expect(kept.bytes()).toBeLessThan(100);
  });
});

describe('what a reader gets', () => {
  it('hands back only what is new', () => {
    const kept = scrollback();
    kept.push('one\ntwo\n');
    let cursor = 0;
    expect(kept.since(cursor)).toEqual(['one', 'two']);
    cursor = kept.count();
    expect(kept.since(cursor)).toEqual([]);
    kept.push('three\n');
    expect(kept.since(cursor)).toEqual(['three']);
  });

  /* The line being written comes back each time it grows — it is the same line,
     and a reader that skipped it would never see it finish. */
  it('keeps handing back the line still being written until it ends', () => {
    const kept = scrollback();
    kept.push('one\n');
    const cursor = kept.count();
    kept.push('half');
    expect(kept.since(cursor)).toEqual(['half']);
    kept.push(' a line\n');
    expect(kept.since(cursor)).toEqual(['half a line']);
    expect(kept.since(kept.count())).toEqual([]);
  });

  it('gives what survives when a reader has been away longer than the ring', () => {
    const kept = scrollback(3);
    kept.push('one\ntwo\n');
    const cursor = kept.count();
    for (let at = 0; at < 10; at += 1) kept.push(`later ${String(at)}\n`);
    // Asked for line 2 onward, and line 2 is long gone: everything still held.
    expect(kept.since(cursor)).toEqual(kept.lines());
  });

  it('says when the front has scrolled off', () => {
    expect(scrollbackWords.trimmed(1200)).toContain('1,200');
  });
});
