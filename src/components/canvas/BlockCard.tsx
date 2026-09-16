/** One block, drawn.
 *
 * A card is a button: the whole face is what a hand presses to pick it, and
 * what the keyboard lands on. The presses that do something else live beside it
 * rather than inside it, because a button inside a button is not one.
 */

import type { CSSProperties, PointerEvent as Pressed } from 'react';
import {
  CARD,
  canvasWords,
  lineState,
  specOf,
  type BlockKind,
  type BlockModel,
  type BlockRun,
  type Placed,
} from '../../work/canvas';
import type { ConnectionState } from '../../lib/ipc';
import { formatMoney } from '../../cost/money';
import { durationInWords } from '../../lib/when';

/** One mark per kind. A row of identical cards is a list; the mark is what
 *  makes a flow readable at a glance without reading a word of it. */
export function Mark({ kind }: { kind: BlockKind }) {
  const line = {
    stroke: 'currentColor',
    strokeWidth: 1.5,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  switch (kind) {
    case 'plan':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="7" cy="7" r="4.25" {...line} />
          <path d="M10.2 10.2 13.5 13.5" {...line} />
        </svg>
      );
    case 'goal':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" {...line} />
          <circle cx="8" cy="8" r="2.5" {...line} />
        </svg>
      );
    case 'gate':
      return (
        <svg viewBox="0 0 16 16" width="15" height="15" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="5.75" {...line} />
          <path d="M8 4.6V8l2.4 1.6" {...line} />
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
          <path
            
            d="M13.5 8.2c0 2.6-2.5 4.6-5.5 4.6a6.7 6.7 0 0 1-1.7-.2L3 13.8l.8-2.3A4.4 4.4 0 0 1 2.5 8.2c0-2.6 2.5-4.6 5.5-4.6s5.5 2 5.5 4.6Z"
            {...line}
          />
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

/** A model's own name rather than the id it is addressed by, or null for a
 *  block on the flow's default. */
export function modelWord(choice: BlockModel, connection: ConnectionState | null): string | null {
  if (choice === null) return null;
  for (const provider of connection?.providers ?? []) {
    for (const model of provider.models) {
      if (provider.providerId === choice.providerId && model.id === choice.modelId) return model.label;
    }
  }
  return choice.modelId;
}

/** Where a line leaves one card and where it arrives at the next. The card
 *  knows its own edges, so the two ends are named here rather than in the sheet
 *  that happens to draw them. */
export function leaves(block: { x: number; y: number }) {
  return { x: block.x + CARD.width, y: block.y + CARD.height / 2 };
}

export function arrives(block: { x: number; y: number }) {
  return { x: block.x - 9, y: block.y + CARD.height / 2 };
}

/**
 * One line between two cards.
 *
 * The bend grows with the gap, so a long run is a gentle curve and a short one
 * is nearly straight; a card dragged behind the one it follows gets a loop
 * rather than a line through its own middle.
 */
export function line(from: { x: number; y: number }, to: { x: number; y: number }): string {
  const across = to.x - from.x;
  const bend = across > 0 ? Math.max(30, across * 0.45) : Math.max(60, Math.abs(across) * 0.5 + 40);
  return `M ${String(from.x)} ${String(from.y)} C ${String(from.x + bend)} ${String(from.y)}, ${String(to.x - bend)} ${String(to.y)}, ${String(to.x)} ${String(to.y)}`;
}

/** The line while it is still in somebody's hand. */
export function Trailing({
  from,
  blocks,
  at,
}: {
  from: { from: string; x: number; y: number };
  blocks: readonly { id: string; x: number; y: number }[];
  at: { x: number; y: number; scale: number };
}) {
  const parent = blocks.find((one) => one.id === from.from);
  if (parent === undefined) return null;
  const start = leaves(parent);
  return (
    <svg className="canvas__trailing" aria-hidden="true">
      <path
        d={line(
          { x: at.x + start.x * at.scale, y: at.y + start.y * at.scale },
          { x: from.x, y: from.y },
        )}
        fill="none"
      />
    </svg>
  );
}

/** Where the panel for a card goes: beside it, on whichever side has room and
 *  never off the window. Arithmetic against the card, so it lives with the card's
 *  own size rather than in the frame that happens to draw it. */
export function beside(
  block: { x: number; y: number },
  at: { x: number; y: number; scale: number },
  panel: { width: number; height: number },
  room: { across: number; down: number },
): { x: number; y: number; side: 'left' | 'right' } {
  const right = at.x + (block.x + CARD.width + 14) * at.scale;
  const left = at.x + (block.x - panel.width - 14) * at.scale;
  const x = right + panel.width + 16 <= room.across ? right : Math.max(16, left);
  const y = at.y + block.y * at.scale;
  return {
    x: Math.max(16, Math.min(x, Math.max(16, room.across - panel.width - 16))),
    y: Math.max(16, Math.min(y, Math.max(16, room.down - panel.height - 16))),
    side: x === right ? 'right' : 'left',
  };
}

/**
 * Every wait, drawn once.
 *
 * One curve out of the right of a card into the left of the next, however the
 * two are arranged. It lives here with the geometry it draws, rather than in the
 * surface that happens to hold it: the shape of a line is a fact about cards.
 */
export function Edges({
  blocks,
  chosen,
  onPick,
}: {
  blocks: readonly Placed[];
  chosen: { parent: string; child: string } | null;
  onPick: (line: { parent: string; child: string }) => void;
}) {
  return (
    <svg className="canvas__lines" aria-hidden="true" overflow="visible">
      <defs>
        <marker id="canvas-tip" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="7" markerHeight="7" orient="auto">
          <path d="M1.5 1.5 5.5 4 1.5 6.5" fill="none" stroke="context-stroke" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
        </marker>
      </defs>
      {/* One line per wait: a block after two things has two lines into it. */}
      {blocks.flatMap((block) =>
        block.after.map((was) => {
          const parent = blocks.find((one) => one.id === was);
          if (parent === undefined) return null;
          const doing = lineState(parent.state, block.state);
          const path = line(leaves(parent), arrives(block));
          const on = chosen?.parent === parent.id && chosen.child === block.id;
          return (
            <g key={`${parent.id}-${block.id}`}>
              <path
                className={`canvas__line ${doing === 'passed' ? 'canvas__line--passed' : ''} ${on ? 'canvas__line--chosen' : ''}`}
                d={path}
                fill="none"
                markerEnd="url(#canvas-tip)"
              />
              {/* A slow drift along the line: which way the work goes. */}
              {doing === 'idle' ? <path className="canvas__drift" d={path} fill="none" /> : null}
              {doing === 'live' ? <path className="canvas__flow" d={path} fill="none" /> : null}
              {/* A wide invisible copy: 1.5px is not a hand's target. */}
              <path
                className="canvas__grab"
                d={path}
                fill="none"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  onPick({ parent: parent.id, child: block.id });
                }}
              />
            </g>
          );
        }),
      )}
    </svg>
  );
}

