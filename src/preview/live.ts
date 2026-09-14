/** Who is watching a browser, and whether anybody is.
 *
 * The shell takes a picture of the agent's browser every second or so and sends
 * it to the window, which is a real cost on somebody's battery: an offscreen
 * browser composited and JPEG-encoded once a second, a base64 picture across the
 * wire, a render in a window nobody is looking at. Two things end it, and this
 * is where both are decided.
 *
 * Nobody is watching: the pane closes, or somebody switches project, and the
 * last listener for that project goes. A second look at the same browser shares
 * the one stream rather than asking the shell for a second one.
 *
 * Nobody can see it: the window is minimised, or another window is in front.
 * Chromium says so through `visibilityState` (see `lib/onscreen.ts`), and until
 * it changes back a picture is neither taken nor drawn — the next one arrives
 * within a second of the window coming back.
 */

/** The shell's own words for one of its own workspaces. */
export type Frame = { project: string; bytes: string };
export type FrameSink = (frame: Frame) => void;

export type LiveFrames = {
  /** Look at one project's browser. Repeat calls share the one stream. */
  subscribe(project: string, sink: FrameSink): () => void;
  /** One picture from the shell, to whoever asked for that project. */
  deliver(frame: Frame): void;
  /** Whether anybody can see the window. */
  hidden(hidden: boolean): void;
  /** The projects being watched right now. */
  watching(): readonly string[];
  /** Whether the shell is being asked for pictures at all. */
  running(): boolean;
};

export function liveFrames(options: {
  /** Ask the shell to start or stop taking pictures of one project. */
  watch: (project: string, on: boolean) => void;
}): LiveFrames {
  const looking = new Map<string, Set<FrameSink>>();
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
          options.watch(project, false);
        }
      };
    },

    deliver(frame) {
      if (outOfSight) return;
      for (const sink of looking.get(frame.project) ?? []) sink(frame);
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
