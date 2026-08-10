import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { stepSpring, type Springing } from '../diff/spring';
import { usePrefersReducedMotion } from '../lib/motion';
import type { ChangedArea, VisualFrames } from '../lib/ipc';
import './VisualDiff.css';

/**
 * The before and after of the page itself — BACKLOG F2, and the promise the
 * README has been making since the first commit: *"You see what changed, as a
 * picture. A before and after of the page itself, plus a sentence describing
 * what moved. Not a wall of code."*
 *
 * ## Shut, until it is wanted
 *
 * It arrives as a strip: two pictures the size of a postage stamp, the sentence,
 * and a word to open it. A full comparison on every turn would be the same
 * mistake as a confirmation on every change — the fiftieth one is scrolled past
 * without being read, and by then so is the one that mattered. The strip is
 * glanceable in the flow of the conversation and gets out of the way; opening it
 * is a decision somebody makes about one particular change.
 *
 * ## Three ways to look, because they answer different questions
 *
 * - **Wipe** — "what is different *here*". One picture over the other with a
 *   handle you drag. It is the only way to see a 4px move, because your eye is
 *   comparing the same square inch of screen against itself rather than two
 *   squares an inch apart.
 * - **Side by side** — "what does it look like now, and did I prefer it
 *   before". The composition question, which a wipe is bad at.
 * - **Just what changed** — the rest of the page dimmed, the changed parts
 *   bright. For the case the whole feature exists for: not having to hunt.
 *
 * ## The motion, and why the handle is the only spring in it
 *
 * notes/strategy/UI-DESIGN.md, "Opening the visual diff": *"Before/after slide
 * in together from an 8px offset, 200ms ease-out-quart, sharing timing. The wipe
 * handle between them uses a spring — it is draggable, and springs stay
 * interruptible mid-gesture."* Both halves of that are here and neither is
 * decorative. The entrance is one keyframe pair with identical timing, because
 * two things that arrive together are one object. The handle is a spring because
 * a duration owns the next 200ms and a gesture cannot be told to wait.
 */

export type VisualDiffProps = {
  /** One line, past tense: "Made the header sticky". */
  headline: string;
  /** Where it landed: "Two areas changed, near the top." */
  where?: string | null;
  /** What moved, as fractions of the picture. Empty is a real answer. */
  areas: readonly ChangedArea[];
  /** Small pictures, already in hand. Drawn immediately, at any size. */
  beforeThumb: string;
  afterThumb: string;
  /** The full pictures' own size, so the space is the right shape before they
   *  arrive and nothing jumps when they do. */
  width: number;
  height: number;
  /** Fetch the full-size pair. Called once, the first time somebody opens this.
   *  Null back is not an error — the strip simply keeps the small pictures. */
  onOpen?: () => Promise<VisualFrames | null>;
  /** Open on first render. Only ever used for review and screenshots. */
  openAtFirst?: boolean;
};

type Way = 'wipe' | 'side' | 'changes';

const WAYS: readonly { way: Way; label: string }[] = [
  { way: 'wipe', label: 'Wipe across' },
  { way: 'side', label: 'Side by side' },
  { way: 'changes', label: 'Just what changed' },
];

const BEFORE = 'Your page before';
const AFTER = 'Your page after';

/** Where the handle sits when it opens. Slightly left of centre, so the newer
 *  picture — the one somebody is actually asking about — has the larger half. */
const RESTING = 0.42;

function percent(fraction: number): string {
  return `${(Math.min(1, Math.max(0, fraction)) * 100).toFixed(3)}%`;
}

/* -------------------------------------------------------------------------- */
/* The handle                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A position between 0 and 1 that chases wherever it is pointed.
 *
 * The pointer sets the target on every move and the spring is what actually
 * gets drawn, which is the whole reason it is a spring: let go halfway, nudge it
 * with an arrow key, grab it again mid-flight, and it bends out of what it was
 * doing instead of finishing it first. `src/diff/spring.ts` holds the
 * arithmetic; this holds the frames.
 */