type Props = {
  block: Placed;
  /** What it came to in the run being shown, or null before anything ran. */
  run: BlockRun | null;
  /** The block's own model, named. Null leaves the chip off entirely. */
  model: string | null;
  /** The lane's conversation, where there is one to open. */
  conversation: string | null;
  /** What its turn is doing this second. Only ever on the running block. */
  learning: string | null;
  picking: boolean;
  /** A join is in the air and this is not the block it started from. */
  target: boolean;
  held: boolean;
  onDown: (event: Pressed) => void;
  /** Picking it from the keyboard. A pointer press picks on release instead,
   *  where a drag can still turn out to be a move rather than a press. */
  onSelect: () => void;
  onHandle: (event: Pressed) => void;
  onWatch: () => void;
  onOpen: () => void;
  onContinue: () => void;
};

export default function BlockCard({
  block,
  run,
  model,
  conversation,
  learning,
  picking,
  target,
  held,
  onDown,
  onSelect,
  onHandle,
  onWatch,
  onOpen,
  onContinue,
}: Props) {
  const spec = specOf(block.kind);
  const said = block.says.trim();
  const first = said === '' ? null : (said.split('\n')[0] ?? null);
  const state = canvasWords.states[block.state];
  const spent = block.state === 'done' ? (run?.spent ?? null) : null;
  const took =
    run !== null && run.startedAt !== null && run.endedAt !== null && block.state === 'done'
      ? durationInWords((run.endedAt - run.startedAt) / 1000)
      : null;
  /* A goal and a checks block go round: what is left of the tries is the one
   *  number a person watching them wants. */
  const round = Math.min(Math.max(run?.rounds ?? 0, 0), Math.max(block.retries, 0));
  const goingRound = block.state === 'running' && round > 0 && block.retries > 0;
  const openable = conversation !== null;

  const classes = [
    'canvas__card',
    `canvas__card--${block.state}`,
    picking ? 'canvas__card--picked' : '',
    target ? 'canvas__card--target' : '',
    held ? 'canvas__card--held' : '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={classes} data-block={block.id}
      style={
        {
          left: block.x,
          top: block.y,
          width: CARD.width,
          height: CARD.height,
          '--canvas-card': `${String(CARD.height)}px`,
        } as CSSProperties
      }
    >
      {block.state === 'running' ? <span className="canvas__sweep" aria-hidden="true" /> : null}

      <button
        type="button" className="canvas__face" aria-label={`${block.name}, ${state}`} aria-pressed={picking}
        onPointerDown={onDown}
        onClick={(event) => {
          // `detail` is zero for the activation the keyboard and a test make,
          // and one or more for a real press — which the release already did.
          if (event.detail === 0) onSelect();
        }}
      >
        <span className="canvas__head">
          <span className="canvas__mark" aria-hidden="true">
            <Mark kind={block.kind} />
          </span>
          <span className="canvas__name">{block.name}</span>
          <span className="canvas__state">{state}</span>
        </span>
        <span className="canvas__says">
          {first ?? (spec.needsWords ? canvasWords.saySomething : spec.note)}
        </span>
        {block.state === 'needs-you' ? <span className="canvas__gate">{canvasWords.gateWaits}</span> : null}
        {learning === null ? null : <span className="canvas__doing">{learning}</span>}
        {goingRound ? (
          <span className="canvas__round">{canvasWords.round(round + 1, block.retries + 1)}</span>
        ) : null}
        {run?.failure == null ? null : <span className="canvas__why">{run.failure}</span>}

        <span className="canvas__foots">
          <span className="canvas__foothalf">
            {spent === null ? null : <span className="canvas__spent">{formatMoney(spent)}</span>}
            {took === null ? null : <span className="canvas__took">{took}</span>}
          </span>
          <span className="canvas__foothalf canvas__foothalf--end">
            {model === null ? null : (
              <span className="canvas__model" title={model}>{model}</span>
            )}
          </span>
        </span>
      </button>

      {block.state === 'needs-you' ? (
        <button type="button" className="canvas__press" onClick={onContinue}>{canvasWords.continue}</button>
      ) : openable && block.state === 'running' ? (
        <button type="button" className="canvas__press" onClick={onWatch} title={canvasWords.watchNote}>
          {canvasWords.watch}
        </button>
      ) : openable && block.state === 'done' ? (
        <button type="button" className="canvas__press canvas__press--quiet" onClick={onOpen}>
          {canvasWords.open}
        </button>
      ) : null}

      {/* Both ends, so what a card waits for and what waits for it are the same
          shape. The left one carries no press: what it waits for is set in the
          panel, where a person can also take it off. */}
      <span className="canvas__socket" aria-hidden="true">
        <span className="canvas__dot" />
      </span>

      <button
        type="button" className="canvas__handle" aria-label={`Join from ${block.name}`}
        onPointerDown={onHandle}
      >
        <span className="canvas__dot" />
      </button>
    </div>
  );
}
