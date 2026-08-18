/** One picture per state, in the order they happened.
 *
 * The camera is handed in rather than reached for, so the part that decides
 * *what gets a frame and what it is called* can be run without a browser. What
 * the page decides is worth reporting lives in `watching.ts`; this only turns a
 * stream of those into a recording somebody can look through.
 */

import {
  frameOf,
  saysItStopped,
  type Doing,
  type Frame,
  type Recording,
} from './flow';

/** Whatever can hand back a picture of what is on screen now. Null rather than
 *  a throw for every kind of failure, the same as everywhere else pictures are
 *  taken — except that here the failure is kept and shown. */
export type Camera = {
  snap: () => Promise<string | null>;
};

/** More than a person will sit through, and past the point where a recording is
 *  evidence rather than a session. */
export const MOST = 40;
/** The same thing again inside this is the same thing, not a second state. */
export const APART = 400;

export type RecordOptions = {
  camera: Camera;
  id?: string;
  /** What is being tried, in the person's own words. */
  says?: string;
  /** Now. Handed in so a run can be tested without waiting for one. */
  clock?: () => number;
  most?: number;
  apart?: number;
};

export type Recorder = {
  /** Something happened on the page. */
  saw: (doing: Doing) => void;
  /** Stop, wait for the pictures still in flight, and hand back the run. */
  finish: () => Promise<Recording>;
  /** False once it has stopped, either because it was asked to or because it
   *  ran into its own ceiling. */
  readonly running: boolean;
};

/** Things that fire in bursts while nothing is really changing. Two of these in
 *  a row, close together and on the same thing, are one state. */
const REPEATS: ReadonlySet<string> = new Set(['hovered', 'scrolled', 'typed', 'changed']);

function sameThing(one: Doing, other: Doing): boolean {
  return one.did === other.did && (one.what ?? '') === (other.what ?? '');
}

export function record(options: RecordOptions): Recorder {
  const clock = options.clock ?? Date.now;
  const camera = options.camera;
  const most = Math.max(1, options.most ?? MOST);
  const apart = Math.max(0, options.apart ?? APART);
  const startedAt = clock();
  const id = options.id ?? `run-${String(startedAt)}`;

  const frames: Frame[] = [];
  let queue: Promise<void> = Promise.resolve();
  let taken = 0;
  let running = true;
  let note: string | null = null;
  let last: Doing | null = null;
  /** Time never runs backwards in a recording, whatever order the page reports
   *  things in. */
  let furthest = 0;

  function whenItHappened(doing: Doing): number {
    const at = Number.isFinite(doing.at) ? doing.at - startedAt : clock() - startedAt;
    furthest = Math.max(furthest, Math.max(0, at));
    return furthest;
  }

  function saw(doing: Doing): void {
    if (!running) return;

    if (
      last !== null &&
      REPEATS.has(doing.did) &&
      sameThing(last, doing) &&
      Math.abs(doing.at - last.at) <= apart
    ) {
      return;
    }
    last = doing;

    if (taken >= most) {
      running = false;
      note = saysItStopped(most);
      return;
    }

    taken += 1;
    const after = whenItHappened(doing);
    const number = taken;

    // Chained rather than raced: two pictures at once are two pictures of
    // whichever state the page reached first, and the order they come back in
    // is the order somebody reads them.
    queue = queue.then(async () => {
      let shot: string | null = null;
      let missing: string | null = null;
      try {
        shot = await camera.snap();
      } catch {
        shot = null;
      }
      if (shot === null) missing = 'The page couldn’t be photographed in this state.';
      frames.push(frameOf({ id: `${id}-${String(number)}`, doing, after, shot, missing }));
    });
  }

  async function finish(): Promise<Recording> {
    running = false;
    await queue;
    return { id, says: options.says ?? '', startedAt, frames: [...frames], note };
  }

  return {
    saw,
    finish,
    get running() {
      return running;
    },
  };
}
