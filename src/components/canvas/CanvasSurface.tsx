/** The sheet: everything you can move, and everything you can join.
 *
 * Cards sit at absolute positions on a surface that pans and zooms under them,
 * and every wait is drawn once, as a curve out of the right of one card into
 * the left of the next. The drawing knows nothing about running: it is handed a
 * flow and hands back a flow.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  CARD,
  canvasWords,
  canWaitFor,
  change,
  join,
  joined,
  laneFor,
  layOut,
  unjoin,
  type Flow,
  type Placed,
  type Run,
} from '../../work/canvas';
import type { ConnectionState } from '../../lib/ipc';
import BlockCard, { Edges, Trailing, modelWord } from './BlockCard';

const ZOOM = { least: 0.4, most: 1.6, step: 0.15 } as const;
/** How far out Fit goes: past this the words on a card stop being words. */
const READABLE = 0.75;
/** Further than this and the hand meant to move something, not to press it. */
const MOVED = 4;
/** Long enough to read a sentence, short enough not to sit over the board. */
const REFUSED_MS = 3600;

export type Line = { parent: string; child: string };
export type Joining = { from: string; x: number; y: number };
type At = { x: number; y: number; scale: number };

type Props = {
  flow: Flow;
  /** The run being shown, or null before this canvas has ever been started. */
  run: Run | null;
  connection: ConnectionState | null;
  learning: { step: string | null; asking: boolean } | null;
  picked: string | null;
  onPick: (id: string | null) => void;
  line: Line | null;
  onLine: (line: Line | null) => void;
  joining: Joining | null;
  onJoining: (joining: Joining | null) => void;
  onFlow: (flow: Flow) => void;
  /** Watch and Open both land here: the card already says which it is. */
  onOpen: (conversation: string) => void;
  onContinue: () => void;
  /** Read by the frame, so its panel sits against the same transform. */
  /** The pan and scale, and where the board starts inside the canvas. */
  onAt?: (at: At, origin: { x: number; y: number }) => void;
};

