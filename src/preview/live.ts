/** Who is watching a browser, and whether anybody is.
 *
 * The shell takes a picture of the agent's browser every second or so and sends
 * it to the window, which is a real cost on somebody's battery: an offscreen
 * browser composited and JPEG-encoded once a second, a base64 picture across the
 * wire, a render in a window nobody is looking at. Three things end it, and this
 * is where all of them are decided.
 *
 * Nobody is watching: the pane closes, or somebody switches project, and the
 * last listener for that project goes. A second look at the same browser shares
 * the one stream rather than asking the shell for a second one.
 *
 * Nobody can see it: the window is minimised, or another window is in front.
 * Chromium says so through `visibilityState` (see `lib/onscreen.ts`), and until
 * it changes back a picture is neither taken nor drawn — the next one arrives
 * within a second of the window coming back.
 *
 * It is not the preview being shown: a picture that arrives after the window has
 * moved on describes something else, whichever workspace it started in. Every
 * picture names its preview and the epoch it was taken in (see `PreviewFrame`),
 * and only the pictures of the preview this pane is showing are drawn.
 */

import type { PreviewFrame } from '../lib/ipc';

/** One picture of a preview, as the shell sends it. */
export type Frame = PreviewFrame;
export type FrameSink = (frame: Frame) => void;

/** What a project's pictures are of, as the window last saw it. */
type Showing = { preview: string; epoch: number };

export type LiveFrames = {
  /** Look at one project's browser. Repeat calls share the one stream. */
  subscribe(project: string, sink: FrameSink): () => void;
  /** One picture from the shell, to whoever asked for that project — and only
   *  while it is a picture of the preview they are showing. */
  deliver(frame: Frame): void;
  /** Whether anybody can see the window. */
  hidden(hidden: boolean): void;
  /** The projects being watched right now. */
  watching(): readonly string[];
  /** Whether the shell is being asked for pictures at all. */
  running(): boolean;
};

/**
 * Whether this picture is of the preview the window is showing.
 *
 * The first picture of a looking says which preview it is of, because that is
 * how the window learns what the shell gave it. After that the answer is fixed:
 * a picture from another preview — another workspace's browser, one that has
 * been started over — or from an earlier epoch of this one is a view of
 * something else and is dropped, rather than drawn as the picture now. A picture
 * with no identity at all is dropped too: there is nothing to match it against,
 * and guessing is how the wrong folder ends up on screen.
 *
 * The window forgets what a project was showing when the last thing looking at
 * it stops, so opening a pane again adopts whatever the shell sends then.
 */
function ofWhatIsShown(frame: Frame, showing: Map<string, Showing>): boolean {
  if (typeof frame.preview !== 'string' || frame.preview === '') return false;
  if (!Number.isInteger(frame.epoch) || frame.epoch < 0) return false;
  const was = showing.get(frame.project);
  if (was === undefined) {
    showing.set(frame.project, { preview: frame.preview, epoch: frame.epoch });
    return true;
  }
  if (was.preview !== frame.preview || frame.epoch < was.epoch) return false;
  was.epoch = frame.epoch;
  return true;
}

export function liveFrames(options: {
  /** Ask the shell to start or stop taking pictures of one project. */
  watch: (project: string, on: boolean) => void;
}): LiveFrames {
  const looking = new Map<string, Set<FrameSink>>();
  const showing = new Map<string, Showing>();
  let outOfSight = false;

  return {
    subscribe(project, sink) {
      const held = looking.get(project);
      if (held === undefined) {
        looking.set(project, new Set([sink]));
        // A project nobody is looking at yet is the only thing worth asking
        // for, and only while there is somewhere to draw it.
        if (!outOfSight) options.watch(project, true);
      } else {
        held.add(sink);
      }
      let done = false;
      return () => {
        if (done) return;
        done = true;
        const live = looking.get(project);
        if (live === undefined) return;
        live.delete(sink);
        if (live.size === 0) {
          looking.delete(project);
          // Nobody is looking at this one any more, so what it was showing is
          // not something to hold against the next pane that opens on it.
          showing.delete(project);
          options.watch(project, false);
        }
      };
    },

    deliver(frame) {
      if (outOfSight) return;
      const sinks = looking.get(frame.project);
      if (sinks === undefined || sinks.size === 0) return;
      if (!ofWhatIsShown(frame, showing)) return;
      for (const sink of sinks) sink(frame);
    },

    hidden(hid) {
      if (hid === outOfSight) return;
      outOfSight = hid;
      for (const project of looking.keys()) options.watch(project, !outOfSight);
    },

    watching: () => [...looking.keys()],
    running: () => !outOfSight && looking.size > 0,
  };
}
