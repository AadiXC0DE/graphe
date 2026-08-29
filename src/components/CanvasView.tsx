import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  BLOCKS,
  CARD,
  canvasWords,
  canWaitFor,
  change,
  endedAs,
  isArranged,
  isRunning,
  join,
  joined,
  layOut,
  lineState,
  LOOPS,
  MOST_FILES,
  notReady,
  place,
  placeLoop,
  remove,
  ROUNDS,
  specOf,
  tidied,
  unjoin,
  waitingOn,
  type Block,
  type BlockKind,
  type BlockSaid,
  type BlockFile,
  type Ending,
  type Flow,
  type Placed,
} from '../work/canvas';
import type { ConnectionState, ModelChoice, ThinkingLevel } from '../lib/ipc';
import { thinkingLevels } from '../lib/thinking';
import { byTier, tierNames } from '../lib/modeltiers';
import Asking from './Asking';
import ThinkingWith from './ThinkingWith';
import './CanvasView.css';

const ZOOM = { least: 0.4, most: 1.6, step: 0.15 } as const;
/** How far out Fit is willing to go. Past this the words on a card stop being
 *  words, and a picture of six unreadable boxes is worth less than four
 *  readable ones with the rest a pan away. */
const READABLE = 0.75;
/** The panel that opens beside a card. Named here because where it goes is
 *  arithmetic against the card, not a decision the stylesheet can make. */
const PANEL = { width: 300, height: 500 } as const;
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
  /** How long each model takes before answering, by provider/model. Set here
   *  for the model a block runs on, which is the same setting the composer's
   *  picker writes — it belongs to the model, not to the turn. */
  thinking?: Readonly<Record<string, ThinkingLevel>>;
  onThinking?: ((choice: ModelChoice, level: ThinkingLevel) => void) | undefined;
  /** The model every block runs on unless it names its own, changed from the
   *  same picker the composer has. */
  onModel?: ((choice: ModelChoice) => void) | undefined;
  onConnect?: (() => void) | undefined;
  advisor?: ModelChoice | null | undefined;
  onAdvisor?: ((choice: ModelChoice | null) => void) | undefined;
  advisorThinking?: ThinkingLevel | undefined;
  onAdvisorThinking?: ((choice: ModelChoice, level: ThinkingLevel) => void) | undefined;
  /** The projects inside this folder, where it holds several. Empty for an
   *  ordinary project, and then the flow never names one. */
  repos?: readonly { name: string }[];
  /** Covering the whole window rather than sitting in its own column. */
  full: boolean;
  onFull: (full: boolean) => void;
  /** Bring the conversation this canvas ran in to the front, where every turn
   *  it took can be read. Absent until it has run once and has one. */
  onOpenThread?: (() => void) | undefined;
  /** What the turn in flight is doing this second, and whether it has stopped
   *  to ask. Without it a block that ran for twenty minutes said "Going" and
   *  nothing else. */
  doing?: { step: string | null; asking: boolean } | undefined;
};