function useChasing(start: number, still: boolean): [number, (to: number) => void] {
  const [drawn, setDrawn] = useState(start);
  const state = useRef<Springing>({ position: start, velocity: 0 });
  const target = useRef(start);
  const frame = useRef<number | null>(null);
  const last = useRef(0);

  const stop = useCallback(() => {
    if (frame.current !== null) cancelAnimationFrame(frame.current);
    frame.current = null;
  }, []);

  useEffect(() => stop, [stop]);

  const point = useCallback(
    (to: number) => {
      const wanted = Math.min(1, Math.max(0, to));
      target.current = wanted;

      // Asked for less movement: it is simply where it was put. Nothing here
      // carries meaning that the movement was adding.
      if (still) {
        stop();
        state.current = { position: wanted, velocity: 0 };
        setDrawn(wanted);
        return;
      }

      if (frame.current !== null) return;
      last.current = performance.now();
      const tick = (now: number) => {
        const elapsed = now - last.current;
        last.current = now;
        state.current = stepSpring(state.current, target.current, elapsed);
        setDrawn(state.current.position);
        if (state.current.position === target.current && state.current.velocity === 0) {
          frame.current = null;
          return;
        }
        frame.current = requestAnimationFrame(tick);
      };
      frame.current = requestAnimationFrame(tick);
    },
    [still, stop],
  );

  return [drawn, point];
}

/* -------------------------------------------------------------------------- */
/* The outlines                                                                */
/* -------------------------------------------------------------------------- */

/** A soft ring around each part of the page that is not the same any more.
 *  Soft on purpose: this is a guide for the eye, not an alarm. */
function Marks({ areas }: { areas: readonly ChangedArea[] }) {
  return (
    <div className="vdiff__marks" aria-hidden="true">
      {areas.map((area, index) => (
        <span
          key={`${String(area.x)}-${String(area.y)}-${String(index)}`}
          className="vdiff__mark"
          style={{
            left: percent(area.x),
            top: percent(area.y),
            width: percent(area.width),
            height: percent(area.height),
          }}
        />
      ))}
    </div>
  );
}

/**
 * The same rectangles again, but each one showing its own piece of the picture
 * at full strength over a dimmed copy of the rest.
 *
 * The arithmetic is the old sprite trick: blow the picture up so that the piece
 * we want is exactly the size of the box, then slide it so that piece is the one
 * showing. It costs no canvas, no second copy of the image and no dependency —
 * the browser is already holding the picture and this is the same picture
 * positioned differently.
 */
