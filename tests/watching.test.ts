/** Watching the agent's browser work.
 *
 *  The browser runs out of sight so it never takes the screen from anybody,
 *  which leaves "what is it doing" with no answer. This is the answer, and the
 *  one rule it has to keep is that a message it does not recognise leaves the
 *  picture somebody is looking at exactly where it was.
 */

import { describe, expect, it } from 'vitest';

import { MOST_PICTURE, NOTHING_WATCHED, readWatched, watching } from '../src/preview/watching';
import { readPort, watchAddress } from '../src/agent/pi/computer';

describe('one message at a time', () => {
  it('takes the picture off a frame', () => {
    const now = watching(NOTHING_WATCHED, { type: 'frame', seq: 1, data: 'AAAA' });
    expect(now.picture).toBe('data:image/jpeg;base64,AAAA');
  });

  it('keeps the last picture when the next message is not one', () => {
    const seen = watching(NOTHING_WATCHED, { type: 'frame', data: 'AAAA' });
    for (const other of [
      { type: 'status', connected: true },
      { type: 'tabs', tabs: [] },
      { type: 'command', action: 'navigate' },
      { type: 'something-new-nobody-has-seen' },
      { type: 'frame', data: '' },
      {},
      null,
    ]) {
      expect(watching(seen, other).picture, JSON.stringify(other)).toBe(seen.picture);
    }
  });

  /** A frame arrives every second and the last one is held in memory. One that
   *  is enormous is one to ignore, not one to run out of room for. */
  it('ignores a picture too big to be worth holding', () => {
    const seen = watching(NOTHING_WATCHED, { type: 'frame', data: 'AAAA' });
    const huge = watching(seen, { type: 'frame', data: 'A'.repeat(MOST_PICTURE + 1) });
    expect(huge.picture).toBe(seen.picture);
    const fine = watching(seen, { type: 'frame', data: 'B'.repeat(1000) });
    expect(fine.picture).toContain('BBBB');
  });

  it('follows where the browser went, and what it complained about', () => {
    const moved = watching(NOTHING_WATCHED, { type: 'url', url: 'https://example.com' });
    expect(moved.address).toBe('https://example.com');
    const wrong = watching(moved, { type: 'page_error', text: 'TypeError: boom\n  at x' });
    expect(wrong.trouble).toBe('TypeError: boom');
    // And the address it was on is still there.
    expect(wrong.address).toBe('https://example.com');
  });

  it('reads a message off the wire, and nothing off anything else', () => {
    expect(readWatched('{"type":"frame"}')).toEqual({ type: 'frame' });
    for (const nonsense of ['not json', '', 42, null, undefined, new Uint8Array()]) {
      expect(readWatched(nonsense), String(nonsense)).toBeNull();
    }
  });
});

describe('where to watch it', () => {
  it('asks for one picture a second, which is enough to follow and no more', () => {
    expect(watchAddress(65450)).toBe('ws://127.0.0.1:65450/?maxFps=1');
  });

  it('reads the port the browser chose, and nothing out of nonsense', () => {
    expect(readPort({ port: 65450 })).toBe(65450);
    expect(readPort({ port: 0 })).toBeNull();
    expect(readPort({ port: 'nope' })).toBeNull();
    expect(readPort(null)).toBeNull();
  });
});
