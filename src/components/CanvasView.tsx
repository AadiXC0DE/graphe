import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  BLOCKS,
  CARD,
  canvasWords,
  canWaitFor,
  change,
  isArranged,
  isRunning,
  join,
  layOut,
  LOOPS,
  MOST_PICTURES,
  notReady,
  place,
  placeLoop,
  remove,
  ROUNDS,
  RUNGS,
  specOf,
  tidied,
  waitingOn,
  type Block,
  type BlockKind,
  type BlockPicture,
  type Flow,
  type Placed,
} from '../work/canvas';
import type { ConnectionState } from '../lib/ipc';
import { byTier, tierNames } from '../lib/modeltiers';
import './CanvasView.css';

const ZOOM = { least: 0.4, most: 1.6, step: 0.15 } as const;
/** How far out Fit is willing to go. Past this the words on a card stop being
 *  words, and a picture of six unreadable boxes is worth less than four
 *  readable ones with the rest a pan away. */
const READABLE = 0.75;
/** Further than this and the hand meant to move something, not to press it. */
const MOVED = 4;

type Props = {
  flow: Flow;
  /** The shape changed. Nothing runs; the shell keeps it. */
  onFlow: (flow: Flow) => void;
  onStart: () => void;
  onStop: () => void;
  /** Open the gate the flow is stopped at. */
  onCarryOn: () => void;
  /** Who could run a block, or null while the first answer is on its way. */
  connection: ConnectionState | null;
  /** Covering the whole window rather than sitting in its own column. */
  full: boolean;
  onFull: (full: boolean) => void;
};

/** Where a line leaves one card and where it arrives at the next. */
function leaves(block: { x: number; y: number }) {
  return { x: block.x + CARD.width, y: block.y + CARD.height / 2 };
}
function arrives(block: { x: number; y: number }) {
  return { x: block.x - 9, y: block.y + CARD.height / 2 };
}

/**
 * One line between two cards.
 *
 * Out of the right of one and into the left of the next, however they are
 * arranged. The bend grows with the gap so a long run is a gentle curve and a
 * short one is nearly straight; a card dragged behind the one it follows gets a
 * loop rather than a line through its own middle.
 */
function line(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const across = to.x - from.x;
  const bend = across > 0 ? Math.max(30, across * 0.45) : Math.max(60, Math.abs(across) * 0.5 + 40);
  return `M ${String(from.x)} ${String(from.y)} C ${String(from.x + bend)} ${String(from.y)}, ${String(to.x - bend)} ${String(to.y)}, ${String(to.x)} ${String(to.y)}`;
}

/* -------------------------------------------------------------------- marks */

/** One mark per kind. A row of identical cards is a list; the mark is what
 *  makes a flow readable at a glance without reading a word of it. */
