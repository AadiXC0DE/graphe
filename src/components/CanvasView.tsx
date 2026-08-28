import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  BLOCKS,
  canvasWords,
  canWaitFor,
  change,
  isRunning,
  join,
  layOut,
  LOOPS,
  notReady,
  place,
  placeLoop,
  remove,
  specOf,
  waitingOn,
  type Block,
  type BlockKind,
  type BlockModel,
  type Flow,
} from '../work/canvas';
import type { ConnectionState, ModelChoice } from '../lib/ipc';
import { byTier, tierNames } from '../lib/modeltiers';
import type { WorkState } from '../work/board';
import './Sheet.css';
import './CanvasView.css';

/** The card, and the room around it. One size, so a chain reads as a rhythm. */
const CARD = { width: 216, height: 112, gapX: 80, gapY: 24 } as const;
const ZOOM = { least: 0.5, most: 1.4, step: 0.15 } as const;
/** How far out Fit is willing to go. Past this the words on a card stop being
 *  words, and a picture of four unreadable boxes is worth less than three
 *  readable ones with the fourth a pan away. */
const READABLE = 0.8;
/** Further than this and the hand meant to draw a line, not to press. */
const MOVED = 4;

type Props = {
  flow: Flow;
  /** The shape changed. Nothing runs; the shell keeps it. */
  onFlow: (flow: Flow) => void;
  /** Put every block on the board, in order. */
  onStart: () => void;
  /** Take what has not finished off it again. */
  onStop: () => void;
  /** Where each started block has got to, by the piece it became. */
  states: Readonly<Record<string, WorkState>>;
  /** Who could run a block, or null while the first answer is on its way. */
  connection: ConnectionState | null;
  onClose: () => void;
};

const SAYS = { close: 'Close' } as const;

/* -------------------------------------------------------------------- marks */

/** One mark per kind. A row of identical cards is a list; the mark is what
 *  makes a flow readable at a glance without reading a word of it. */
