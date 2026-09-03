/** Nothing subscribes to the shell without a way to stop.
 *
 * A window that switches between eight conversations twenty times subscribes
 * and unsubscribes hundreds of times. One `ipcRenderer.on` with no matching
 * `off` is not a leak anybody notices in a morning: it is a listener list that
 * grows all day, holding every closure it was given, and the conversation it
 * closed over with it. So the pairing is a test rather than a habit.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const read = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8');

const preload = read('electron/preload.ts');
const app = read('src/App.tsx');

const all = (text: string, pattern: RegExp): readonly string[] =>
  [...text.matchAll(pattern)].map((found) => found[1] ?? '');

const tally = (names: readonly string[]): Readonly<Record<string, number>> => {
  const counts: Record<string, number> = {};
  for (const name of names) counts[name] = (counts[name] ?? 0) + 1;
  return counts;
};

describe('every listener the preload opens, it closes', () => {
  const opened = all(preload, /ipcRenderer\.on\(CHANNEL\.(\w+)/g);
  const closed = all(preload, /ipcRenderer\.(?:off|removeListener)\(CHANNEL\.(\w+)/g);

  it('subscribes to something, so this test is measuring anything at all', () => {
    expect(opened.length).toBeGreaterThan(10);
  });

  it('closes each channel exactly as often as it opens it', () => {
    expect(tally(closed)).toEqual(tally(opened));
  });

  /* An unsubscriber the caller cannot reach is one nobody will call. */
  it('hands every subscription back as a function to stop it', () => {
    const subscribes = preload.split('ipcRenderer.on(CHANNEL.').length - 1;
    const returns = preload.split('return () =>').length - 1;
    expect(returns).toBeGreaterThanOrEqual(subscribes);
  });
});

describe('and the window keeps hold of what it was handed', () => {
  /* The three shapes an effect uses: handing the unsubscriber straight back,
     being the arrow's whole body, or keeping it in a name the cleanup calls.
     A call in none of those drops it on the floor and the listener outlives
     the effect. */
  const subscriptions = all(app, /(?:return|=>|=)\s*bridge\.(on[A-Z]\w*)\(/g);
  const every = all(app, /bridge\.(on[A-Z]\w*)\(/g);

  it('subscribes through the bridge in more than one place', () => {
    expect(every.length).toBeGreaterThan(5);
  });

  it('never subscribes without keeping the stop', () => {
    expect(new Set(subscriptions)).toEqual(new Set(every));
    expect(subscriptions).toHaveLength(every.length);
  });
});