function Mark({ kind }: { kind: BlockKind }) {
  const line = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'plan':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" {...line} />
          <path d="M10.2 10.2 13.5 13.5" {...line} />
        </svg>
      );
    case 'research':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" {...line} />
          <path d="M2.4 8h11.2M8 2.25c1.5 1.7 2.3 3.6 2.3 5.75S9.5 12.05 8 13.75c-1.5-1.7-2.3-3.6-2.3-5.75S6.5 3.95 8 2.25Z" {...line} />
        </svg>
      );
    case 'goal':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" {...line} />
          <circle cx="8" cy="8" r="2.5" {...line} />
        </svg>
      );
    case 'wait':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" {...line} />
          <path d="M8 4.6V8l2.4 1.6" {...line} />
        </svg>
      );
    case 'subagents':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="4" cy="4.5" r="2" {...line} />
          <circle cx="12" cy="4.5" r="2" {...line} />
          <circle cx="8" cy="12" r="2" {...line} />
          <path d="M5.6 6.2 7 9.6M10.4 6.2 9 9.6" {...line} />
        </svg>
      );
    case 'browser':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <rect x="2" y="3" width="12" height="10" rx="2" {...line} />
          <path d="M2 6.2h12M4.4 4.6h.01M6.4 4.6h.01" {...line} />
        </svg>
      );
    case 'checks':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M2.5 5.2 4 6.7l2.5-2.6M2.5 11 4 12.5l2.5-2.6M8.6 5.4h5M8.6 11.2h5" {...line} />
        </svg>
      );
    case 'review':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M13.5 8.2c0 2.6-2.5 4.6-5.5 4.6a6.7 6.7 0 0 1-1.7-.2L3 13.8l.8-2.3A4.4 4.4 0 0 1 2.5 8.2c0-2.6 2.5-4.6 5.5-4.6s5.5 2 5.5 4.6Z" {...line} />
          <path d="M6 8.1 7.3 9.4 10 6.7" {...line} />
        </svg>
      );
    case 'pull-request':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="4.5" cy="3.6" r="1.8" {...line} />
          <circle cx="4.5" cy="12.4" r="1.8" {...line} />
          <circle cx="11.5" cy="12.4" r="1.8" {...line} />
          <path d="M4.5 5.4v5.2M11.5 10.6V8.4A2.6 2.6 0 0 0 8.9 5.8H6.6" {...line} />
          <path d="M8 4.3 6.5 5.8 8 7.3" {...line} />
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <path d="M9.8 2.9 13.1 6.2 5.6 13.7l-3.9.6.6-3.9z" {...line} />
          <path d="M8.2 4.5 11.5 7.8" {...line} />
        </svg>
      );
  }
}

/**
 * A flow: blocks you place, arrange, join up, and then start.
 *
 * Three bands, which is the shape of every tool that composes rather than
 * reports: what you can place, what you have placed, and what the one you are
 * looking at is set to. Nothing here runs anything on its own — a block is an
 * ordinary turn in this canvas's own conversation, and only once Start has
 * been pressed.
 */