/** A model's own name, rather than the id it is addressed by. */
function modelName(block: Block, connection: ConnectionState | null): string | null {
  if (block.model === null) return null;
  for (const provider of connection?.providers ?? []) {
    for (const model of provider.models) {
      if (provider.providerId === block.model.providerId && model.id === block.model.modelId) return model.label;
    }
  }
  return block.model.modelId;
}

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
export default function CanvasView({ flow, onFlow, onStart, onStop, onCarryOn, connection, thinking, onThinking, onModel, onConnect, advisor, onAdvisor, advisorThinking, onAdvisorThinking, repos = [], full, onFull, onOpenThread, doing }: Props) {
  const surface = useRef<HTMLDivElement>(null);

  const [picked, setPicked] = useState<string | null>(null);
  const [at, setAt] = useState({ x: 0, y: 0, scale: 1 });
  const [joining, setJoining] = useState<{ from: string; x: number; y: number } | null>(null);
  /** A card under the hand, drawn where the hand is rather than where it was
   *  last saved: a block that only moves when you let go does not feel moved. */
  const [moving, setMoving] = useState<{ id: string; x: number; y: number } | null>(null);
  /** Where the card is this instant. `moving` is a render behind by the time
   *  the hand lets go, which set the card down one step short of the drop. */
  const movingNow = useRef<{ id: string; x: number; y: number } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);
  /* Whether the model picker is open, and a key that puts it away. Escape does
     not reach it over a full-window canvas, so the board closes it the only way
     that is certain: by starting it again, shut. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRound, setPickerRound] = useState(0);

  /** Asked before every block goes. Taking a whole canvas off by accident is
   *  the one thing here that cannot be undone by dragging something back. */
  const [clearing, setClearing] = useState(false);
  /** A line somebody pressed, so it can be taken off without a drag. */
  const [chosenLine, setChosenLine] = useState<{ from: string; to: string } | null>(null);
  /** The ending band, put away by hand. Held by which run it was, so a second
   *  run says how that one went rather than staying hidden. */
  const [hidEnding, setHidEnding] = useState<number | null>(null);

  const panning = useRef<{ x: number; y: number; fromX: number; fromY: number } | null>(null);
  const held = useRef<{ id: string; x: number; y: number; fromX: number; fromY: number } | null>(null);
  const dragged = useRef(false);
  const touched = useRef(false);

  /** Where the panel for one card goes: beside it, and never off the surface. */
  const beside = useCallback(
    (block: { x: number; y: number }) => {
      const box = surface.current?.getBoundingClientRect();
      const room = { across: box?.width ?? 1200, down: box?.height ?? 800 };
      const right = at.x + (block.x + CARD.width + 14) * at.scale;
      const left = at.x + (block.x - PANEL.width - 14) * at.scale;
      // Beside it on the right where there is room, on its left where there is
      // not, and never past the edge either way.
      const x = right + PANEL.width + 16 <= room.across ? right : Math.max(16, left);
      const y = at.y + block.y * at.scale;
      return {
        x: Math.max(16, Math.min(x, room.across - PANEL.width - 16)),
        y: Math.max(16, Math.min(y, Math.max(16, room.down - PANEL.height - 16))),
        side: (x === right ? 'right' : 'left') as 'left' | 'right',
      };
    },
    [at.x, at.y, at.scale],
  );

  const laid = useMemo(() => layOut(flow), [flow]);
  const ending = useMemo(() => endedAs(flow), [flow]);
  /** More than one block and nothing joined yet: the one moment saying how to
   *  join them is worth the room. */
  const unjoined = flow.blocks.length > 1 && flow.blocks.every((one) => one.after === null);
  const drawn: readonly Placed[] = useMemo(
    () => (moving === null ? laid.blocks : laid.blocks.map((one) => (one.id === moving.id ? { ...one, x: moving.x, y: moving.y } : one))),
    [laid.blocks, moving],
  );
  const going = isRunning(flow);
  const chosen = flow.blocks.find((one) => one.id === picked) ?? null;
  const chosenAt = drawn.find((one) => one.id === picked) ?? null;
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
    // Never while something is in the hand: re-framing moves the ground under
    // the card being dragged, which reads as the card snapping away.
    if (held.current !== null || panning.current !== null) return;
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

  /* The observer reads this rather than closing over `fit`, whose identity
     changes with the drawing. Subscribed to `fit` it re-subscribed on every
     pointermove of a drag, and `observe()` fires once immediately — so the
     board re-framed under the hand that was moving a card. */
  const fitNow = useRef(fit);
  fitNow.current = fit;

  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    // The bands either side open and close under it; a flow that never
    // re-framed would be stranded off the edge by a panel it did not ask for.
    // Only a real change in the room counts — the first call is the size it
    // already had.
    let was: { width: number; height: number } | null = null;
    const watch = new ResizeObserver(([entry]) => {
      const box = entry?.contentRect;
      if (box === undefined) return;
      const now = { width: Math.round(box.width), height: Math.round(box.height) };
      const moved = was !== null && (was.width !== now.width || was.height !== now.height);
      was = now;
      if (moved && !touched.current) fitNow.current();
    });
    watch.observe(node);
    return () => watch.disconnect();
  }, []);

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

  /* The keys a board is expected to answer. Only ever when the hand is not in
     a field: Backspace in a textarea is a character, not a card. */
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const on = event.target as Element | null;
      if (on?.closest('input, textarea, select, [contenteditable]') != null) return;
      if (event.key === 'Escape') {
        if (pickerOpen) {
          setPickerOpen(false);
          setPickerRound((was) => was + 1);
          event.preventDefault();
          return;
        }
        if (joining !== null) { setJoining(null); return; }
        if (picked !== null) { setPicked(null); event.stopPropagation(); }
        return;
      }
      if (event.key !== 'Backspace' && event.key !== 'Delete') return;
      if (going) return;
      if (chosenLine !== null) {
        event.preventDefault();
        onFlow(unjoin(flow, chosenLine.to, chosenLine.from));
        setChosenLine(null);
        return;
      }
      if (picked === null) return;
      event.preventDefault();
      onFlow(remove(flow, picked));
      setPicked(null);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  });

  /* Natively, and not passively: pinching over a canvas means this canvas, and
     left alone the window itself zooms underneath it. */
  useEffect(() => {
    const node = surface.current;
    if (node === null) return;
    const wheeled = (event: WheelEvent) => {
      // The panel scrolls itself. Left to bubble, reading down a model list
      // dragged the whole board along under it.
      if ((event.target as Element | null)?.closest('.canvas__panel') != null) return;
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
        const box = node.getBoundingClientRect();
        // A trackpad pinch arrives as dozens of small events, so a fixed step
        // per event flew straight to the stops. Follow the gesture instead, and
        // never move more in one event than a press on the buttons would.
        const by = Math.max(-ZOOM.step, Math.min(ZOOM.step, -event.deltaY * 0.006));
        zoom(by, { x: event.clientX - box.left, y: event.clientY - box.top });
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
      // The panel is on the surface but is not part of it: a press anywhere
      // inside it belongs to whatever it landed on.
      if ((event.target as Element).closest('button, input, textarea, select, a, .canvas__card, .canvas__panel') !== null) return;
      setPicked(null);
      setChosenLine(null);
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
          const spot = {
            id: card.id,
            x: Math.round(card.fromX + (event.clientX - card.x) / at.scale),
            y: Math.round(card.fromY + (event.clientY - card.y) / at.scale),
          };
          movingNow.current = spot;
          setMoving(spot);
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
        const spot = movingNow.current;
        movingNow.current = null;
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
      // Dragged over a line that is already there, the same gesture takes it
      // off — which is how a wait is removed without opening anything.
      if (joined(flow, onto, from)) {
        onFlow(unjoin(flow, onto, from));
        setRefused(canvasWords.unjoined);
        return;
      }
      const said = canWaitFor(flow, onto, from);
      if (!said.ok) {
        setRefused(said.because);
        return;
      }
      onFlow(join(flow, onto, from));
    },
    [joining, flow, onFlow],
  );

  const lost = useCallback(() => {
    panning.current = null;
    held.current = null;
    movingNow.current = null;
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
      {/* Escape, caught here rather than on the document: over a full-window
          canvas the picker's own listener does not always see it, and a menu
          that will not close on Escape is a menu that traps the hand. */}
      <header
        className="canvas__bar"
        onKeyDownCapture={(event) => {
          if (event.key !== 'Escape' || !pickerOpen) return;
          event.preventDefault();
          setPickerOpen(false);
          setPickerRound((was) => was + 1);
        }}
      >
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

        {flow.blocks.length === 0 || going ? null : (
          <button type="button" className="canvas__tidy" onClick={() => setClearing(true)} title={canvasWords.clearNote}>
            {canvasWords.clear}
          </button>
        )}

        {/* What a block with no model of its own runs on, chosen here rather
            than only described inside a block's panel. The same picker the
            composer has: one control for one question. */}
        <div className="canvas__far">
          {connection === null || onModel === undefined ? null : (
            <ThinkingWith
              key={pickerRound}
              state={connection}
              onSelect={onModel}
              onOpenChange={setPickerOpen}
              onConnect={onConnect ?? (() => undefined)}
              {...(onThinking === undefined ? {} : { onThinking })}
              {...(advisor === undefined ? {} : { advisor })}
              {...(onAdvisor === undefined ? {} : { onAdvisor })}
              {...(advisorThinking === undefined ? {} : { advisorThinking })}
              {...(onAdvisorThinking === undefined ? {} : { onAdvisorThinking })}
              bare
            />
          )}
          {/* Only where the folder holds several. One flow works in one of
              them: a pull request has to be opened somewhere. */}
          {repos.length > 1 ? (
            <label className="canvas__which" title={canvasWords.whichNote}>
              <span className="canvas__whichname">{canvasWords.which}</span>
              <select
                className="canvas__whichpick"
                value={flow.repo ?? repos[0]?.name ?? ''}
                disabled={going}
                onChange={(event) => onFlow({ ...flow, repo: event.target.value })}
              >
                {repos.map((one) => (
                  <option key={one.name} value={one.name}>
                    {one.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <Asking howFar={flow.howFar} onHowFar={(rung) => onFlow({ ...flow, howFar: rung })} opens="down-right" />
        </div>

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

      <div className="canvas__bands">
        <Palette onAdd={add} onLoop={takeLoop} {...(flow.blocks.length === 0 ? { quiet: true } : {})} />

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
                {/* One line per wait, so a block that begins after two things
                    has two lines into it. */}
                {drawn.flatMap((block) =>
                  block.after.map((was) => {
                    const parent = drawn.find((one) => one.id === was);
                    if (parent === undefined) return null;
                    const doing = lineState(parent.state, block.state);
                    const path = line(leaves(parent), arrives(block));
                    const on = chosenLine?.from === parent.id && chosenLine.to === block.id;
                    return (
                      <g key={`${parent.id}-${block.id}`}>
                        <path
                          className={`canvas__line ${doing === 'passed' ? 'canvas__line--passed' : ''} ${on ? 'canvas__line--chosen' : ''}`}
                          d={path}
                          fill="none"
                          markerEnd="url(#canvas-tip)"
                        />
                        {/* Idle, a slow drift the length of the line: the board
                            said which blocks were joined and nothing about
                            which way the work would go. */}
                        {doing === 'idle' ? <path className="canvas__drift" d={path} fill="none" /> : null}
                        {doing === 'live' ? <path className="canvas__flow" d={path} fill="none" /> : null}
                        {/* A wide invisible copy, because a 1.5px line is not
                            something a hand can hit. */}
                        <path
                          className="canvas__grab"
                          d={path}
                          fill="none"
                          onPointerDown={(event) => {
                            event.stopPropagation();
                            setPicked(null);
                            setChosenLine({ from: parent.id, to: block.id });
                          }}
                        />
                      </g>
                    );
                  }),
                )}
              </svg>

              {drawn.map((block) => (
                <Card
                  key={block.id}
                  block={block}
                  rounds={flow.running === block.id ? flow.rounds : 0}
                  first={block.after.length === 0 && flow.blocks.length > 1}
                  last={waitingOn(flow, block.id).length === 0 && flow.blocks.length > 1 && block.after.length > 0}
                  model={modelName(block, connection)}
                  came={flow.said[block.id]}
                  {...(flow.running === block.id && doing?.step != null ? { doing: doing.step } : {})}
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

          {chosen === null || chosenAt === null ? null : (
            <Inspector
              key={chosen.id}
              block={chosen}
              flow={flow}
              connection={connection}
              thinking={thinking ?? {}}
              {...(onThinking === undefined ? {} : { onThinking })}
              going={going}
              spot={beside(chosenAt)}
              onChange={(over) => onFlow(change(flow, chosen.id, over))}
              onRemove={() => {
                onFlow(remove(flow, chosen.id));
                setPicked(null);
              }}
              onClose={() => setPicked(null)}
            />
          )}

          {joining === null ? null : <Trailing from={joining} blocks={drawn} at={at} />}

          {!clearing ? null : (
            <div className="canvas__sure" role="alertdialog" aria-label={canvasWords.clearNote}>
              <p className="canvas__surequestion">{canvasWords.clearSure(flow.blocks.length)}</p>
              <div className="canvas__surerow">
                <button type="button" className="canvas__surekeep" onClick={() => setClearing(false)}>
                  {canvasWords.clearNo}
                </button>
                <button
                  type="button"
                  className="canvas__suredo"
                  onClick={() => {
                    setClearing(false);
                    setPicked(null);
                    setChosenLine(null);
                    onFlow({ ...flow, blocks: [], done: [], said: {}, running: null, startedAt: null });
                  }}
                >
                  {canvasWords.clearYes}
                </button>
              </div>
            </div>
          )}

          {/* One row along the foot: the zoom under the block list it lines up
              with, and beside it whatever the canvas has to say. */}
          <div className="canvas__foot">
            {refused !== null ? (
              <span className="canvas__refused" role="status">{refused}</span>
            ) : going ? (
              <div className={`canvas__going ${doing?.asking === true ? 'canvas__going--asking' : ''}`} role="status">
                <span className={`canvas__goingmark ${doing?.asking === true ? '' : 'canvas__goingmark--turning'}`} aria-hidden="true" />
                <span className="canvas__goingsaid">
                  {doing?.asking === true
                    ? canvasWords.asksYou
                    : (doing?.step ?? canvasWords.working)}
                </span>
                {onOpenThread === undefined || flow.conversation === null ? null : (
                  <button type="button" className="canvas__endopen" onClick={onOpenThread}>
                    {doing?.asking === true ? canvasWords.answerIt : canvasWords.watchIt}
                  </button>
                )}
              </div>
            ) : ending !== null && hidEnding !== flow.startedAt ? (
              <Ended
                ending={ending}
                {...(onOpenThread === undefined || flow.conversation === null ? {} : { onOpenThread })}
                onHide={() => setHidEnding(flow.startedAt)}
              />
            ) : unjoined ? (
              <span className="canvas__hint">{canvasWords.connect}</span>
            ) : (
              <span />
            )}
            {laid.blocks.length === 0 ? null : (
              <div className="canvas__zoom">
                <button type="button" className="canvas__zoombtn" onClick={() => zoom(-ZOOM.step)} aria-label={canvasWords.further}>−</button>
                <button
                  type="button"
                  className="canvas__fit"
                  onClick={() => {
                    touched.current = false;
                    fit();
                  }}
                >
                  {canvasWords.fit}
                </button>
                <button type="button" className="canvas__zoombtn" onClick={() => zoom(ZOOM.step)} aria-label={canvasWords.closer}>+</button>
              </div>
            )}
          </div>
        </div>

      </div>
    </section>
  );
}

/* ---------------------------------------------------------------- palette */

function Palette({
  quiet,
  onAdd,
  onLoop,
}: {
  /** The first screen is already offering the loops, whole and readable. Two
   *  lists of the same three is one too many. */
  quiet?: boolean;
  onAdd: (kind: BlockKind) => void;
  onLoop: (id: string) => void;
}) {
  /* Folded, the marks travel without their words, so the word rides beside the
     one under the pointer. Drawn outside the rail rather than off the button: a
     list that scrolls clips anything hanging out of it. */
  const [tip, setTip] = useState<{ name: string; y: number } | null>(null);
  const rail = useRef<HTMLDivElement>(null);

  const show = (name: string) => (event: { currentTarget: HTMLElement }) => {
    const box = rail.current?.getBoundingClientRect();
    if (box === undefined || box.width > 100) return;
    const at = event.currentTarget.getBoundingClientRect();
    setTip({ name, y: at.top - box.top + at.height / 2 });
  };

  return (
    <div className="canvas__rail" ref={rail}>
      {tip === null ? null : (
        <span className="canvas__tip" style={{ top: tip.y } as CSSProperties} aria-hidden="true">
          {tip.name}
        </span>
      )}
      <aside className="canvas__palette scroll--auto" aria-label={canvasWords.blocks}>
      <h2 className="canvas__band">{canvasWords.blocks}</h2>
      <ul className="canvas__list">
        {BLOCKS.map((spec) => (
          <li key={spec.kind}>
            <button
              type="button"
              className="canvas__pick"
              onClick={() => onAdd(spec.kind)}
              title={spec.note}
              onMouseEnter={show(spec.name)}
              onFocus={show(spec.name)}
              onMouseLeave={() => setTip(null)}
              onBlur={() => setTip(null)}
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

      {/* Folded, a loop is three marks nobody can tell apart from a block.
          It keeps its words or it does not appear. */}
      {quiet === true ? null : (
        <div className="canvas__loopband">
          <h2 className="canvas__band">{canvasWords.loops}</h2>
          <ul className="canvas__list">
            {LOOPS.map((loop) => (
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
        </div>
      )}
      </aside>
    </div>
  );
}

/* ---------------------------------------------------------------- the end */

/**
 * How the run went, along the foot.
 *
 * A flow that just stops leaves you looking at cards to work out what it did.
 * This says it in one line — whole or cut short, how much of it ran, what the
 * last thing said was — and puts the whole conversation one press away.
 */
function Ended({
  ending,
  onOpenThread,
  onHide,
}: {
  ending: Ending;
  onOpenThread?: () => void;
  onHide: () => void;
}) {
  const words = canvasWords.ending;
  return (
    <aside className={`canvas__ended ${ending.whole ? 'canvas__ended--whole' : ''}`} role="status">
      <span className="canvas__endmark" aria-hidden="true">
        {ending.whole ? (
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
            <path d="m3 7.4 2.8 2.8L11 4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        ) : (
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
            <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        )}
      </span>

      <span className="canvas__endtext">
        <span className="canvas__endhead">
          <strong className="canvas__endword">{ending.whole ? words.finished : words.stopped}</strong>
          <span className="canvas__endcount">{words.ranTo(ending.ran, ending.turns)}</span>
          {ending.left.length === 0 ? null : (
            <span className="canvas__endleft">{words.left(ending.left.length)}</span>
          )}
        </span>
        {ending.last === null || ending.last.said.text.trim() === '' ? null : (
          <span className="canvas__endsaid">
            <span className="canvas__endfrom">{specOf(ending.last.block.kind).name}</span>
            {ending.last.said.text}
          </span>
        )}
      </span>

      {onOpenThread === undefined ? null : (
        <button type="button" className="canvas__endopen" onClick={onOpenThread} title={words.threadNote}>
          {words.openThread}
        </button>
      )}
      <button type="button" className="canvas__endhide" onClick={onHide} aria-label={words.hide} title={words.hide}>
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
        </svg>
      </button>
    </aside>
  );
}

/* ------------------------------------------------------------------- card */

function Card({
  block,
  rounds,
  first,
  last,
  model,
  came,
  doing,
  picked,
  target,
  held,
  onTake,
  onJoinFrom,
  onCarryOn,
}: {
  block: Placed;
  rounds: number;
  /** True where the flow begins here — several is not a mistake, they start
   *  together, but a block left unattached by accident would otherwise start
   *  on its own with nothing to say it would. */
  first: boolean;
  /** True where nothing follows it — the far end of the flow. */
  last: boolean;
  /** The model's own name, or null for whatever is answering. */
  model: string | null;
  came: BlockSaid | undefined;
  /** What this block's turn is doing right now. Only ever on the running one. */
  doing?: string;
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
      className={`canvas__card canvas__card--${block.state}${came === undefined && doing === undefined ? '' : ' canvas__card--came'}${picked ? ' canvas__card--picked' : ''}${target ? ' canvas__card--target' : ''}${held ? ' canvas__card--held' : ''}`}
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
          <span className="canvas__mark canvas__markbox" aria-hidden="true">
            <Mark kind={block.kind} />
          </span>
          <span className="canvas__kind">{spec.name}</span>
          <span className="canvas__state">{canvasWords.states[block.state]}</span>
        </span>
        <span className="canvas__says">
          {says === '' ? (spec.needsWords ? canvasWords.saySomething : spec.note) : says}
        </span>
        {block.state === 'needs-you' ? <span className="canvas__gate">{canvasWords.gateWaits}</span> : null}
        {doing === undefined ? null : <span className="canvas__doing">{doing}</span>}
        {block.state === 'running' && rounds > 1 ? (
          <span className="canvas__round">{canvasWords.round(rounds, ROUNDS)}</span>
        ) : null}
        {came === undefined ? null : <span className="canvas__came">{came.text}</span>}

        {/* Where it sits in the flow on the left, what it is set to on the
            right, so a row of cards reads down either column. What follows it
            is not said here: the lines out of the card already say that. With
            nothing to put in it the row does not draw, rather than leaving a
            rule under nothing. */}
        {!first && !last && came === undefined && model === null && (block.files ?? []).length === 0 ? null : (
        <span className="canvas__foots">
          <span className="canvas__foothalf">
            {first ? <span className="canvas__first">{canvasWords.startsHere}</span> : null}
            {last ? <span className="canvas__first">{canvasWords.ends}</span> : null}
          </span>
          <span className="canvas__foothalf canvas__foothalf--end">
            {(block.files ?? []).length === 0 ? null : (
              <span className="canvas__shots" title={canvasWords.files}>
                <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                  <path d="M3 1.75h3.25L9 4.25v6H3z" stroke="currentColor" strokeWidth="1.1" strokeLinejoin="round" />
                  <path d="M6.25 1.75v2.5H9" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
                </svg>
                {String((block.files ?? []).length)}
              </span>
            )}
            {came === undefined ? null : (
              <span className="canvas__turns">{canvasWords.turnsTook(came.turns)}</span>
            )}
            {model === null ? null : (
              <span className="canvas__model" title={model}>
                {model}
              </span>
            )}
          </span>
        </span>
        )}
      </button>

      {block.state === 'needs-you' ? (
        <button type="button" className="canvas__carryon" onClick={onCarryOn}>
          {canvasWords.carryOn}
        </button>
      ) : null}

      {/* Both ends, so what a card is waiting for and what waits for it are the
          same shape. A dot with nothing in it is an open end: the left one open
          means it starts the flow, the right one means it finishes it. */}
      <span
        className={`canvas__socket ${first ? 'canvas__socket--open' : ''}`}
        title={first ? canvasWords.startsHere : canvasWords.waitsHere}
        aria-hidden="true"
      >
        <span className="canvas__dot" />
      </span>

      <button
        type="button"
        className={`canvas__handle ${last ? 'canvas__handle--open' : ''}`}
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onJoinFrom(event);
        }}
        aria-label={canvasWords.connect}
        title={last ? canvasWords.endsNote : canvasWords.connect}
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
/** Which files a block can be given. Pictures the model looks at; text goes
 *  into the ask. Anything else has no way to reach a turn. */
const TEXT_KINDS = new Set([
  'md', 'markdown', 'txt', 'text', 'json', 'jsonl', 'csv', 'tsv', 'yml', 'yaml', 'toml', 'ini',
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h',
  'cpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'sql', 'css', 'scss', 'html', 'xml', 'svg', 'log', 'env',
  'diff', 'patch', 'lock', 'gitignore', 'dockerfile', 'makefile',
]);

export const BLOCK_TAKES = 'image/*,text/*,.md,.markdown,.txt,.json,.jsonl,.csv,.tsv,.yml,.yaml,.toml,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.sh,.sql,.css,.html,.xml,.log,.diff,.patch';

function kindOf(file: File): 'image' | 'text' | null {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('text/') || file.type === 'application/json') return 'text';
  const dot = file.name.lastIndexOf('.');
  const extension = dot === -1 ? file.name.toLowerCase() : file.name.slice(dot + 1).toLowerCase();
  return TEXT_KINDS.has(extension) ? 'text' : null;
}

async function takeFiles(files: readonly File[]): Promise<readonly BlockFile[]> {
  const taken: BlockFile[] = [];
  for (const file of files.slice(0, MOST_FILES)) {
    const kind = kindOf(file);
    if (kind === null) continue;
    const read = await new Promise<string | null>((settle) => {
      const reader = new FileReader();
      reader.onload = () => settle(typeof reader.result === 'string' ? reader.result : null);
      reader.onerror = () => settle(null);
      if (kind === 'image') reader.readAsDataURL(file);
      else reader.readAsText(file);
    });
    if (read === null || read === '') continue;
    if (kind === 'image') {
      const comma = read.indexOf(',');
      if (comma === -1) continue;
      taken.push({ name: file.name, mimeType: file.type || 'image/png', kind, bytes: read.slice(comma + 1) });
    } else {
      taken.push({ name: file.name, mimeType: file.type || 'text/plain', kind, bytes: read });
    }
  }
  return taken;
}

/** Bytes, said the way a person says them. */
function sizeOf(file: BlockFile): string {
  const bytes = file.kind === 'image' ? Math.round(file.bytes.length * 0.75) : file.bytes.length;
  if (bytes < 1024) return `${String(bytes)} B`;
  if (bytes < 1024 * 1024) return `${String(Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/* ------------------------------------------------------------------ panel */

/**
 * What the block you pressed is set to, beside the block you pressed.
 *
 * A panel down the side of the window made you look away from the thing you
 * were editing and cost the canvas 300px it needed. This opens where the card
 * is, and grows out of it — two views rather than a scroll, the same way the
 * model chip in the composer does it, because a list of forty models and a
 * paragraph of instruction cannot share one small box.
 */
function Inspector({
  block,
  flow,
  connection,
  thinking,
  onThinking,
  going,
  spot,
  onChange,
  onRemove,
  onClose,
}: {
  block: Block;
  flow: Flow;
  connection: ConnectionState | null;
  thinking: Readonly<Record<string, ThinkingLevel>>;
  onThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  going: boolean;
  spot: { x: number; y: number; side: 'left' | 'right' };
  onChange: (over: Partial<Omit<Block, 'id'>>) => void;
  onRemove: () => void;
  onClose: () => void;
}) {
  const spec = specOf(block.kind);
  const box = useRef<HTMLTextAreaElement>(null);
  const [view, setView] = useState<'block' | 'model' | 'after' | 'thinking'>('block');
  const [term, setTerm] = useState('');

  useEffect(() => {
    if (spec.needsWords && block.says.trim() === '') box.current?.focus();
  }, [block.id, block.says, spec.needsWords]);

  const offers = useMemo(() => {
    const all: {
      providerId: string;
      providerName: string;
      modelId: string;
      label: string;
      rates: { input: number; output: number } | null;
      thinking: readonly ThinkingLevel[];
    }[] = [];
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
          thinking: model.thinking ?? [],
        });
      }
    }
    return all;
  }, [connection]);

  const current = offers.find(
    (one) => block.model !== null && one.providerId === block.model.providerId && one.modelId === block.model.modelId,
  );
  /** What a block with no model of its own would actually run on. */
  const onNow =
    offers.find(
      (one) =>
        connection?.chosen != null &&
        one.providerId === connection.chosen.providerId &&
        one.modelId === connection.chosen.modelId,
    )?.label ?? null;

  const looked = term.trim().toLowerCase();
  const found = looked === '' ? offers : offers.filter(
    (one) => one.label.toLowerCase().includes(looked) || one.modelId.toLowerCase().includes(looked) || one.providerName.toLowerCase().includes(looked),
  );

  const bands = useMemo(() => {
    const tiered = byTier(found);
    if (tiered === null) return [{ name: '', models: found }];
    return tiered.map(([tier, models]) => ({ name: tierNames[tier].name, models }));
  }, [found]);

  const waits = flow.blocks.filter((one) => block.after.includes(one.id));
  /* Everything this block could be made to wait for — itself and anything that
     would close a ring are not offered, so the picker cannot draw a shape the
     board would refuse. */
  const could = flow.blocks.filter((one) => one.id !== block.id && canWaitFor(flow, block.id, one.id).ok);
  const held = block.files ?? [];
  const first = block.after.length === 0;

  /* The depths this exact model takes, and where it is set. Absent for a block
     left on whatever is answering: that is the composer's own setting, and the
     composer's own row already changes it. */
  const depths = current?.thinking ?? [];
  const depth: ThinkingLevel =
    (block.model === null ? undefined : thinking[`${block.model.providerId}/${block.model.modelId}`]) ?? 'off';
  const came = flow.said[block.id];

  return (
    <aside
      className={`canvas__panel canvas__panel--${spot.side}`}
      aria-label={spec.name}
      style={{ left: spot.x, top: spot.y, width: PANEL.width } as CSSProperties}
    >
      <header className="canvas__ihead">
        {view === 'block' ? null : (
          <button type="button" className="canvas__iback" onClick={() => setView('block')}>
            <span aria-hidden="true">‹</span> {spec.name}
          </button>
        )}
        {view !== 'block' ? null : (
          <>
            <span className="canvas__imark" aria-hidden="true">
              <Mark kind={block.kind} />
            </span>
            <h2 className="canvas__iname">{spec.name}</h2>
          </>
        )}
        <button type="button" className="canvas__ishut" onClick={onClose} aria-label={canvasWords.shut}>
          <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
            <path d="M4.2 4.2l5.6 5.6M9.8 4.2l-5.6 5.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {view === 'thinking' ? (
        <div className="canvas__ibody scroll--auto">
          <span className="canvas__ilabel">{canvasWords.thinkingNote}</span>
          <div className="canvas__imodels" role="listbox" aria-label={canvasWords.thinking}>
            {depths.map((level) => (
              <button
                key={level}
                type="button"
                role="option"
                aria-selected={level === depth}
                className={`canvas__imodel ${level === depth ? 'canvas__imodel--on' : ''}`}
                onClick={() => {
                  if (block.model !== null) onThinking?.(block.model, level);
                  setView('block');
                }}
              >
                {thinkingLevels[level].name}
                <span className="canvas__isays2">{thinkingLevels[level].note}</span>
              </button>
            ))}
          </div>
        </div>
      ) : view === 'after' ? (
        <div className="canvas__ibody scroll--auto">
          {/* Several, not one: it begins when the last of them has finished.
              The list stays open, because picking two is two presses. */}
          <span className="canvas__ilabel">{canvasWords.afterWhich}</span>
          <div className="canvas__imodels" role="listbox" aria-multiselectable="true" aria-label={canvasWords.afterWhich}>
            <button
              type="button"
              role="option"
              aria-selected={first}
              className={`canvas__imodel ${first ? 'canvas__imodel--on' : ''}`}
              onClick={() => onChange({ after: [] })}
            >
              {canvasWords.nothing}
            </button>
            {could.map((one) => {
              const on = block.after.includes(one.id);
              return (
                <button
                  key={one.id}
                  type="button"
                  role="option"
                  aria-selected={on}
                  className={`canvas__imodel ${on ? 'canvas__imodel--on' : ''}`}
                  onClick={() =>
                    onChange({
                      after: on
                        ? block.after.filter((was) => was !== one.id)
                        : [...block.after, one.id],
                    })
                  }
                >
                  {specOf(one.kind).name}
                  <span className="canvas__isays2">{one.says.trim() === '' ? specOf(one.kind).note : one.says.trim()}</span>
                </button>
              );
            })}
          </div>
        </div>
      ) : view === 'model' ? (
        <div className="canvas__ibody scroll--auto">
          <input
            className="canvas__isearch"
            value={term}
            autoFocus
            placeholder={canvasWords.findModel}
            aria-label={canvasWords.findModel}
            onChange={(event) => setTerm(event.target.value)}
          />
          <div className="canvas__imodels" role="listbox" aria-label={canvasWords.model}>
            <button
              type="button"
              role="option"
              aria-selected={block.model === null}
              className={`canvas__imodel ${block.model === null ? 'canvas__imodel--on' : ''}`}
              onClick={() => {
                onChange({ model: null });
                setView('block');
              }}
            >
              {canvasWords.whichever}
              <span className="canvas__isays2">{canvasWords.whicheverNote(onNow)}</span>
            </button>
            {bands.map((band) => (
              <div key={band.name || 'all'} className="canvas__itier">
                {band.name === '' ? null : <span className="canvas__itiername">{band.name}</span>}
                {band.models.map((one) => {
                  const on = block.model !== null && block.model.providerId === one.providerId && block.model.modelId === one.modelId;
                  return (
                    <button
                      key={`${one.providerId}/${one.modelId}`}
                      type="button"
                      role="option"
                      aria-selected={on}
                      className={`canvas__imodel ${on ? 'canvas__imodel--on' : ''}`}
                      title={`${one.providerName} · ${one.modelId}`}
                      onClick={() => {
                        onChange({ model: { providerId: one.providerId, modelId: one.modelId } });
                        setView('block');
                      }}
                    >
                      {one.label}
                    </button>
                  );
                })}
              </div>
            ))}
            {found.length === 0 ? <p className="canvas__inone">{canvasWords.noModel}</p> : null}
          </div>
        </div>
      ) : (
        <div className="canvas__ibody scroll--auto">
          {/* First once it has run: somebody opening a finished block came to
              read what it came to, not what it was asked. */}
          {came === undefined ? null : (
            <>
              <span className="canvas__ilabel">
                {canvasWords.came}
                <span className="canvas__iturns">{canvasWords.turnsTook(came.turns)}</span>
              </span>
              <p className="canvas__icame">{came.text === '' ? canvasWords.nothingYet : came.text}</p>
            </>
          )}

          <label className="canvas__ilabel" htmlFor="canvas-says">{canvasWords.what}</label>
          <textarea
            id="canvas-says"
            ref={box}
            className="canvas__isays"
            rows={3}
            value={block.says}
            disabled={going}
            placeholder={spec.needsWords ? 'Tighten the nav on mobile' : spec.says}
            onChange={(event) => onChange({ says: event.target.value })}
          />

          {/* One band of rows, all the same shape, so what a block is set to
              reads as a list rather than as four different controls. */}
          <div className="canvas__irows">
            <button type="button" className="canvas__irow" onClick={() => setView('model')} disabled={going}>
              <span className="canvas__irowname">{canvasWords.model}</span>
              <span className="canvas__irowvalue">{current?.label ?? canvasWords.whichever}</span>
              <span className="canvas__irowmore" aria-hidden="true">›</span>
            </button>

            {depths.length > 1 && onThinking !== undefined && current !== undefined ? (
              <button type="button" className="canvas__irow" onClick={() => setView('thinking')} disabled={going}>
                <span className="canvas__irowname">{canvasWords.thinking}</span>
                <span className="canvas__irowvalue">{thinkingLevels[depth].name}</span>
                <span className="canvas__irowmore" aria-hidden="true">›</span>
              </button>
            ) : null}

            <button type="button" className="canvas__irow" onClick={() => setView('after')} disabled={going}>
              <span className="canvas__irowname">{canvasWords.waitsFor}</span>
              <span className="canvas__irowvalue">
                {waits.length === 0
                  ? canvasWords.nothingBefore
                  : waits.map((one) => specOf(one.kind).name).join(', ')}
              </span>
              <span className="canvas__irowmore" aria-hidden="true">›</span>
            </button>

            <label className="canvas__irow canvas__irow--switch">
              <span className="canvas__irowname">{canvasWords.lookFirst}</span>
              <span className="canvas__irownote">{canvasWords.lookFirstNote}</span>
              <input
                type="checkbox"
                className="canvas__iswitch"
                checked={block.lookFirst === true}
                disabled={going}
                onChange={(event) => onChange({ lookFirst: event.target.checked })}
              />
              <span className="canvas__itrack" aria-hidden="true" />
            </label>
          </div>
          <span className="canvas__ilabel">
            {canvasWords.files}
            {held.length === 0 ? null : <span className="canvas__iturns">{canvasWords.filesCount(held.length)}</span>}
          </span>

          <div className="canvas__ifiles">
            {held.map((file, at) => (
              <span className={`canvas__ifile canvas__ifile--${file.kind}`} key={`${file.name}-${String(at)}`}>
                {file.kind === 'image' ? (
                  <img className="canvas__ithumb" src={`data:${file.mimeType};base64,${file.bytes}`} alt="" />
                ) : (
                  <span className="canvas__ithumb canvas__ithumb--text" aria-hidden="true">
                    <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
                      <path d="M3.5 1.75h4.25L11 5v7.25H3.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
                      <path d="M7.75 1.75V5H11M5.25 7.5h4M5.25 9.75h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                    </svg>
                  </span>
                )}
                <span className="canvas__ifiletext">
                  <span className="canvas__ifilename">{file.name}</span>
                  <span className="canvas__ifilesize">{sizeOf(file)}</span>
                </span>
                <button
                  type="button"
                  className="canvas__ifileoff"
                  disabled={going}
                  aria-label={canvasWords.takeOff(file.name)}
                  onClick={() => onChange({ files: held.filter((_, index) => index !== at) })}
                >
                  <svg viewBox="0 0 12 12" width="9" height="9" fill="none" aria-hidden="true">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </span>
            ))}
            {held.length >= MOST_FILES ? null : (
              <label className={`canvas__iattach ${going ? 'canvas__iattach--off' : ''}`}>
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
                  <path d="M7 2.5v9M2.5 7h9" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                </svg>
                {canvasWords.attach}
                <input
                  type="file"
                  accept={BLOCK_TAKES}
                  multiple
                  disabled={going}
                  onChange={(event) => {
                    const picked = [...(event.target.files ?? [])];
                    event.target.value = '';
                    void takeFiles(picked).then((taken) => {
                      if (taken.length === 0) return;
                      onChange({ files: [...held, ...taken].slice(0, MOST_FILES) });
                    });
                  }}
                />
              </label>
            )}
          </div>

        </div>
      )}

      {/* Outside the body, which scrolls: Remove is the one press in here that
          cannot be found by scrolling for it. */}
      {view !== 'block' ? null : (
        <footer className="canvas__ifoot">
          {first ? <span className="canvas__iwaits">{canvasWords.startsHere}</span> : <span />}
          <button type="button" className="canvas__iremove" onClick={onRemove} disabled={going}>
            <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
              <path d="M2.6 4.2h8.8M5.6 4.2V2.9h2.8v1.3M3.9 4.2l.5 7h5.2l.5-7M6 6.3v3M8 6.3v3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            {canvasWords.remove}
            <kbd className="canvas__ikey">⌫</kbd>
          </button>
        </footer>
      )}
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