export default function CanvasSurface({
  flow,
  run,
  connection,
  learning,
  picked,
  onPick,
  line: chosen,
  onLine,
  joining,
  onJoining,
  onFlow,
  onOpen,
  onContinue,
  onAt,
}: Props) {
  const surface = useRef<HTMLDivElement>(null);
  const [at, setAt] = useState<At>({ x: 0, y: 0, scale: 1 });
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /* One gesture at a time, so one ref: a pan and a drag can never both be true,
     and `now` exists because `moving` is a render behind the hand. */
  const gesture = useRef<{
    panning: { x: number; y: number; fromX: number; fromY: number } | null;
    card: { id: string; x: number; y: number; fromX: number; fromY: number } | null;
    now: { id: string; x: number; y: number } | null;
    dragged: boolean;
  }>({ panning: null, card: null, now: null, dragged: false });

  const laid = useMemo(() => layOut(flow), [flow]);
  const drawn: readonly Placed[] = useMemo(
    () =>
      moving === null
        ? laid.blocks
        : laid.blocks.map((one) => (one.id === moving.id ? { ...one, x: moving.x, y: moving.y } : one)),
    [laid.blocks, moving],
  );

  useEffect(() => {
    /* The pan, and where this surface starts inside the canvas. The panel is
       placed against the canvas but the cards are positioned against the sheet,
       so the frame needs the offset: without it a panel lands on the card it
       belongs beside. Stable on both sides, so this reports a change rather
       than re-arming itself. */
    const box = surface.current?.getBoundingClientRect();
    const outer = surface.current?.offsetParent?.getBoundingClientRect();
    onAt?.(at, {
      x: box && outer ? box.left - outer.left : 0,
      y: box && outer ? box.top - outer.top : 0,
    });
  }, [at, onAt]);

  useEffect(() => {
    if (refused === null) return;
    const timer = setTimeout(() => setRefused(null), REFUSED_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  /** Where a point on the screen is on the sheet underneath it. */
  const onSheet = (clientX: number, clientY: number) => {
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined) return { x: 0, y: 0 };
    return { x: (clientX - box.left - at.x) / at.scale, y: (clientY - box.top - at.y) / at.scale };
  };

  /* Framed once, and theirs from then on: re-framing on every growth re-centred
     the board under the hand that was moving a card past its edge. */
  const framed = useRef(false);
  const fit = useCallback(() => {
    // Never while something is in the hand: the ground would move under it.
    if (gesture.current.card !== null || gesture.current.panning !== null) return;
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined || laid.width === 0) return;
    const scale = Math.min(1, (box.width - 96) / laid.width, (box.height - 120) / laid.height);
    const kept = Math.max(READABLE, Math.min(ZOOM.most, scale));
    framed.current = true;
    setAt({
      x: Math.max(40, (box.width - laid.width * kept) / 2),
      y: Math.max(40, (box.height - laid.height * kept) / 2),
      scale: kept,
    });
  }, [laid.width, laid.height]);

  const fitNow = useRef(fit);
  fitNow.current = fit;

  useEffect(() => {
    if (framed.current || laid.blocks.length === 0) return;
    fitNow.current();
  }, [laid.blocks.length]);

  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    /* Only a real change in the room counts: the first call is the size it
       already had. The bands either side open and close under this. */
    let was: string | null = null;
    const watch = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box === undefined) return;
      const now = `${String(Math.round(box.width))}x${String(Math.round(box.height))}`;
      const moved = was !== null && was !== now;
      was = now;
      if (moved && !framed.current) fitNow.current();
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

  const zoom = useCallback((by: number, about?: { x: number; y: number }) => {
    framed.current = true;
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
      // The panel scrolls itself: bubbling here dragged the board under it.
      if ((event.target as Element | null)?.closest('.canvas__panel') != null) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const box = node.getBoundingClientRect();
        // A pinch is dozens of small events, so a fixed step per event flew to
        // the stops. Follow the gesture, never further than one button press.
        const by = Math.max(-ZOOM.step, Math.min(ZOOM.step, -event.deltaY * 0.006));
        zoom(by, { x: event.clientX - box.left, y: event.clientY - box.top });
        return;
      }
      framed.current = true;
      setAt((was) => ({ ...was, x: was.x - event.deltaX, y: was.y - event.deltaY }));
    };
    node.addEventListener('wheel', wheeled, { passive: false });
    return () => node.removeEventListener('wheel', wheeled);
  }, [zoom]);

  /** Drawn last first: the card on top is the one the hand means. */
  const under = (x: number, y: number): Placed | null => {
    for (let index = drawn.length - 1; index >= 0; index -= 1) {
      const one = drawn[index];
      if (one === undefined) continue;
      if (x >= one.x && x <= one.x + CARD.width && y >= one.y && y <= one.y + CARD.height) return one;
    }
    return null;
  };

  const startPan = (event: Pressed) => {
    if (event.button !== 0) return;
    // The panel is on the surface but not part of it: a press in it is its own.
    if ((event.target as Element).closest('button, input, textarea, select, a, .canvas__card, .canvas__panel') !== null) {
      return;
    }
    onPick(null);
    onLine(null);
    framed.current = true;
    gesture.current.panning = { x: event.clientX, y: event.clientY, fromX: at.x, fromY: at.y };
    (event.currentTarget as Element).setPointerCapture(event.pointerId);
  };

  const moved = (event: Pressed) => {
    const box = surface.current?.getBoundingClientRect();
    const { card, panning } = gesture.current;

    if (joining !== null && box !== undefined) {
      gesture.current.dragged = true;
      onJoining({ ...joining, x: event.clientX - box.left, y: event.clientY - box.top });
      return;
    }

    if (card !== null) {
      const far = Math.abs(event.clientX - card.x) + Math.abs(event.clientY - card.y);
      if (far > MOVED) {
        gesture.current.dragged = true;
        // Arranging decides where things go, so the board stops re-framing.
        framed.current = true;
      }
      if (gesture.current.dragged) {
        const spot = {
          id: card.id,
          x: Math.round(card.fromX + (event.clientX - card.x) / at.scale),
          y: Math.round(card.fromY + (event.clientY - card.y) / at.scale),
        };
        gesture.current.now = spot;
        setMoving(spot);
      }
      return;
    }

    if (panning === null) return;
    setAt((was) => ({
      ...was,
      x: panning.fromX + (event.clientX - panning.x),
      y: panning.fromY + (event.clientY - panning.y),
    }));
  };

  const letGo = (event: Pressed) => {
    const { card, now, dragged } = gesture.current;
    gesture.current.panning = null;
    gesture.current.card = null;
    gesture.current.now = null;

    if (card !== null) {
      setMoving(null);
      if (dragged && now !== null) onFlow(change(flow, card.id, { at: { x: now.x, y: now.y } }));
      else onPick(picked === card.id ? null : card.id);
      return;
    }

    // A line let go: over a card it becomes a wait, anywhere else it is dropped.
    const from = joining?.from ?? null;
    onJoining(null);
    if (from === null) return;
    const point = onSheet(event.clientX, event.clientY);
    const onto = under(point.x, point.y);
    if (onto === null || onto.id === from) return;
    // Over a line that is already there, the same gesture takes it off.
    if (joined(flow, onto.id, from)) {
      onFlow(unjoin(flow, onto.id, from));
      return;
    }
    const said = canWaitFor(flow, onto.id, from);
    if (!said.ok) {
      setRefused(said.because);
      return;
    }
    onFlow(join(flow, onto.id, from));
  };

  const lost = () => {
    gesture.current = { panning: null, card: null, now: null, dragged: false };
    setMoving(null);
    onJoining(null);
  };

  /** The lane a block runs in, and the conversation that lane opened. */
  const conversationFor = (id: string): string | null => {
    if (run === null) return null;
    const block = flow.blocks.find((one) => one.id === id);
    return (
      run.lanes.find((one) => one.id === (block === undefined ? 'lane-0' : laneFor(flow, block)))
        ?.conversationId ?? null
    );
  };

  const style = {
    '--canvas-x': `${String(at.x)}px`,
    '--canvas-y': `${String(at.y)}px`,
    '--canvas-dot': `${String(Math.round(20 * at.scale))}px`,
  } as CSSProperties;

  return (
    <div
      className="canvas__surface" ref={surface} style={style} onPointerDown={startPan} onPointerMove={moved}
      onPointerUp={letGo} onPointerCancel={lost} onLostPointerCapture={lost} data-scale={at.scale}
    >
      <div
        className="canvas__sheet"
        style={{ transform: `translate(${String(at.x)}px, ${String(at.y)}px) scale(${String(at.scale)})` }}
      >
        <Edges blocks={drawn} chosen={chosen} onPick={(one) => { onPick(null); onLine(one); }} />

        {drawn.map((block) => {
          const conversation = conversationFor(block.id);
          return (
            <BlockCard
              key={block.id} block={block} run={run?.blocks[block.id] ?? null}
              model={modelWord(block.model, connection)} conversation={conversation}
              learning={block.state === 'running' ? (learning?.step ?? canvasWords.working) : null}
              picking={picked === block.id} target={joining !== null && joining.from !== block.id}
              held={moving?.id === block.id}
              onDown={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                (event.currentTarget as Element).setPointerCapture(event.pointerId);
                gesture.current.dragged = false;
                gesture.current.card = {
                  id: block.id,
                  x: event.clientX,
                  y: event.clientY,
                  fromX: block.x,
                  fromY: block.y,
                };
              }}
              onSelect={() => onPick(picked === block.id ? null : block.id)}
              onHandle={(event) => {
                if (event.button !== 0) return;
                event.stopPropagation();
                (event.currentTarget as Element).setPointerCapture(event.pointerId);
                const box = surface.current?.getBoundingClientRect();
                if (box === undefined) return;
                gesture.current.dragged = false;
                onJoining({ from: block.id, x: event.clientX - box.left, y: event.clientY - box.top });
              }}
              onWatch={() => {
                if (conversation !== null) onOpen(conversation);
              }}
              onOpen={() => {
                if (conversation !== null) onOpen(conversation);
              }}
              onContinue={onContinue}
            />
          );
        })}
      </div>

      {joining === null ? null : <Trailing from={joining} blocks={drawn} at={at} />}

      {refused === null ? null : (
        <p className="canvas__refused" role="alert">{refused}</p>
      )}

      {laid.blocks.length === 0 ? null : (
        <div className="canvas__zoom">
          <button type="button" className="canvas__zoombtn" onClick={() => zoom(-ZOOM.step)} aria-label={canvasWords.further}>
            −
          </button>
          <button type="button" className="canvas__fit" onClick={fit}>{canvasWords.fit}</button>
          <button type="button" className="canvas__zoombtn" onClick={() => zoom(ZOOM.step)} aria-label={canvasWords.closer}>
            +
          </button>
        </div>
      )}
    </div>
  );
}