function Mark({ kind }: { kind: BlockKind }) {
  const line = { stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };
  switch (kind) {
    case 'look':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" {...line} />
          <path d="M10.2 10.2 13.5 13.5" {...line} />
        </svg>
      );
    case 'helpers':
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
 * A flow: blocks you place, join up, and then start.
 *
 * Three bands, which is the shape of every tool that composes rather than
 * reports: what you can place, what you have placed, and what the one you are
 * looking at is set to. Nothing here runs anything on its own — the board does
 * that, and only once Start has been pressed.
 */
export default function CanvasView({ flow, onFlow, onStart, onStop, states, connection, onClose }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0, scale: 1 });
  const [joining, setJoining] = useState<{ from: string; x: number; y: number; fromX: number; fromY: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const panning = useRef<{ x: number; y: number; fromX: number; fromY: number } | null>(null);
  const dragged = useRef(false);

  const drawn = useMemo(() => layOut(flow, states), [flow, states]);
  const going = isRunning(flow);
  const chosen = flow.blocks.find((one) => one.id === picked) ?? null;
  const missing = notReady(flow);

  const done = drawn.blocks.filter((one) => one.state === 'done').length;
  const busy = drawn.blocks.filter((one) => one.state === 'running' || one.state === 'needs-you').length;

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      if (picked !== null) {
        setPicked(null);
        return;
      }
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [picked, onClose]);

  useEffect(() => {
    if (refused === null) return;
    const timer = setTimeout(() => setRefused(null), 3600);
    return () => clearTimeout(timer);
  }, [refused]);

  const where = useCallback(
    (column: number, row: number) => ({
      x: column * (CARD.width + CARD.gapX),
      y: row * (CARD.height + CARD.gapY),
    }),
    [],
  );

  const size = useMemo(
    () => ({
      width: Math.max(1, drawn.columns) * (CARD.width + CARD.gapX) - CARD.gapX,
      height: Math.max(1, drawn.rows) * (CARD.height + CARD.gapY) - CARD.gapY,
    }),
    [drawn.columns, drawn.rows],
  );

  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined) return;
    const scale = Math.min(1, (box.width - 96) / size.width, (box.height - 96) / size.height);
    const kept = Math.max(READABLE, Math.min(ZOOM.most, scale));
    setAt({
      x: Math.max(48, (box.width - size.width * kept) / 2),
      y: Math.max(48, (box.height - size.height * kept) / 2),
      scale: kept,
    });
  }, [size.width, size.height]);

  /* Framed until somebody moves it, and theirs from then on. The bands either
     side open and close under it, so a flow that never re-framed would be left
     stranded off the edge by a panel it did not ask for. */
  const touched = useRef(false);
  useEffect(() => {
    if (touched.current || drawn.blocks.length === 0) return;
    fit();
  }, [fit, drawn.blocks.length]);

  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    const watch = new ResizeObserver(() => {
      if (!touched.current) fit();
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, [fit]);

  const zoom = useCallback((by: number, about?: { x: number; y: number }) => {
    setAt((was) => {
      const next = Math.max(ZOOM.least, Math.min(ZOOM.most, was.scale + by));
      if (next === was.scale) return was;
      touched.current = true;
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
        zoom(event.deltaY > 0 ? -ZOOM.step : ZOOM.step, {
          x: event.clientX - box.left,
          y: event.clientY - box.top,
        });
        return;
      }
      setAt((was) => ({ ...was, x: was.x - event.deltaX, y: was.y - event.deltaY }));
    };
    node.addEventListener('wheel', wheeled, { passive: false });
    return () => node.removeEventListener('wheel', wheeled);
  }, [zoom]);

  const startPan = useCallback(
    (event: Pressed) => {
      if (event.button !== 0) return;
      // Capturing the pointer keeps a pan going past the window's edge, and it
      // also retargets the release — so anything pressable inside the surface
      // never sees its own click unless the pan declines to start.
      if ((event.target as Element).closest('button, input, textarea, a, .canvas__card') !== null) return;
      setPicked(null);
      touched.current = true;
      panning.current = { x: event.clientX, y: event.clientY, fromX: at.x, fromY: at.y };
      (event.currentTarget as Element).setPointerCapture(event.pointerId);
    },
    [at.x, at.y],
  );

  const movePan = useCallback(
    (event: Pressed) => {
      const box = surface.current?.getBoundingClientRect();
      if (joining !== null && box !== undefined) {
        const x = event.clientX - box.left;
        const y = event.clientY - box.top;
        if (Math.abs(x - joining.fromX) > MOVED || Math.abs(y - joining.fromY) > MOVED) dragged.current = true;
        setJoining({ ...joining, x, y });
        return;
      }
      const held = panning.current;
      if (held === null) return;
      setAt((was) => ({ ...was, x: held.fromX + (event.clientX - held.x), y: held.fromY + (event.clientY - held.y) }));
    },
    [joining],
  );

  const lostIt = useCallback(() => {
    panning.current = null;
    setJoining(null);
  }, []);

  /** Let a line go. Over a block it becomes a wait; anywhere else it is dropped. */
  const endJoin = useCallback(
    (event: Pressed) => {
      const from = joining?.from ?? null;
      panning.current = null;
      setJoining(null);
      if (from === null) return;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest('.canvas__card');
      const onto = card?.getAttribute('data-block') ?? null;
      if (onto === null || onto === from) return;
      const said = canWaitFor(flow, onto, from);
      if (!said.ok) {
        setRefused(said.because);
        return;
      }
      onFlow(join(flow, onto, from));
    },
    [joining, flow, onFlow],
  );

  /** Place one, behind whatever is selected so a chain builds by pressing. */
  const add = useCallback(
    (kind: BlockKind) => {
      if (going) {
        setRefused(canvasWords.running);
        return;
      }
      const next = place(flow, kind, picked);
      onFlow(next);
      setPicked(next.blocks[next.blocks.length - 1]?.id ?? null);
    },
    [flow, going, onFlow, picked],
  );

  const takeLoop = useCallback(
    (id: string) => {
      if (going) {
        setRefused(canvasWords.running);
        return;
      }
      const loop = LOOPS.find((one) => one.id === id);
      if (loop === undefined) return;
      if (flow.blocks.length === 0) touched.current = false;
      onFlow(placeLoop(flow, loop));
    },
    [flow, going, onFlow],
  );

  return (
    <section className="sheet canvas" aria-label={canvasWords.name}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{canvasWords.name}</h1>
          <p className="sheet__from">{canvasWords.counted(flow.blocks.length, done, busy)}</p>
        </div>

        <div className="sheet__chips" />

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
        </div>

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className={`canvas__bands ${chosen === null ? '' : 'canvas__bands--open'}`}>
        <Palette
          going={going}
          onAdd={add}
          onLoop={takeLoop}
          folded={chosen !== null}
          {...(flow.blocks.length === 0 ? { quiet: true } : {})}
        />

        <div
          className="canvas__surface"
          ref={surface}
          onPointerDown={startPan}
          onPointerMove={movePan}
          onPointerUp={endJoin}
          onPointerCancel={lostIt}
          onLostPointerCapture={lostIt}
          style={{ '--canvas-x': `${String(at.x)}px`, '--canvas-y': `${String(at.y)}px`, '--canvas-dot': `${String(20 * at.scale)}px` } as CSSProperties}
        >
          {drawn.blocks.length === 0 ? (
            <Nothing onLoop={takeLoop} />
          ) : (
            <div
              className="canvas__sheet"
              style={{
                width: size.width,
                height: size.height,
                transform: `translate(${String(at.x)}px, ${String(at.y)}px) scale(${String(at.scale)})`,
              }}
            >
              <svg
                className="canvas__lines"
                width={size.width}
                height={size.height}
                viewBox={`0 0 ${String(size.width)} ${String(size.height)}`}
                aria-hidden="true"
              >
                <defs>
                  <marker id="canvas-tip" viewBox="0 0 8 8" refX="6.5" refY="4" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M1.5 1.5 5.5 4 1.5 6.5" fill="none" stroke="context-stroke" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
                  </marker>
                </defs>
                {drawn.blocks.map((block) => {
                  const parent = drawn.blocks.find((one) => one.id === block.after);
                  if (parent === undefined) return null;
                  const from = where(parent.column, parent.row);
                  const to = where(block.column, block.row);
                  const x1 = from.x + CARD.width;
                  const y1 = from.y + CARD.height / 2;
                  const x2 = to.x - 8;
                  const y2 = to.y + CARD.height / 2;
                  const bend = Math.max(30, (x2 - x1) / 2);
                  const live = block.state === 'running' || block.state === 'needs-you';
                  return (
                    <path
                      key={`${parent.id}-${block.id}`}
                      className={`canvas__line ${live ? 'canvas__line--live' : ''}`}
                      d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                      fill="none"
                      markerEnd="url(#canvas-tip)"
                    />
                  );
                })}
              </svg>

              {drawn.blocks.map((block) => (
                <Card
                  key={block.id}
                  block={block}
                  at={where(block.column, block.row)}
                  behind={waitingOn(flow, block.id).length}
                  picked={picked === block.id}
                  target={joining !== null && joining.from !== block.id}
                  onPick={() => setPicked((was) => (was === block.id ? null : block.id))}
                  onJoinFrom={(event) => {
                    const box = surface.current?.getBoundingClientRect();
                    if (box === undefined) return;
                    const x = event.clientX - box.left;
                    const y = event.clientY - box.top;
                    dragged.current = false;
                    setJoining({ from: block.id, x, y, fromX: x, fromY: y });
                  }}
                />
              ))}
            </div>
          )}

          {joining === null ? null : <Trailing from={joining} where={where} drawn={drawn} at={at} />}

          <div className="canvas__foot">
            {refused === null ? (
              <span className="canvas__hint">{drawn.blocks.length === 0 ? '' : canvasWords.connect}</span>
            ) : (
              <span className="canvas__refused" role="status">{refused}</span>
            )}
            {drawn.blocks.length === 0 ? null : (
              <div className="canvas__zoom">
                <button type="button" className="canvas__zoombtn" onClick={() => zoom(-ZOOM.step)} aria-label="Further out">−</button>
                <button type="button" className="canvas__fit" onClick={fit}>Fit</button>
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
  going,
  folded,
  quiet,
  onAdd,
  onLoop,
}: {
  going: boolean;
  folded: boolean;
  /** The first screen is already offering the loops, whole and readable. Two
   *  lists of the same three is one too many. */
  quiet?: boolean;
  onAdd: (kind: BlockKind) => void;
  onLoop: (id: string) => void;
}) {
  return (
    <aside
      className={`canvas__palette ${folded ? 'canvas__palette--folded' : ''}`}
      aria-label={canvasWords.blocks}
    >
      <h2 className="canvas__band">{canvasWords.blocks}</h2>
      <ul className="canvas__list">
        {BLOCKS.map((spec) => (
          <li key={spec.kind}>
            <button
              type="button"
              className="canvas__pick"
              onClick={() => onAdd(spec.kind)}
              disabled={going}
              title={spec.note}
            >
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
            <button
              type="button"
              className="canvas__pick canvas__pick--loop"
              onClick={() => onLoop(loop.id)}
              disabled={going}
              title={loop.note}
            >
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
  at,
  behind,
  picked,
  target,
  onPick,
  onJoinFrom,
}: {
  block: Block & { column: number; row: number; state: import('../work/canvas').BlockState };
  at: { x: number; y: number };
  behind: number;
  picked: boolean;
  target: boolean;
  onPick: () => void;
  onJoinFrom: (event: Pressed) => void;
}) {
  const spec = specOf(block.kind);
  const says = block.says.trim();
  return (
    <div
      className={`canvas__card canvas__card--${block.state}${picked ? ' canvas__card--picked' : ''}${target ? ' canvas__card--target' : ''}`}
      data-block={block.id}
      style={{ left: at.x, top: at.y, width: CARD.width, height: CARD.height, '--canvas-card': `${String(CARD.height)}px` } as CSSProperties}
    >
      {block.state === 'running' ? <span className="canvas__sweep" aria-hidden="true" /> : null}

      <button type="button" className="canvas__face" onClick={onPick} aria-pressed={picked}>
        <span className="canvas__head">
          <span className="canvas__mark" aria-hidden="true">
            <Mark kind={block.kind} />
          </span>
          <span className="canvas__kind">{spec.name}</span>
          <span className="canvas__state">{canvasWords.states[block.state]}</span>
        </span>
        <span className="canvas__says">{says === '' ? spec.needsWords ? canvasWords.saySomething : spec.note : says}</span>
        {block.model === null && behind === 0 ? null : (
          <span className="canvas__foots">
            {block.model === null ? null : <span className="canvas__model">{block.model.modelId}</span>}
            {behind === 0 ? null : <span className="canvas__behind">{String(behind)} after</span>}
          </span>
        )}
      </button>

      <button
        type="button"
        className="canvas__handle"
        onPointerDown={(event) => {
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
  where,
  drawn,
  at,
}: {
  from: { from: string; x: number; y: number };
  where: (column: number, row: number) => { x: number; y: number };
  drawn: ReturnType<typeof layOut>;
  at: { x: number; y: number; scale: number };
}) {
  const parent = drawn.blocks.find((one) => one.id === from.from);
  if (parent === undefined) return null;
  const spot = where(parent.column, parent.row);
  const x1 = at.x + (spot.x + CARD.width) * at.scale;
  const y1 = at.y + (spot.y + CARD.height / 2) * at.scale;
  const bend = Math.max(30, Math.abs(from.x - x1) / 2);
  return (
    <svg className="canvas__trailing" aria-hidden="true">
      <path
        d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(from.x - bend)} ${String(from.y)}, ${String(from.x)} ${String(from.y)}`}
        fill="none"
      />
    </svg>
  );
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

  const bands = useMemo(() => {
    const tiered = byTier(offers);
    if (tiered === null) return [{ name: '', models: offers }];
    return tiered.map(([tier, models]) => ({ name: tierNames[tier].name, models }));
  }, [offers]);

  const sameAs = (one: { providerId: string; modelId: string }, other: BlockModel) =>
    other !== null && other.providerId === one.providerId && other.modelId === one.modelId;

  const waits = flow.blocks.find((one) => one.id === block.after) ?? null;

  return (
    <aside className="canvas__inspector" aria-label={spec.name}>
      <header className="canvas__ihead">
        <span className="canvas__imark" aria-hidden="true">
          <Mark kind={block.kind} />
        </span>
        <h2 className="canvas__iname">{spec.name}</h2>
        <button type="button" className="canvas__ishut" onClick={onClose} aria-label={SAYS.close}>
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
          rows={5}
          value={block.says}
          disabled={going}
          placeholder={spec.needsWords ? 'Tighten the nav on mobile' : spec.says}
          onChange={(event) => onChange({ says: event.target.value })}
        />

        <h3 className="canvas__iband">{canvasWords.runBy}</h3>
        <div className="canvas__imodels" role="radiogroup" aria-label={canvasWords.runBy}>
          <button
            type="button"
            role="radio"
            aria-checked={block.model === null}
            className={`canvas__imodel ${block.model === null ? 'canvas__imodel--on' : ''}`}
            disabled={going}
            onClick={() => onChange({ model: null })}
          >
            {canvasWords.whichever}
          </button>
          {bands.map((band) => (
            <div key={band.name || 'all'} className="canvas__itier">
              {band.name === '' ? null : <span className="canvas__itiername">{band.name}</span>}
              {band.models.map((one) => (
                <button
                  key={`${one.providerId}/${one.modelId}`}
                  type="button"
                  role="radio"
                  aria-checked={sameAs(one, block.model)}
                  className={`canvas__imodel ${sameAs(one, block.model) ? 'canvas__imodel--on' : ''}`}
                  disabled={going}
                  title={`${one.providerName} · ${one.modelId}`}
                  onClick={() => onChange({ model: { providerId: one.providerId, modelId: one.modelId } })}
                >
                  {one.label}
                </button>
              ))}
            </div>
          ))}
        </div>

        <h3 className="canvas__iband">{canvasWords.waitsFor}</h3>
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

export type { ModelChoice };