export default function CanvasView({ flow, onFlow, onStart, onStop, onCarryOn, connection, full, onFull }: Props) {
  const surface = useRef<HTMLDivElement>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0, scale: 1 });
  const [joining, setJoining] = useState<{ from: string; x: number; y: number } | null>(null);
  /** A card under the hand, drawn where the hand is rather than where it was
   *  last saved: a block that only moves when you let go does not feel moved. */
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const panning = useRef<{ x: number; y: number; fromX: number; fromY: number } | null>(null);
  const held = useRef<{ id: string; x: number; y: number; fromX: number; fromY: number } | null>(null);
  const dragged = useRef(false);
  const touched = useRef(false);

  const laid = useMemo(() => layOut(flow), [flow]);
  const drawn: readonly Placed[] = useMemo(
    () => (moving === null ? laid.blocks : laid.blocks.map((one) => (one.id === moving.id ? { ...one, x: moving.x, y: moving.y } : one))),
    [laid.blocks, moving],
  );
  const going = isRunning(flow);
  const chosen = flow.blocks.find((one) => one.id === picked) ?? null;
  const missing = notReady(flow);
  const done = drawn.filter((one) => one.state === 'done').length;
  const busy = drawn.filter((one) => one.state === 'running').length;

  /* Escape peels one layer: the panel first, then the way it is filling the
     window. It never closes the canvas — that is the tab's own x. */
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (picked !== null) {
        event.stopPropagation();
        setPicked(null);
        return;
      }
      if (full) {
        event.stopPropagation();
        onFull(false);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [picked, full, onFull]);

  useEffect(() => {
    if (refused === null) return;
    const timer = setTimeout(() => setRefused(null), 3600);
    return () => clearTimeout(timer);
  }, [refused]);

  /** Where a point on the screen is on the sheet underneath it. */
  const onSheet = useCallback(
    (clientX: number, clientY: number) => {
      const box = surface.current?.getBoundingClientRect();
      if (box === undefined) return { x: 0, y: 0 };
      return { x: (clientX - box.left - at.x) / at.scale, y: (clientY - box.top - at.y) / at.scale };
    },
    [at.x, at.y, at.scale],
  );

  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined || laid.width === 0) return;
    const scale = Math.min(1, (box.width - 96) / laid.width, (box.height - 120) / laid.height);
    const kept = Math.max(READABLE, Math.min(ZOOM.most, scale));
    setAt({
      x: Math.max(40, (box.width - laid.width * kept) / 2),
      y: Math.max(40, (box.height - laid.height * kept) / 2),
      scale: kept,
    });
  }, [laid.width, laid.height]);

  /* Framed once there is something to frame, and theirs from then on. Tied to
     a flag rather than to `fit`'s identity: `fit` changes whenever the drawing
     grows, so dragging a card past the bottom edge re-centred the whole canvas
     under the hand that was moving it. */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || touched.current || laid.blocks.length === 0) return;
    framed.current = true;
    fit();
  }, [fit, laid.blocks.length]);

  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    // The bands either side open and close under it; a flow that never
    // re-framed would be stranded off the edge by a panel it did not ask for.
    const watch = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [fit]);

  const zoom = useCallback((by: number, about?: { x: number; y: number }) => {
    touched.current = true;
    setAt((was) => {
      const next = Math.max(ZOOM.least, Math.min(ZOOM.most, was.scale + by));
      if (next === was.scale) return was;
      const point = about ?? { x: 0, y: 0 };
      const ratio = next / was.scale;
      return { scale: next, x: point.x - (point.x - was.x) * ratio, y: point.y - (point.y - was.y) * ratio };
    });
  }, []);

  /* Natively, and not passively: pinching over a canvas means this canvas, and
     left alone the window itself zooms underneath it. */
  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    const wheeled = (event: WheelEvent) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const box = node.getBoundingClientRect();
        zoom(event.deltaY > 0 ? -ZOOM.step : ZOOM.step, { x: event.clientX - box.left, y: event.clientY - box.top });
        return;
      }
      touched.current = true;
      setAt((was) => ({ ...was, x: was.x - event.deltaX, y: was.y - event.deltaY }));
    };
    node.addEventListener('wheel', wheeled, { passive: false });
    return () => node.removeEventListener('wheel', wheeled);
  }, [zoom]);

  /* ------------------------------------------------------------- pointers */

  const startPan = useCallback(
    (event: Pressed) => {
      if (event.button !== 0) return;
      if ((event.target as Element).closest('button, input, textarea, select, a, .canvas__card') !== null) return;
      setPicked(null);
      touched.current = true;
      panning.current = { x: event.clientX, y: event.clientY, fromX: at.x, fromY: at.y };
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    [at.x, at.y],
  );

  const moved = useCallback(
    (event: Pressed) => {
      const box = surface.current?.getBoundingClientRect();

      if (joining !== null && box !== undefined) {
        dragged.current = true;
        setJoining({ ...joining, x: event.clientX - box.left, y: event.clientY - box.top });
        return;
      }

      const card = held.current;
      if (card !== null) {
        const far = Math.abs(event.clientX - card.x) + Math.abs(event.clientY - card.y);
        if (far > MOVED) {
          dragged.current = true;
          // Arranging is a decision about where things go, so the view stops
          // being the canvas's to re-frame.
          touched.current = true;
        }
        if (dragged.current) {
          setMoving({
            id: card.id,
            x: Math.round(card.fromX + (event.clientX - card.x) / at.scale),
            y: Math.round(card.fromY + (event.clientY - card.y) / at.scale),
          });
        }
        return;
      }

      const pan = panning.current;
      if (pan === null) return;
      setAt((was) => ({ ...was, x: pan.fromX + (event.clientX - pan.x), y: pan.fromY + (event.clientY - pan.y) }));
    },
    [joining, at.scale],
  );

  const letGo = useCallback(
    (event: Pressed) => {
      panning.current = null;

      // A card set down where it was left.
      const card = held.current;
      held.current = null;
      if (card !== null) {
        const spot = moving;
        setMoving(null);
        if (dragged.current && spot !== null) {
          onFlow(change(flow, card.id, { at: { x: spot.x, y: spot.y } }));
        } else {
          setPicked((was) => (was === card.id ? null : card.id));
        }
        return;
      }

      // A line let go: over a card it becomes a wait, anywhere else it is dropped.
      const from = joining?.from ?? null;
      setJoining(null);
      if (from === null) return;
      const over = document.elementFromPoint(event.clientX, event.clientY)?.closest('.canvas__card');
      const onto = over?.getAttribute('data-block') ?? null;
      if (onto === null || onto === from) return;
      const said = canWaitFor(flow, onto, from);
      if (!said.ok) {
        setRefused(said.because);
        return;
      }
      onFlow(join(flow, onto, from));
    },
    [joining, moving, flow, onFlow],
  );

  const lost = useCallback(() => {
    panning.current = null;
    held.current = null;
    setMoving(null);
    setJoining(null);
  }, []);

  /* --------------------------------------------------------------- adding */

  const add = useCallback(
    (kind: BlockKind) => {
      const next = place(flow, kind, picked);
      const made = next.blocks[next.blocks.length - 1];
      if (made === undefined) return;
      // Beside whatever it follows rather than on top of it, so a block added
      // to an arranged canvas lands somewhere it can be seen.
      const parent = picked === null ? null : (laid.blocks.find((one) => one.id === picked) ?? null);
      const spot =
        parent === null
          ? null
          : { x: parent.x + CARD.width + CARD.gapX, y: parent.y + waitingOn(flow, parent.id).length * (CARD.height + CARD.gapY) };
      onFlow(spot === null ? next : change(next, made.id, { at: spot }));
      setPicked(made.id);
    },
    [flow, laid.blocks, onFlow, picked],
  );

  const takeLoop = useCallback(
    (id: string) => {
      const loop = LOOPS.find((one) => one.id === id);
      if (loop === undefined) return;
      if (flow.blocks.length === 0) touched.current = false;
      onFlow(placeLoop(flow, loop));
    },
    [flow, onFlow],
  );

  return (
    <section className={`canvas ${full ? 'canvas--full' : ''}`} aria-label={flow.name}>
      <header className="canvas__bar">
        <input
          className="canvas__title"
          value={flow.name}
          aria-label={canvasWords.rename}
          onChange={(event) => onFlow({ ...flow, name: event.target.value })}
          onBlur={() => {
            if (flow.name.trim() === '') onFlow({ ...flow, name: canvasWords.named(flow.blocks) });
          }}
        />
        <span className="canvas__count">{canvasWords.counted(flow.blocks.length, done, busy)}</span>

        {isArranged(flow) ? (
          <button type="button" className="canvas__tidy" onClick={() => onFlow(tidied(flow))} title={canvasWords.tidyNote}>
            {canvasWords.tidyUp}
          </button>
        ) : null}

        <label className="canvas__far">
          <span className="canvas__farname">{canvasWords.howFar}</span>
          <select
            className="canvas__farpick"
            value={flow.howFar === 'doing' ? 'doing' : 'asking'}
            disabled={going}
            onChange={(event) => onFlow({ ...flow, howFar: event.target.value === 'doing' ? 'doing' : 'asking' })}
          >
            {RUNGS.map((rung) => (
              <option key={rung} value={rung}>
                {canvasWords.rungs[rung]}
              </option>
            ))}
          </select>
        </label>

        <div className="canvas__run">
          {going ? (
            <button type="button" className="canvas__stop" onClick={onStop}>
              {canvasWords.stop}
            </button>
          ) : (
            <button
              type="button"
              className="canvas__start"
              onClick={onStart}
              disabled={flow.blocks.length === 0 || missing.length > 0}
              title={missing.length > 0 ? canvasWords.saySomething : undefined}
            >
              {flow.startedAt === null ? canvasWords.start : canvasWords.again}
            </button>
          )}
          <button
            type="button"
            className="canvas__full"
            onClick={() => onFull(!full)}
            aria-pressed={full}
            title={full ? canvasWords.smaller : canvasWords.bigger}
            aria-label={full ? canvasWords.smaller : canvasWords.bigger}
          >
            {full ? (
              <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                <path d="M5.6 1.8v3.8H1.8M8.4 12.2V8.4h3.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            ) : (
              <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                <path d="M1.8 5.2V1.8h3.4M12.2 8.8v3.4H8.8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            )}
          </button>
        </div>
      </header>

      <div className={`canvas__bands ${chosen === null ? '' : 'canvas__bands--open'}`}>
        <Palette
          onAdd={add}
          onLoop={takeLoop}
          folded={chosen !== null}
          {...(flow.blocks.length === 0 ? { quiet: true } : {})}
        />

        <div
          className="canvas__surface"
          ref={surface}
          onPointerDown={startPan}
          onPointerMove={moved}
          onPointerUp={letGo}
          onPointerCancel={lost}
          onLostPointerCapture={lost}
          style={{
            '--canvas-x': `${String(at.x)}px`,
            '--canvas-y': `${String(at.y)}px`,
            '--canvas-dot': `${String(Math.round(20 * at.scale))}px`,
          } as CSSProperties}
        >
          {laid.blocks.length === 0 ? (
            <Nothing onLoop={takeLoop} />
          ) : (
            <div
              className="canvas__sheet"
              style={{ transform: `translate(${String(at.x)}px, ${String(at.y)}px) scale(${String(at.scale)})` }}
            >
              <svg className="canvas__lines" aria-hidden="true" overflow="visible">
                <defs>
                  <marker id="canvas-tip" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M1.5 1.5 5.5 4 1.5 6.5" fill="none" stroke="context-stroke" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {drawn.map((block) => {
                  const parent = drawn.find((one) => one.id === block.after);
                  if (parent === undefined) return null;
                  const live = block.state === 'running';
                  return (
                    <path
                      key={`${parent.id}-${block.id}`}
                      className={`canvas__line ${live ? 'canvas__line--live' : ''}`}
                      d={line(leaves(parent), arrives(block))}
                      fill="none"
                      markerEnd="url(#canvas-tip)"
                    />
                  );
                })}
              </svg>

              {drawn.map((block) => (
                <Card
                  key={block.id}
                  block={block}
                  behind={waitingOn(flow, block.id).length}
                  rounds={flow.running === block.id ? flow.rounds : 0}
                  onCarryOn={onCarryOn}
                  picked={picked === block.id}
                  target={joining !== null && joining.from !== block.id}
                  held={moving?.id === block.id}
                  onTake={(event) => {
                    dragged.current = false;
                    held.current = { id: block.id, x: event.clientX, y: event.clientY, fromX: block.x, fromY: block.y };
                  }}
                  onJoinFrom={(event) => {
                    const spot = onSheet(event.clientX, event.clientY);
                    void spot;
                    const box = surface.current?.getBoundingClientRect();
                    if (box === undefined) return;
                    dragged.current = false;
                    setJoining({ from: block.id, x: event.clientX - box.left, y: event.clientY - box.top });
                  }}
                />
              ))}
            </div>
          )}

          {joining === null ? null : <Trailing from={joining} blocks={drawn} at={at} />}

          <div className="canvas__foot">
            {refused === null ? (
              <span className="canvas__hint">{laid.blocks.length === 0 ? '' : canvasWords.connect}</span>
            ) : (
              <span className="canvas__refused" role="status">{refused}</span>
            )}
            {laid.blocks.length === 0 ? null : (
              <div className="canvas__zoom">
                <button type="button" className="canvas__zoombtn" onClick={() => zoom(-ZOOM.step)} aria-label="Further out">−</button>
                <button
                  type="button"
                  className="canvas__fit"
                  onClick={() => {
                    touched.current = false;
                    fit();
                  }}
                >
                  Fit
                </button>
                <button type="button" className="canvas__zoombtn" onClick={() => zoom(ZOOM.step)} aria-label="Closer">+</button>
              </div>
            )}
          </div>
        </div>

        {chosen === null ? null : (
          <Inspector
            block={chosen}
            flow={flow}
            connection={connection}
            going={going}
            onChange={(over) => onFlow(change(flow, chosen.id, over))}
            onRemove={() => {
              onFlow(remove(flow, chosen.id));
              setPicked(null);
            }}
            onClose={() => setPicked(null)}
          />
        )}
      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- palette */

function Palette({
  folded,
  quiet,
  onAdd,
  onLoop,
}: {
  folded: boolean;
  /** The first screen is already offering the loops, whole and readable. Two
   *  lists of the same three is one too many. */
  quiet?: boolean;
  onAdd: (kind: BlockKind) => void;
  onLoop: (id: string) => void;
}) {
  return (
    <aside className={`canvas__palette ${folded ? 'canvas__palette--folded' : ''}`} aria-label={canvasWords.blocks}>
      <h2 className="canvas__band">{canvasWords.blocks}</h2>
      <ul className="canvas__list">
        {BLOCKS.map((spec) => (
          <li key={spec.kind}>
            <button type="button" className="canvas__pick" onClick={() => onAdd(spec.kind)} title={spec.note}>
              <span className="canvas__pickmark" aria-hidden="true">
                <Mark kind={spec.kind} />
              </span>
              <span className="canvas__picktext">
                <span className="canvas__pickname">{spec.name}</span>
                <span className="canvas__picknote">{spec.note}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      {folded || quiet === true ? null : <h2 className="canvas__band">{canvasWords.loops}</h2>}
      <ul className="canvas__list">
        {(folded || quiet === true ? [] : LOOPS).map((loop) => (
          <li key={loop.id}>
            <button type="button" className="canvas__pick canvas__pick--loop" onClick={() => onLoop(loop.id)} title={loop.note}>
              <span className="canvas__picktext">
                <span className="canvas__pickname">{loop.name}</span>
                <span className="canvas__shape" aria-hidden="true">
                  {loop.blocks.map((one, index) => (
                    <span key={`${one.kind}-${String(index)}`} className="canvas__shapemark">
                      <Mark kind={one.kind} />
                    </span>
                  ))}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}

/* ------------------------------------------------------------------- card */

function Card({
  block,
  behind,
  rounds,
  picked,
  target,
  held,
  onTake,
  onJoinFrom,
  onCarryOn,
}: {
  block: Placed;
  behind: number;
  rounds: number;
  picked: boolean;
  target: boolean;
  held: boolean;
  onTake: (event: Pressed) => void;
  onJoinFrom: (event: Pressed) => void;
  onCarryOn: () => void;
}) {
  const spec = specOf(block.kind);
  const says = block.says.trim();
  return (
    <div
      className={`canvas__card canvas__card--${block.state}${picked ? ' canvas__card--picked' : ''}${target ? ' canvas__card--target' : ''}${held ? ' canvas__card--held' : ''}`}
      data-block={block.id}
      style={{ left: block.x, top: block.y, width: CARD.width, height: CARD.height, '--canvas-card': `${String(CARD.height)}px` } as CSSProperties}
    >
      {block.state === 'running' ? <span className="canvas__sweep" aria-hidden="true" /> : null}

      <button
        type="button"
        className="canvas__face"
        aria-pressed={picked}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onTake(event);
        }}
      >
        <span className="canvas__head">
          <span className="canvas__mark" aria-hidden="true">
            <Mark kind={block.kind} />
          </span>
          <span className="canvas__kind">{spec.name}</span>
          <span className="canvas__state">{canvasWords.states[block.state]}</span>
        </span>
        <span className="canvas__says">
          {says === '' ? (spec.needsWords ? canvasWords.saySomething : spec.note) : says}
        </span>
        {block.state === 'needs-you' ? <span className="canvas__gate">{canvasWords.gateWaits}</span> : null}
        {block.state === 'running' && rounds > 1 ? (
          <span className="canvas__round">{canvasWords.round(rounds, ROUNDS)}</span>
        ) : null}
        {block.model === null && behind === 0 && (block.pictures ?? []).length === 0 ? null : (
          <span className="canvas__foots">
            {block.model === null ? null : <span className="canvas__model">{block.model.modelId}</span>}
            {(block.pictures ?? []).length === 0 ? null : (
              <span className="canvas__shots">{String((block.pictures ?? []).length)} shown</span>
            )}
            {behind === 0 ? null : <span className="canvas__behind">{String(behind)} after</span>}
          </span>
        )}
      </button>

      {block.state === 'needs-you' ? (
        <button type="button" className="canvas__carryon" onClick={onCarryOn}>
          {canvasWords.carryOn}
        </button>
      ) : null}

      <button
        type="button"
        className="canvas__handle"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onJoinFrom(event);
        }}
        aria-label={canvasWords.connect}
        title={canvasWords.connect}
      >
        <span className="canvas__dot" />
      </button>
    </div>
  );
}

/** The line while it is still in somebody's hand. */
function Trailing({
  from,
  blocks,
  at,
}: {
  from: { from: string; x: number; y: number };
  blocks: readonly Placed[];
  at: { x: number; y: number; scale: number };
}) {
  const parent = blocks.find((one) => one.id === from.from);
  if (parent === undefined) return null;
  const start = leaves(parent);
  return (
    <svg className="canvas__trailing" aria-hidden="true">
      <path
        d={line({ x: at.x + start.x * at.scale, y: at.y + start.y * at.scale }, { x: from.x, y: from.y })}
        fill="none"
      />
    </svg>
  );
}

/** A picture read the way the shell wants it: base64, no data: prefix. Anything
 *  that will not read is one picture missing rather than a thrown error. */
async function takePictures(files: readonly File[]): Promise<readonly BlockPicture[]> {
  const taken: BlockPicture[] = [];
  for (const file of files.slice(0, MOST_PICTURES)) {
    const bytes = await new Promise<string | null>((settle) => {
      const reader = new FileReader();
      reader.onload = () => {
        const read = typeof reader.result === 'string' ? reader.result : '';
        const comma = read.indexOf(',');
        settle(comma === -1 ? null : read.slice(comma + 1));
      };
      reader.onerror = () => settle(null);
      reader.readAsDataURL(file);
    });
    if (bytes === null || bytes === '') continue;
    taken.push({ name: file.name, mimeType: file.type || 'image/png', bytes });
  }
  return taken;
}

/* -------------------------------------------------------------- inspector */

function Inspector({
  block,
  flow,
  connection,
  going,
  onChange,
  onRemove,
  onClose,
}: {
  block: Block;
  flow: Flow;
  connection: ConnectionState | null;
  going: boolean;
  onChange: (over: Partial<Omit<Block, 'id'>>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const spec = specOf(block.kind);
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (spec.needsWords && block.says.trim() === '') box.current?.focus();
  }, [block.id, block.says, spec.needsWords]);

  const offers = useMemo(() => {
    const all: { providerId: string; providerName: string; modelId: string; label: string; rates: { input: number; output: number } | null }[] = [];
    for (const provider of connection?.providers ?? []) {
      if (!provider.connected) continue;
      for (const model of provider.models) {
        if (!model.available) continue;
        all.push({
          providerId: provider.providerId,
          providerName: provider.name,
          modelId: model.id,
          label: model.label,
          rates: model.rates,
        });
      }
    }
    return all;
  }, [connection]);

  /* Grouped and folded away. An account with four providers connected offers
     forty models, and forty rows in a panel is a list you scroll past rather
     than a choice you make. */
  const bands = useMemo(() => {
    const tiered = byTier(offers);
    if (tiered === null) return [{ name: canvasWords.everyModel, models: offers }];
    return tiered.map(([tier, models]) => ({ name: tierNames[tier].name, models }));
  }, [offers]);

  const waits = flow.blocks.find((one) => one.id === block.after) ?? null;
  const shown = block.pictures ?? [];

  return (
    <aside className="canvas__inspector" aria-label={spec.name}>
      <header className="canvas__ihead">
        <span className="canvas__imark" aria-hidden="true">
          <Mark kind={block.kind} />
        </span>
        <h2 className="canvas__iname">{spec.name}</h2>
        <button type="button" className="canvas__ishut" onClick={onClose} aria-label={canvasWords.shut}>
          <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M4.2 4.2l5.6 5.6M9.8 4.2l-5.6 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      <div className="canvas__ibody">
        <label className="canvas__ilabel" htmlFor="canvas-says">{canvasWords.what}</label>
        <textarea
          id="canvas-says"
          ref={box}
          className="canvas__isays"
          rows={6}
          value={block.says}
          disabled={going}
          placeholder={spec.needsWords ? 'Tighten the nav on mobile' : spec.says}
          onChange={(event) => onChange({ says: event.target.value })}
        />

        <label className="canvas__ilabel" htmlFor="canvas-model">{canvasWords.runBy}</label>
        <select
          id="canvas-model"
          className="canvas__ipick"
          disabled={going}
          value={block.model === null ? '' : `${block.model.providerId}/${block.model.modelId}`}
          onChange={(event) => {
            const [providerId, ...rest] = event.target.value.split('/');
            onChange({
              model: event.target.value === '' || providerId === undefined
                ? null
                : { providerId, modelId: rest.join('/') },
            });
          }}
        >
          <option value="">{canvasWords.whichever}</option>
          {bands.map((band) => (
            <optgroup key={band.name} label={band.name}>
              {band.models.map((one) => (
                <option key={`${one.providerId}/${one.modelId}`} value={`${one.providerId}/${one.modelId}`}>
                  {one.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>

        <label className="canvas__ilabel" htmlFor="canvas-far">{canvasWords.howFar}</label>
        <select
          id="canvas-far"
          className="canvas__ipick"
          disabled={going}
          value={block.howFar ?? ''}
          onChange={(event) =>
            onChange({ howFar: event.target.value === '' ? undefined : (event.target.value as 'asking' | 'doing') })
          }
        >
          <option value="">{canvasWords.sameAsFlow}</option>
          {RUNGS.map((rung) => (
            <option key={rung} value={rung}>
              {canvasWords.rungs[rung]}
            </option>
          ))}
        </select>

        <span className="canvas__ilabel">{canvasWords.shows}</span>
        <div className="canvas__ishots">
          {shown.map((picture, at) => (
            <span className="canvas__ishot" key={`${picture.name}-${String(at)}`}>
              <img src={`data:${picture.mimeType};base64,${picture.bytes}`} alt={picture.name} />
              <button
                type="button"
                className="canvas__ishotoff"
                disabled={going}
                aria-label={`Take ${picture.name} off this block`}
                onClick={() => onChange({ pictures: shown.filter((_, index) => index !== at) })}
              >
                <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                  <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                </svg>
              </button>
            </span>
          ))}
          {shown.length >= MOST_PICTURES ? null : (
            <label className={`canvas__iadd ${going ? 'canvas__iadd--off' : ''}`}>
              <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
              </svg>
              <input
                type="file"
                accept="image/*"
                multiple
                disabled={going}
                onChange={(event) => {
                  const files = [...(event.target.files ?? [])];
                  event.target.value = '';
                  void takePictures(files).then((taken) => {
                    if (taken.length === 0) return;
                    onChange({ pictures: [...shown, ...taken].slice(0, MOST_PICTURES) });
                  });
                }}
              />
            </label>
          )}
        </div>

        <span className="canvas__ilabel">{canvasWords.waitsFor}</span>
        <p className="canvas__iwaits">{waits === null ? canvasWords.nothing : specOf(waits.kind).name}</p>

        <button type="button" className="canvas__iremove" onClick={onRemove} disabled={going}>
          {canvasWords.remove}
        </button>
      </div>
    </aside>
  );
}

/* ---------------------------------------------------------------- nothing */

function Nothing({ onLoop }: { onLoop: (id: string) => void }) {
  return (
    <div className="canvas__nothing">
      <h2 className="canvas__nothingtitle">{canvasWords.empty}</h2>
      <p className="canvas__nothingnote">{canvasWords.emptyNote}</p>
      <ul className="canvas__loops">
        {LOOPS.map((loop) => (
          <li key={loop.id}>
            <button type="button" className="canvas__loop" onClick={() => onLoop(loop.id)}>
              <span className="canvas__loopshape" aria-hidden="true">
                {loop.blocks.map((one, index) => (
                  <span key={`${one.kind}-${String(index)}`} className="canvas__loopmark">
                    <Mark kind={one.kind} />
                  </span>
                ))}
              </span>
              <span className="canvas__loopname">{loop.name}</span>
              <span className="canvas__loopnote">{loop.note}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
