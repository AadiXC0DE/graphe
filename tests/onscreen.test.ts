/** A window nobody can see does not do a screenful of work for nobody. */

// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';

import { whenHidden } from '../src/lib/onscreen';

describe('being told whether the window is somewhere it can be seen', () => {
  it('answers on the way in, and again whenever it changes', () => {
    const seen: boolean[] = [];
    const showing = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const stop = whenHidden((hidden) => seen.push(hidden));
    // A window that opens behind another one is told before it draws anything.
    expect(seen).toEqual([false]);

    showing.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([false, true]);

    showing.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([false, true, false]);

    // And nothing is said to somebody who has stopped listening.
    stop();
    showing.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    expect(seen).toEqual([false, true, false]);
    showing.mockRestore();
  });
});
