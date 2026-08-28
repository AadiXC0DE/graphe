import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  canvasWords,
  canWaitFor,
  layOut,
  STARTERS,
  STEP_KINDS,
  stepKind,
  waitingOn,
  type Starter,
  type Step,
  type StepKindId,
} from '../work/canvas';
import { saysWhen } from '../work/board';
import type { AwayPiece } from '../lib/ipc';
import './Sheet.css';
import './CanvasView.css';

/** The card, and the room around it. Fixed, so a chain reads as a rhythm
 *  rather than as boxes of different sizes in a row. */
const CARD = { width: 208, height: 104, gapX: 76, gapY: 20 } as const;
const ZOOM = { least: 0.5, most: 1.4, step: 0.15 } as const;
/** Further than this and the hand meant to draw a line, not to press. */
const MOVED = 4;
/** The menu of steps, at its tallest. It never grows past this — see the cap in
 *  the stylesheet — so a step near the bottom edge still opens whole. */
const MENU = { width: 264, height: 400 } as const;

type Props = {
  pieces: readonly AwayPiece[];
  now: number;
  onClose: () => void;
  /** Put a step on the board, waiting for another or for nothing. Answers with
   *  its id, so a whole loop can be chained as it goes down. */
  onAdd: (asks: string, after: string | null) => Promise<string | null>;
  /** Change or clear what one step waits for. */
  onConnect: (id: string, after: string | null) => void;
  onDrop: (id: string) => void;
  onAnswer: (callId: string, say: 'yes' | 'no') => void;
};

const SAYS = {
  close: 'Close',
  zoomIn: 'Closer',
  zoomOut: 'Further out',
  fit: 'Fit',
  drop: 'Throw away',
  free: 'Start it now instead',
  yes: 'Yes',
  no: 'No',
  what: 'What should it do?',
  place: 'Place it',
  cancel: 'Cancel',
} as const;

function asStep(piece: AwayPiece): Step {
  return {
    id: piece.id,
    doing: piece.doing,
    state: piece.state,
    at: piece.at,
    after: piece.after?.id ?? null,
    says: piece.says,
    trouble: piece.trouble,
    asking: piece.question !== null,
  };
}

/**
 * The board, drawn as the graph it already is.
 *
 * The sheet of cards next to the conversation answers "what came of it" — every
 * card is its own picture. This answers the other question: what waits for
 * what, and where the work is up to along the line. So there are no pictures
 * here and the cards are all one size; the shape is the subject.
 *
 * Nothing on this surface starts a second kind of work. A step placed here goes
 * on the same board, behind the same ceiling, in the same queue — which is what
 * keeps a drawn loop from being a way round any of it.
 */
