/** Watching the agent's browser work.
 *
 *  The browser runs out of sight so it never takes the screen from anybody,
 *  which leaves "what is it doing" with no answer. The pictures come from the
 *  shell rather than from a connection the window opens: the window is served
 *  from a file, and a socket opened there is refused by anything on this
 *  machine before it carries a single frame.
 */

import { describe, expect, it } from 'vitest';

import { MOST_PICTURE, NOTHING_WATCHED, watching } from '../src/preview/watching';

describe('one picture at a time', () => {
  it('draws the picture it is handed', () => {
    expect(watching(NOTHING_WATCHED, 'AAAA').picture).toBe('data:image/jpeg;base64,AAAA');
  });

  it('keeps the last picture rather than blanking it', () => {
    const seen = watching(NOTHING_WATCHED, 'AAAA');
    for (const nonsense of ['', null, undefined, 42, {}, []]) {
      expect(watching(seen, nonsense).picture, String(nonsense)).toBe(seen.picture);
    }
  });

  /** One arrives every second or so and the last is held in memory. */
  it('ignores one too big to be worth holding', () => {
    const seen = watching(NOTHING_WATCHED, 'AAAA');
    expect(watching(seen, 'A'.repeat(MOST_PICTURE + 1)).picture).toBe(seen.picture);
    expect(watching(seen, 'B'.repeat(2000)).picture).toContain('BBBB');
  });
});
