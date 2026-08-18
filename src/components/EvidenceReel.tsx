import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  headlineFor,
  readsWell,
  sinceStart,
  walkthrough,
  type Frame,
  type Recording,
} from '../diff/flow';
import { usePrefersReducedMotion } from '../lib/motion';
import './EvidenceReel.css';

/**
 * What the page did, state by state.
 *
 * The same shape as the before-and-after strip, on purpose: a row in the
 * conversation that says one true sentence and stays shut until somebody wants
 * it. What it holds is different — not two pictures of a page at rest, but every
 * state somebody passed through and the sentence that says how they got there.
 *
 * Two ways to look, because they answer different questions. One at a time is
 * "what did that press do", and it is how somebody follows a fault. All of them
 * is "where does this go wrong", and it is the one that scales: a wall of
 * captioned states can be read at a glance, and read for five of these side by
 * side, which is more than anybody can say for five sets of diffs.
 */

export type EvidenceReelProps = {
  recording: Recording;
  /** The full-size frames, fetched the first time somebody opens this. Null
   *  back is not an error — the small ones stay. */
  onOpen?: () => Promise<readonly Frame[] | null>;
  /** Open on first render. Only ever used for review and screenshots. */
  openAtFirst?: boolean;
  /** The frames' own size, so the space is the right shape before they arrive. */
  width?: number;
  height?: number;
};

type Way = 'stepping' | 'all';

const WAYS: readonly { way: Way; label: string }[] = [
  { way: 'stepping', label: walkthrough.stepping },
  { way: 'all', label: walkthrough.all },
];

/** Three along the strip: where it started, somewhere in the middle, where it
 *  ended up. Enough to say "this is a run of states" before a word is read. */
function pipsOf(frames: readonly Frame[]): readonly Frame[] {
  const withPictures = frames.filter((frame) => frame.shot !== null);
  if (withPictures.length <= 3) return withPictures;
  const last = withPictures.length - 1;
  return [0, Math.round(last / 2), last]
    .map((at) => withPictures[at])
    .filter((frame): frame is Frame => frame !== undefined);
}

/** The picture, or an honest empty rectangle in its place. */
function Picture({ frame, small }: { frame: Frame; small?: boolean }) {
  if (frame.shot === null) {
    return (
      <div className={`reel__gap ${small === true ? 'reel__gap--small' : ''}`}>
        <span className="reel__badge">{walkthrough.missing}</span>
        {small === true ? null : <span className="reel__why">{frame.missing}</span>}
      </div>
    );
  }
  return <img className="reel__picture" src={frame.shot} alt={frame.says} />;
}

export default function EvidenceReel({
  recording,
  onOpen,
  openAtFirst = false,
  width = 900,
  height = 600,
}: EvidenceReelProps) {
  const [open, setOpen] = useState(openAtFirst);
  const [way, setWay] = useState<Way>('stepping');
  const [full, setFull] = useState<readonly Frame[] | null>(null);
  const [at, setAt] = useState(0);
  const asked = useRef(false);
  const still = usePrefersReducedMotion();
  const name = useId();

  /* The full-size frames, fetched once. Until they arrive the small ones stand
     in: they are already on screen and the right shape. */
  useEffect(() => {
    if (!open || asked.current || onOpen === undefined) return;
    asked.current = true;
    let stillHere = true;
    void onOpen().then((frames) => {
      if (stillHere && frames !== null) setFull(frames);
    });
    return () => {
      stillHere = false;
    };
  }, [open, onOpen]);

  const frames = full ?? recording.frames;
  const said = useMemo(() => readsWell(recording), [recording]);
  const headline = headlineFor(recording);
  const pips = useMemo(() => pipsOf(recording.frames), [recording.frames]);
  const shape = width > 0 && height > 0 ? `${String(width)} / ${String(height)}` : '3 / 2';
  const showing = frames[Math.min(at, Math.max(0, frames.length - 1))] ?? null;

  const step = useCallback(
    (by: number) => {
      setAt((was) => Math.min(frames.length - 1, Math.max(0, was + by)));
    },
    [frames.length],
  );

  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1 };
      const by = moves[event.key];
      if (by === undefined) return;
      event.preventDefault();
      step(by);
    },
    [step],
  );

  return (
    <section
      className={`reel ${open ? 'reel--open' : ''}`}
      aria-label={`${headline}. ${said.says}`}
    >
      <button
        type="button"
        className="reel__strip"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={name}
      >
        <span className="reel__pips" aria-hidden="true">
          {pips.map((frame) => (
            <img key={frame.id} className="reel__pip" src={frame.shot ?? ''} alt="" />
          ))}
        </span>
        <span className="reel__said">
          <span className="reel__headline">{headline}</span>
          <span className={`reel__where ${said.ok ? '' : 'reel__where--short'}`}>{said.says}</span>
        </span>
        <span className="reel__more">{open ? 'Hide' : 'Look'}</span>
      </button>

      {open ? (
        <div className="reel__body" id={name}>
          <div className="reel__ways" role="group" aria-label="How to look through it">
            {WAYS.map((one) => (
              <button
                key={one.way}
                type="button"
                className={`reel__way ${way === one.way ? 'reel__way--on' : ''}`}
                onClick={() => setWay(one.way)}
                aria-pressed={way === one.way}
              >
                {one.label}
              </button>
            ))}
          </div>

          {frames.length === 0 ? <p className="reel__note">{walkthrough.empty}</p> : null}

          {way === 'stepping' && showing !== null ? (
            <div className="reel__stepping" onKeyDown={onKey} role="group" aria-label={headline}>
              <div
                className={`reel__stage ${still ? 'reel__stage--still' : ''}`}
                style={{ ['--shape' as string]: shape }}
              >
                {/* Keyed on the frame so a changed picture is a new element, and
                    the entrance runs for each state rather than once. */}
                <div key={showing.id} className="reel__shown">
                  <Picture frame={showing} />
                </div>
              </div>

              <p className="reel__caption">
                <span className="reel__says">{showing.says}</span>
                <span className="reel__when">{sinceStart(showing.after)}</span>
              </p>

              <div className="reel__walk">
                <button
                  type="button"
                  className="reel__nudge"
                  onClick={() => step(-1)}
                  disabled={at <= 0}
                >
                  {walkthrough.earlier}
                </button>
                <span className="reel__count">
                  {String(Math.min(at, frames.length - 1) + 1)} of {String(frames.length)}
                </span>
                <button
                  type="button"
                  className="reel__nudge"
                  onClick={() => step(1)}
                  disabled={at >= frames.length - 1}
                >
                  {walkthrough.later}
                </button>
              </div>

              <div className="reel__film">
                {frames.map((frame, index) => (
                  <button
                    key={frame.id}
                    type="button"
                    className={`reel__cell ${index === at ? 'reel__cell--on' : ''}`}
                    onClick={() => setAt(index)}
                    aria-pressed={index === at}
                    title={frame.says}
                  >
                    <Picture frame={frame} small />
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {way === 'all' ? (
            <ol className="reel__sheet">
              {frames.map((frame) => (
                <li key={frame.id} className="reel__one">
                  <div className="reel__thumb" style={{ ['--shape' as string]: shape }}>
                    <Picture frame={frame} />
                  </div>
                  <p className="reel__label">
                    <span className="reel__says">{frame.says}</span>
                    <span className="reel__when">{sinceStart(frame.after)}</span>
                  </p>
                </li>
              ))}
            </ol>
          ) : null}

          {recording.note === null ? null : <p className="reel__note">{recording.note}</p>}
        </div>
      ) : null}
    </section>
  );
}