export default function CanvasView({ pieces, now, onClose, onAdd, onConnect, onDrop, onAnswer }: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const surface = useRef<HTMLDivElement>(null);

  const steps = useMemo(() => pieces.map(asStep), [pieces]);
  const flow = useMemo(() => layOut(steps), [steps]);

  const [at, setAt] = useState({ x: 0, y: 0, scale: 1 });
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{
    after: string | null;
    kind: StepKindId | null;
    /** Where on the surface it was asked for, so the menu opens beside the dot
     *  that opened it rather than in a corner. Null centres it. */
    spot: { x: number; y: number } | null;
  } | null>(null);
  const [words, setWords] = useState('');
  const [joining, setJoining] = useState<{
    from: string;
    x: number;
    y: number;
    /** Where it started, so a press can be told from a drag. */
    fromX: number;
    fromY: number;
  } | null>(null);
  const [refused, setRefused] = useState<string | null>(null);

  const panning = useRef<{ x: number; y: number; fromX: number; fromY: number } | null>(null);
  /* A press on the dot adds a step; a drag from it draws a line. The browser
     sends a click after either, so the drag has to say it happened. */
  const dragged = useRef(false);

  useEffect(() => {
    shut.current?.focus();
  }, []);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // One press peels one layer, so nothing shuts the whole surface by
      // surprise while a box is open on top of it.
      if (adding !== null) {
        event.stopPropagation();
        setAdding(null);
        return;
      }
      if (open !== null) {
        event.stopPropagation();
        setOpen(null);
        return;
      }
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [adding, open, onClose]);

  /* The one message the surface puts in front of somebody — why a line they
     dragged was not taken. Cleared on its own; a refusal that stays is read as
     a state rather than as an answer. */
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
      width: Math.max(1, flow.columns) * (CARD.width + CARD.gapX) - CARD.gapX,
      height: Math.max(1, flow.rows) * (CARD.height + CARD.gapY) - CARD.gapY,
    }),
    [flow.columns, flow.rows],
  );

  const fit = useCallback(() => {
    const box = surface.current?.getBoundingClientRect();
    if (box === undefined) return;
    const room = { width: box.width - 96, height: box.height - 96 };
    const scale = Math.min(1, room.width / size.width, room.height / size.height);
    const kept = Math.max(ZOOM.least, Math.min(ZOOM.most, scale));
    setAt({
      x: Math.max(48, (box.width - size.width * kept) / 2),
      y: Math.max(48, (box.height - size.height * kept) / 2),
      scale: kept,
    });
  }, [size.width, size.height]);

  /* Framed once, when there is something to frame. After that the view is
     theirs: re-centring under somebody who has just panned somewhere is the
     surest way to make a canvas feel like it is fighting back. */
  const framed = useRef(false);
  useEffect(() => {
    if (framed.current || flow.steps.length === 0) return;
    framed.current = true;
    fit();
  }, [fit, flow.steps.length]);

  const zoom = useCallback((by: number, about?: { x: number; y: number }) => {
    setAt((was) => {
      const next = Math.max(ZOOM.least, Math.min(ZOOM.most, was.scale + by));
      if (next === was.scale) return was;
      const point = about ?? { x: 0, y: 0 };
      const ratio = next / was.scale;
      return {
        scale: next,
        x: point.x - (point.x - was.x) * ratio,
        y: point.y - (point.y - was.y) * ratio,
      };
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
      // Capturing the pointer is what keeps a pan going past the window's edge,
      // and it also retargets the release — so anything pressable inside the
      // surface never sees its own click unless the pan declines to start.
      if ((event.target as Element).closest('button, input, textarea, a, .canvas__card, .canvas__adder') !== null) {
        return;
      }
      setOpen(null);
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
        if (Math.abs(x - joining.fromX) > MOVED || Math.abs(y - joining.fromY) > MOVED) {
          dragged.current = true;
        }
        setJoining({ ...joining, x, y });
        return;
      }
      const held = panning.current;
      if (held === null) return;
      setAt((was) => ({
        ...was,
        x: held.fromX + (event.clientX - held.x),
        y: held.fromY + (event.clientY - held.y),
      }));
    },
    [joining],
  );

  const endPan = useCallback(() => {
    panning.current = null;
  }, []);

  /* The card a line was drawn from can finish or be thrown away mid-drag, and
     the release then lands on nothing. Without this the dashed line stays on
     screen and the surface never pans again. */
  const lostIt = useCallback(() => {
    panning.current = null;
    setJoining(null);
  }, []);

  /** Let a line go. Over a card it becomes a wait; anywhere else it is dropped. */
  const endJoin = useCallback(
    (event: Pressed) => {
      const from = joining?.from ?? null;
      setJoining(null);
      if (from === null) return;
      const card = document.elementFromPoint(event.clientX, event.clientY)?.closest('.canvas__card');
      const onto = card?.getAttribute('data-step') ?? null;
      if (onto === null || onto === from) return;
      const said = canWaitFor(steps, onto, from);
      if (!said.ok) {
        setRefused(said.because);
        return;
      }
      onConnect(onto, from);
    },
    [joining, onConnect, steps],
  );

  /** Where a menu opened from one card's dot should sit: just past it, and
   *  never off the edge of the surface. */
  const beside = useCallback(
    (spot: { x: number; y: number }) => {
      const box = surface.current?.getBoundingClientRect();
      const x = at.x + (spot.x + CARD.width + 20) * at.scale;
      const y = at.y + spot.y * at.scale;
      const room = { across: box?.width ?? MENU.width * 3, down: box?.height ?? MENU.height * 2 };
      return {
        x: Math.max(16, Math.min(x, room.across - MENU.width - 16)),
        y: Math.max(16, Math.min(y, room.down - MENU.height - 16)),
      };
    },
    [at.x, at.y, at.scale],
  );

  const place = useCallback(
    async (kind: StepKindId, after: string | null, about: string) => {
      setAdding(null);
      setWords('');
      await onAdd(stepKind(kind).asks(about), after);
    },
    [onAdd],
  );

  const placeStarter = useCallback(
    async (starter: Starter, about: string) => {
      setAdding(null);
      setWords('');
      // Chained as they go down, so each one is asked to wait for the id the
      // board actually gave the one before it rather than for a guess.
      const made: (string | null)[] = [];
      for (const one of starter.steps) {
        if (one.after !== null && (made[one.after] ?? null) === null) {
          setRefused(canvasWords.brokeOff);
          return;
        }
        made.push(await onAdd(stepKind(one.kind).asks(about), one.after === null ? null : made[one.after]!));
      }
    },
    [onAdd],
  );

  return (
    <section className="sheet canvas" aria-label={canvasWords.name}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{canvasWords.name}</h1>
          <p className="sheet__from">
            {flow.steps.length === 0
              ? canvasWords.note
              : canvasWords.counted(
                  flow.steps.length,
                  flow.steps.filter((one) => one.state === 'running').length,
                )}
          </p>
        </div>

        <div className="sheet__chips" />

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div
        className="canvas__surface"
        ref={surface}
        onPointerDown={startPan}
        onPointerMove={movePan}
        onPointerUp={(event) => {
          endPan();
          endJoin(event);
        }}
        onPointerCancel={lostIt}
        onLostPointerCapture={lostIt}
      >
        {flow.steps.length === 0 ? (
          <Nothing
            onBlank={() => setAdding({ after: null, kind: 'work', spot: null })}
            onPick={(starter, about) => void placeStarter(starter, about)}
          />
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
              {flow.steps.map((step) => {
                const parent = flow.steps.find((one) => one.id === step.after);
                if (parent === undefined) return null;
                const from = where(parent.column, parent.row);
                const to = where(step.column, step.row);
                const x1 = from.x + CARD.width;
                const y1 = from.y + CARD.height / 2;
                const x2 = to.x;
                const y2 = to.y + CARD.height / 2;
                const bend = Math.max(28, (x2 - x1) / 2);
                // The line into work that is going wears the accent: one thing
                // at a time is coloured, and this is the thing.
                const live = step.state === 'running' || step.state === 'needs-you';
                return (
                  <path
                    key={`${parent.id}-${step.id}`}
                    className={`canvas__line ${live ? 'canvas__line--live' : ''}`}
                    d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(x2 - bend)} ${String(y2)}, ${String(x2)} ${String(y2)}`}
                    fill="none"
                  />
                );
              })}
            </svg>

            {flow.steps.map((step) => {
              const spot = where(step.column, step.row);
              const behind = waitingOn(steps, step.id).length;
              const piece = pieces.find((one) => one.id === step.id) ?? null;
              return (
                <Card
                  key={step.id}
                  step={step}
                  piece={piece}
                  now={now}
                  behind={behind}
                  at={spot}
                  open={open === step.id}
                  joining={joining !== null && joining.from !== step.id}
                  onOpen={() => setOpen((was) => (was === step.id ? null : step.id))}
                  onAdd={() => {
                    // The click that follows a drag is the browser's, not
                    // somebody asking for a step.
                    if (dragged.current) {
                      dragged.current = false;
                      return;
                    }
                    setAdding({ after: step.id, kind: null, spot: beside(spot) });
                  }}
                  onDrop={() => onDrop(step.id)}
                  onFree={() => onConnect(step.id, null)}
                  onAnswer={onAnswer}
                  onJoinFrom={(event) => {
                    const box = surface.current?.getBoundingClientRect();
                    if (box === undefined) return;
                    const x = event.clientX - box.left;
                    const y = event.clientY - box.top;
                    dragged.current = false;
                    setJoining({ from: step.id, x, y, fromX: x, fromY: y });
                  }}
                />
              );
            })}
          </div>
        )}

        {joining === null ? null : <Trailing from={joining} where={where} flow={flow} at={at} />}

        {adding === null ? null : (
          <Adding
            spot={adding.spot}
            kind={adding.kind}
            words={words}
            onWords={setWords}
            onKind={(kind) => setAdding({ ...adding, kind })}
            onPlace={(kind, about) => void place(kind, adding.after, about)}
            onCancel={() => {
              setAdding(null);
              setWords('');
            }}
          />
        )}

        {flow.steps.length === 0 ? null : (
          <div className="canvas__foot">
            {refused === null ? <span className="canvas__hint">{canvasWords.connect}</span> : (
              <span className="canvas__refused" role="status">
                {refused}
              </span>
            )}
            <div className="canvas__zoom">
              <button type="button" className="canvas__zoombtn" onClick={() => zoom(-ZOOM.step)} aria-label={SAYS.zoomOut}>
                −
              </button>
              <button type="button" className="canvas__fit" onClick={fit}>
                {SAYS.fit}
              </button>
              <button type="button" className="canvas__zoombtn" onClick={() => zoom(ZOOM.step)} aria-label={SAYS.zoomIn}>
                +
              </button>
            </div>
          </div>
        )}
      </div>

    </section>
  );
}

/* ------------------------------------------------------------------- card */

function Card({
  step,
  piece,
  now,
  behind,
  at,
  open,
  joining,
  onOpen,
  onAdd,
  onDrop,
  onFree,
  onAnswer,
  onJoinFrom,
}: {
  step: Step & { column: number; row: number };
  piece: AwayPiece | null;
  now: number;
  behind: number;
  at: { x: number; y: number };
  open: boolean;
  joining: boolean;
  onOpen: () => void;
  onAdd: () => void;
  onDrop: () => void;
  onFree: () => void;
  onAnswer: (callId: string, say: 'yes' | 'no') => void;
  onJoinFrom: (event: Pressed) => void;
}) {
  const question = piece?.question ?? null;
  return (
    <div
      className={`canvas__card canvas__card--${step.state}${open ? ' canvas__card--open' : ''}${joining ? ' canvas__card--target' : ''}`}
      data-step={step.id}
      style={
        {
          left: at.x,
          top: at.y,
          width: CARD.width,
          minHeight: CARD.height,
          // So the dot sits exactly where the line into the next step leaves.
          '--canvas-card': `${String(CARD.height)}px`,
        } as CSSProperties
      }
    >
      {step.state === 'running' ? <span className="canvas__sweep" aria-hidden="true" /> : null}

      <button type="button" className="canvas__face" onClick={onOpen} aria-expanded={open}>
        <span className="canvas__state">{canvasWords.states[step.state]}</span>
        <span className="canvas__doing">{step.doing}</span>
        <span className="canvas__when">
          {behind > 0 && step.state !== 'done' ? canvasWords.holdingUp(behind) : saysWhen(step.at, now)}
        </span>
      </button>

      {open ? (
        <div className="canvas__more">
          {question !== null ? (
            <div className="canvas__asking">
              <p className="canvas__question">{question.question}</p>
              <div className="canvas__answers">
                <button type="button" className="canvas__yes" onClick={() => onAnswer(question.callId, 'yes')}>
                  {SAYS.yes}
                </button>
                <button type="button" className="canvas__no" onClick={() => onAnswer(question.callId, 'no')}>
                  {SAYS.no}
                </button>
              </div>
            </div>
          ) : null}

          {step.trouble !== null ? <p className="canvas__said">{step.trouble}</p> : null}
          {step.trouble === null && step.says !== null ? <p className="canvas__said">{step.says}</p> : null}

          <div className="canvas__acts">
            {step.after !== null && step.state === 'waiting' ? (
              <button type="button" className="canvas__act" onClick={onFree}>
                {SAYS.free}
              </button>
            ) : null}
            <button type="button" className="canvas__act canvas__act--away" onClick={onDrop}>
              {SAYS.drop}
            </button>
          </div>
        </div>
      ) : null}

      {/* Where the next step goes, and where a line is dragged from. One dot,
          two gestures: press for the ordinary way, drag for the other. */}
      <button
        type="button"
        className="canvas__handle"
        onClick={onAdd}
        onPointerDown={(event) => {
          event.stopPropagation();
          event.currentTarget.setPointerCapture(event.pointerId);
          onJoinFrom(event);
        }}
        aria-label={canvasWords.add}
        title={`${canvasWords.add} · ${canvasWords.connect}`}
      >
        <svg viewBox="0 0 12 12" width="10" height="10" fill="none" aria-hidden="true">
          <path d="M6 2.5v7M2.5 6h7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </div>
  );
}

/** The line while it is still in somebody's hand. */
function Trailing({
  from,
  where,
  flow,
  at,
}: {
  from: { from: string; x: number; y: number };
  where: (column: number, row: number) => { x: number; y: number };
  flow: ReturnType<typeof layOut>;
  at: { x: number; y: number; scale: number };
}) {
  const parent = flow.steps.find((one) => one.id === from.from);
  if (parent === undefined) return null;
  const spot = where(parent.column, parent.row);
  const x1 = at.x + (spot.x + CARD.width) * at.scale;
  const y1 = at.y + (spot.y + CARD.height / 2) * at.scale;
  const bend = Math.max(28, Math.abs(from.x - x1) / 2);
  return (
    <svg className="canvas__trailing" aria-hidden="true">
      <path
        d={`M ${String(x1)} ${String(y1)} C ${String(x1 + bend)} ${String(y1)}, ${String(from.x - bend)} ${String(from.y)}, ${String(from.x)} ${String(from.y)}`}
        fill="none"
      />
    </svg>
  );
}

/* --------------------------------------------------------------- placing */

function Adding({
  spot,
  kind,
  words,
  onWords,
  onKind,
  onPlace,
  onCancel,
}: {
  spot: { x: number; y: number } | null;
  kind: StepKindId | null;
  words: string;
  onWords: (words: string) => void;
  onKind: (kind: StepKindId) => void;
  onPlace: (kind: StepKindId, about: string) => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (kind !== null) box.current?.focus();
  }, [kind]);

  const wanted = kind === null ? null : stepKind(kind);
  const ready = wanted !== null && (!wanted.needsWords || words.trim() !== '');

  return (
    <div
      className={`canvas__adder ${spot === null ? 'canvas__adder--middle' : ''}`}
      role="dialog"
      aria-label={canvasWords.add}
      style={spot === null ? undefined : { left: spot.x, top: spot.y }}
    >
      {kind === null ? (
        <ul className="canvas__kinds">
          {STEP_KINDS.map((one) => (
            <li key={one.id}>
              <button type="button" className="canvas__kind" onClick={() => onKind(one.id)}>
                <span className="canvas__kindname">{one.name}</span>
                <span className="canvas__kindnote">{one.note}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <form
          className="canvas__what"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onPlace(kind, words);
          }}
        >
          <label className="canvas__label" htmlFor="canvas-what">
            {wanted?.needsWords === true ? SAYS.what : wanted?.name}
          </label>
          <input
            id="canvas-what"
            ref={box}
            className="canvas__box"
            value={words}
            placeholder={wanted?.needsWords === true ? 'Tighten the nav on mobile' : wanted?.note}
            onChange={(event) => onWords(event.target.value)}
          />
          <div className="canvas__acts">
            <button type="button" className="canvas__act" onClick={onCancel}>
              {SAYS.cancel}
            </button>
            <button type="submit" className="canvas__place" disabled={!ready}>
              {SAYS.place}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

/* --------------------------------------------------------------- nothing */

function Nothing({
  onBlank,
  onPick,
}: {
  onBlank: () => void;
  onPick: (starter: Starter, about: string) => void;
}) {
  const [chosen, setChosen] = useState<Starter | null>(null);
  const [words, setWords] = useState('');
  const box = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (chosen !== null) box.current?.focus();
  }, [chosen]);

  return (
    <div className="canvas__nothing">
      <h2 className="canvas__nothingtitle">{canvasWords.empty}</h2>
      <p className="canvas__nothingnote">{canvasWords.emptyNote}</p>

      {chosen === null ? (
        <>
          <ul className="canvas__starters">
            {STARTERS.map((starter) => (
              <li key={starter.id}>
                <button type="button" className="canvas__starter" onClick={() => setChosen(starter)}>
                  <span className="canvas__startername">{starter.name}</span>
                  <span className="canvas__starternote">{starter.note}</span>
                  <span className="canvas__starterline" aria-hidden="true">
                    {starter.steps.map((one, index) => (
                      <Fragment key={`${one.kind}-${String(index)}`}>
                        {index === 0 ? null : <span className="canvas__starterarrow">→</span>}
                        <span className="canvas__starterstep">{stepKind(one.kind).name}</span>
                      </Fragment>
                    ))}
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button type="button" className="canvas__blank" onClick={onBlank}>
            {canvasWords.blank}
          </button>
        </>
      ) : (
        <form
          className="canvas__what canvas__what--wide"
          onSubmit={(event) => {
            event.preventDefault();
            if (words.trim() !== '') onPick(chosen, words);
          }}
        >
          <label className="canvas__label" htmlFor="canvas-starter">
            {SAYS.what}
          </label>
          <input
            id="canvas-starter"
            ref={box}
            className="canvas__box"
            value={words}
            placeholder="Tighten the nav on mobile"
            onChange={(event) => setWords(event.target.value)}
          />
          <div className="canvas__acts">
            <button type="button" className="canvas__act" onClick={() => setChosen(null)}>
              {SAYS.cancel}
            </button>
            <button type="submit" className="canvas__place" disabled={words.trim() === ''}>
              {SAYS.place}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
