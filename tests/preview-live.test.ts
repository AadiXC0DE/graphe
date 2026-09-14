/** Nobody pays for a picture nobody can see.
 *
 * The shell takes a picture of the agent's browser on a loop and sends it to
 * the window. That loop is expensive — an offscreen browser composited,
 * encoded, sent and drawn — so it must follow the people: it starts when
 * somebody opens the pane, ends when they close it, is shared when two things
 * look at the same browser, and stops entirely while the window is out of
 * sight. The shell is a stub here, so what is asserted is exactly what the
 * window asks of it.
 */

import { describe, expect, it } from 'vitest';

import { liveFrames, type Frame } from '../src/preview/live';

/** Every ask the shell would have heard, in order. */
function asking(): { asked: [string, boolean][]; watch: (project: string, on: boolean) => void } {
  const asked: [string, boolean][] = [];
  return { asked, watch: (project, on) => asked.push([project, on]) };
}

const picture = (project: string): Frame => ({ project, bytes: 'bytes' });

describe('looking at a browser', () => {
  it('asks the shell once, however many things are looking', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });

    const first: Frame[] = [];
    const second: Frame[] = [];
    const stopFirst = live.subscribe('/projects/one', (frame) => first.push(frame));
    const stopSecond = live.subscribe('/projects/one', (frame) => second.push(frame));

    expect(shell.asked).toEqual([['/projects/one', true]]);
    expect(live.watching()).toEqual(['/projects/one']);

    live.deliver(picture('/projects/one'));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);

    // One of the two looks away; the other is still watching, so nothing stops.
    stopFirst();
    expect(shell.asked).toHaveLength(1);
    live.deliver(picture('/projects/one'));
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(2);

    // The last one goes, and the shell is told to stop.
    stopSecond();
    expect(shell.asked).toEqual([
      ['/projects/one', true],
      ['/projects/one', false],
    ]);
    expect(live.watching()).toEqual([]);
    expect(live.running()).toBe(false);
  });

  it('watches each project separately', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    const here: Frame[] = [];
    const there: Frame[] = [];
    live.subscribe('/projects/one', (frame) => here.push(frame));
    live.subscribe('/projects/two', (frame) => there.push(frame));

    live.deliver(picture('/projects/two'));
    expect(there).toHaveLength(1);
    // A picture of one project is never drawn under another's name.
    expect(here).toHaveLength(0);

    live.deliver(picture('/projects/three'));
    expect(there).toHaveLength(1);
  });

  it('says nothing to the shell about a project nobody asked for', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    live.deliver(picture('/projects/nobody'));
    expect(shell.asked).toEqual([]);
    expect(live.running()).toBe(false);
  });

  it('forgets a listener that leaves twice', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    const stop = live.subscribe('/projects/one', () => undefined);
    stop();
    stop();
    expect(shell.asked).toEqual([
      ['/projects/one', true],
      ['/projects/one', false],
    ]);
  });
});

describe('when the window cannot be seen', () => {
  it('stops the shell taking pictures, and starts it again on the way back', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    const seen: Frame[] = [];
    live.subscribe('/projects/one', (frame) => seen.push(frame));

    live.hidden(true);
    expect(shell.asked).toEqual([
      ['/projects/one', true],
      ['/projects/one', false],
    ]);
    expect(live.running()).toBe(false);

    // A picture taken a moment before the window went away is nobody's.
    live.deliver(picture('/projects/one'));
    expect(seen).toHaveLength(0);

    // Still nobody's while it is away, however many arrive.
    live.hidden(true);
    expect(shell.asked).toHaveLength(2);

    live.hidden(false);
    expect(shell.asked).toEqual([
      ['/projects/one', true],
      ['/projects/one', false],
      ['/projects/one', true],
    ]);
    expect(live.running()).toBe(true);
    live.deliver(picture('/projects/one'));
    expect(seen).toHaveLength(1);
  });

  it('does not start a stream for a pane opened while it is away', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    live.hidden(true);

    const seen: Frame[] = [];
    live.subscribe('/projects/one', (frame) => seen.push(frame));
    expect(shell.asked).toEqual([]);
    expect(live.running()).toBe(false);

    // The window comes back and the pane that was opened behind it fills in.
    live.hidden(false);
    expect(shell.asked).toEqual([['/projects/one', true]]);
    live.deliver(picture('/projects/one'));
    expect(seen).toHaveLength(1);
  });

  it('stops the project that was being watched, and only that one', () => {
    const shell = asking();
    const live = liveFrames({ watch: shell.watch });
    live.subscribe('/projects/one', () => undefined);
    live.subscribe('/projects/two', () => undefined);
    live.hidden(true);
    live.hidden(true);
    expect(shell.asked).toEqual([
      ['/projects/one', true],
      ['/projects/two', true],
      ['/projects/one', false],
      ['/projects/two', false],
    ]);
  });
});