function Lifted({ picture, areas }: { picture: string; areas: readonly ChangedArea[] }) {
  return (
    <div className="vdiff__lifted" aria-hidden="true">
      {areas.map((area, index) => {
        const across = area.width >= 1 ? 0 : (area.x / (1 - area.width)) * 100;
        const down = area.height >= 1 ? 0 : (area.y / (1 - area.height)) * 100;
        return (
          <span
            key={`${String(area.x)}-${String(area.y)}-${String(index)}`}
            className="vdiff__lift"
            style={{
              left: percent(area.x),
              top: percent(area.y),
              width: percent(area.width),
              height: percent(area.height),
              backgroundImage: `url("${picture}")`,
              backgroundSize: `${(100 / Math.max(area.width, 0.001)).toFixed(3)}% ${(100 / Math.max(area.height, 0.001)).toFixed(3)}%`,
              backgroundPosition: `${across.toFixed(3)}% ${down.toFixed(3)}%`,
            }}
          />
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The whole thing                                                             */
/* -------------------------------------------------------------------------- */

export default function VisualDiff({
  headline,
  where,
  areas,
  beforeThumb,
  afterThumb,
  width,
  height,
  onOpen,
  openAtFirst = false,
}: VisualDiffProps) {
  const [open, setOpen] = useState(openAtFirst);
  const [way, setWay] = useState<Way>('wipe');
  const [full, setFull] = useState<VisualFrames | null>(null);
  const asked = useRef(false);
  const stage = useRef<HTMLDivElement | null>(null);
  const still = usePrefersReducedMotion();
  const [wipe, pointAt] = useChasing(RESTING, still);
  const name = useId();

  /* The full-size pair, fetched the first time it is opened and never again.
     Until it arrives the small pictures stand in — they are already on screen,
     they are the right shape, and a soft picture now beats a sharp one after a
     blank rectangle. */
  useEffect(() => {
    if (!open || asked.current || onOpen === undefined) return;
    asked.current = true;
    let stillHere = true;
    void onOpen().then((pair) => {
      if (stillHere && pair !== null) setFull(pair);
    });
    return () => {
      stillHere = false;
    };
  }, [open, onOpen]);

  const before = full?.before ?? beforeThumb;
  const after = full?.after ?? afterThumb;
  const shape = width > 0 && height > 0 ? `${String(width)} / ${String(height)}` : '4 / 3';

  /* ------------------------------------------------------------- the gesture */

  const dragging = useRef(false);

  const pointFromEvent = useCallback(
    (clientX: number) => {
      const box = stage.current?.getBoundingClientRect();
      if (box === undefined || box.width === 0) return;
      pointAt((clientX - box.left) / box.width);
    },
    [pointAt],
  );

  const grab = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      dragging.current = true;
      event.currentTarget.setPointerCapture(event.pointerId);
      pointFromEvent(event.clientX);
    },
    [pointFromEvent],
  );

  const move = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging.current) return;
      pointFromEvent(event.clientX);
    },
    [pointFromEvent],
  );

  const release = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  const onKey = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 0.1 : 0.02;
      const moves: Record<string, number> = {
        ArrowLeft: wipe - step,
        ArrowRight: wipe + step,
        Home: 0,
        End: 1,
      };
      const wanted = moves[event.key];
      if (wanted === undefined) return;
      event.preventDefault();
      pointAt(wanted);
    },
    [pointAt, wipe],
  );

  /* ---------------------------------------------------------------- drawing */

  const said = where === null || where === undefined ? headline : `${headline}. ${where}`;

  return (
    <section className={`vdiff ${open ? 'vdiff--open' : ''}`} aria-label={said}>
      <button
        type="button"
        className="vdiff__strip"
        onClick={() => setOpen((was) => !was)}
        aria-expanded={open}
        aria-controls={name}
      >
        <span className="vdiff__pips" aria-hidden="true">
          <img className="vdiff__pip" src={beforeThumb} alt="" />
          <img className="vdiff__pip" src={afterThumb} alt="" />
        </span>
        <span className="vdiff__said">
          <span className="vdiff__headline">{headline}</span>
          {where === null || where === undefined ? null : (
            <span className="vdiff__where">{where}</span>
          )}
        </span>
        <span className="vdiff__more">{open ? 'Hide' : 'Look'}</span>
      </button>

      {open ? (
        <div className="vdiff__body" id={name}>
          <div className="vdiff__ways" role="group" aria-label="How to compare them">
            {WAYS.map((one) => (
              <button
                key={one.way}
                type="button"
                className={`vdiff__way ${way === one.way ? 'vdiff__way--on' : ''}`}
                onClick={() => setWay(one.way)}
                aria-pressed={way === one.way}
              >
                {one.label}
              </button>
            ))}
          </div>

          {way === 'side' ? (
            <div className="vdiff__pair" style={{ ['--shape' as string]: shape }}>
              <figure className="vdiff__half vdiff__half--before">
                <img className="vdiff__picture" src={before} alt={BEFORE} />
                <figcaption className="vdiff__caption">Before</figcaption>
              </figure>
              <figure className="vdiff__half vdiff__half--after">
                <img className="vdiff__picture" src={after} alt={AFTER} />
                <Marks areas={areas} />
                <figcaption className="vdiff__caption">After</figcaption>
              </figure>
            </div>
          ) : null}

          {way === 'changes' ? (
            <div className="vdiff__only" style={{ ['--shape' as string]: shape }}>
              <img className="vdiff__picture" src={after} alt={AFTER} />
              {/* Pushed back by a wash of the app's own background rather than
                  by turning the picture's opacity down: the entrance animation
                  owns opacity on that element, and a value it sets on its last
                  frame quietly wins over anything a class asks for. */}
              <span className="vdiff__hush" aria-hidden="true" />
              <Lifted picture={after} areas={areas} />
              <Marks areas={areas} />
            </div>
          ) : null}

          {way === 'wipe' ? (
            <div
              className="vdiff__wipe"
              ref={stage}
              style={{ ['--shape' as string]: shape, ['--wipe' as string]: percent(wipe) }}
              onPointerDown={grab}
              onPointerMove={move}
              onPointerUp={release}
              onPointerCancel={release}
            >
              <img className="vdiff__picture vdiff__picture--after" src={after} alt={AFTER} />
              <div className="vdiff__reveal">
                <img className="vdiff__picture" src={before} alt={BEFORE} />
              </div>
              {/* Over both halves, not only the newer one. An outline marks a
                  place on the page that is not the same in the two pictures,
                  and that place is worth finding whichever half of it the
                  handle happens to be showing — hiding the outline around the
                  button until you have already dragged past it is the hunt this
                  whole thing exists to end. */}
              <Marks areas={areas} />

              <div
                className="vdiff__handle"
                role="slider"
                tabIndex={0}
                aria-label="How much of the earlier version to show"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(wipe * 100)}
                aria-valuetext={`${String(Math.round(wipe * 100))} out of 100`}
                onKeyDown={onKey}
              >
                <span className="vdiff__grip" aria-hidden="true" />
              </div>

              <span className="vdiff__tag vdiff__tag--before" aria-hidden="true">
                Before
              </span>
              <span className="vdiff__tag vdiff__tag--after" aria-hidden="true">
                After
              </span>
            </div>
          ) : null}

          {where === null || where === undefined ? null : (
            <p className="vdiff__note">{where}</p>
          )}
        </div>
      ) : null}
    </section>
  );
}
