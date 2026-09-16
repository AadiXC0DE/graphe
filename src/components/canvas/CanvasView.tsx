/** A canvas: blocks you place, join up, and then start.
 *
 * The frame. It owns what the shell does not: which card is picked, the line
 * somebody pressed, whether it fills the window, the ring undo reaches back
 * through, and the save held back a moment so a stroke is not a write. The flow
 * arrives as a prop: the parent owns the bridge, and this draws.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TEMPLATES,
  canStart,
  canvasWords,
  change,
  historyOf,
  isArranged,
  latestRun,
  layOut,
  placeTemplate,
  redo as redoHistory,
  remove,
  runOrder,
  tidy,
  undo as undoHistory,
  undoable,
  unjoin,
  type Block,
  type BlockKind,
  type Flow,
  type History,
  type Standing,
} from '../../work/canvas';
import type { ConnectionState, ModelChoice, ThinkingLevel } from '../../lib/ipc';
import { heldWrites } from '../../lib/heldwrites';
import Asking from '../Asking';
import ThinkingWith from '../ThinkingWith';
import { beside } from './BlockCard';
import BlockPanel, { type BlockAttachment, type PanelView } from './BlockPanel';
import CanvasFoot, { Runs } from './CanvasFoot';
import CanvasPalette, { CanvasFirst, addBlock, copyBlock, justMade, type CanvasSummary } from './CanvasPalette';
import CanvasSurface from './CanvasSurface';
import './Canvas.css';

/** How long a refusal sits on the foot, and how big the panel beside a card is. */
const REFUSED_MS = 3600;
const PANEL = { width: 300, height: 500 } as const;

export type CanvasProps = {
  flow: Flow;
  /** The shape changed: `onFlow` now, `onSave` the same change held back. */
  onFlow: (flow: Flow) => void; onSave?: (flow: Flow) => void; onStart: () => void; onStop: () => void;
  /** Open the gate the flow has stopped at. */
  onContinue: (block: string) => void;
  /** Carry on from an interrupted run's first unfinished block. */
  onResume?: () => void; connection: ConnectionState | null;
  thinking?: Readonly<Record<string, ThinkingLevel>>;
  onThinking?: (choice: ModelChoice, level: ThinkingLevel) => void;
  onModel?: (choice: ModelChoice) => void; onConnect?: () => void;
  /** Where the project stands, for the one refusal that depends on it. */
  standing?: Standing;
  /** Everything a block can be given, already stored: content ids, not bytes. */
  attachments?: readonly BlockAttachment[];
  onKeepAttachments?: (files: readonly File[]) => Promise<readonly BlockAttachment[]>; full: boolean;
  onFull: (full: boolean) => void;
  /** Watch and Open: a lane's conversation, into the other pane. */
  onWatch?: (conversation: string) => void;
  onReview?: (branch: string) => void;
  /** What the turn in flight is doing this second. */
  learning?: { step: string | null; asking: boolean } | null;
  /** The project's other canvases, for the empty state. */
  canvases?: readonly CanvasSummary[]; onOpenCanvas?: (id: string) => void;
  onRenameCanvas?: (id: string, name: string) => void; onDeleteCanvas?: (id: string) => void;
};

/** One of the bar's quiet presses: a word, and nothing around it. */
function Quiet({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return <button type="button" className="canvas__quietbtn" onClick={onClick} disabled={disabled}>{label}</button>;
}

export default function CanvasView({
  flow, onFlow, onSave, onStart, onStop, onContinue, onResume, connection, thinking,
  onThinking, onModel, onConnect, standing = 'branch', attachments = [], onKeepAttachments,
  full, onFull, onWatch, onReview, learning = null, canvases = [], onOpenCanvas,
  onRenameCanvas, onDeleteCanvas,
}: CanvasProps) {

  const [picked, setPicked] = useState<string | null>(null);
  const [line, setLine] = useState<{ parent: string; child: string } | null>(null);
  const [joining, setJoining] = useState<{ from: string; x: number; y: number } | null>(null);
  const [panelView, setPanelView] = useState<PanelView>('block');
  const [at, setAt] = useState({ x: 0, y: 0, scale: 1 });
  /** Where the board starts inside the canvas, so a panel can be placed beside
   *  a card in the same space the panel is drawn in. */
  const [boardAt, setBoardAt] = useState({ x: 0, y: 0 });
  /** What a refused press had to say, where the press was made. */
  const [refused, setRefused] = useState<string | null>(null);
  /** The frame's record of where the board is. A stable callback, because the
   *  surface reports on every change and an inline one re-arms the effect on
   *  every render — which is a loop, and the loop is what a window shows as a
   *  canvas that never settles. */
  const boardMoved = useCallback((next: { x: number; y: number; scale: number }, origin: { x: number; y: number }) => {
    setAt(next);
    setBoardAt((was) => (was.x === origin.x && was.y === origin.y ? was : origin));
  }, []);
  /* Escape does not reach the picker over a full-window canvas, so it is closed
     the only certain way: by starting it again, shut. */
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerRound, setPickerRound] = useState(0);

  /** A ring of its own: undo never reaches from one canvas into another. */
  const [ring, setRing] = useState<History>(() => historyOf(flow));
  const ringNow = useRef(ring);
  const ringOf = useRef(flow.id);
  if (ringOf.current !== flow.id) {
    ringOf.current = flow.id;
    ringNow.current = historyOf(flow);
  }
  const saves = useRef(heldWrites());
  /** The box the panel is placed inside. The panel is positioned against the
   *  canvas rather than the window, so it has to be clamped to what this section
   *  actually covers: a canvas beside a shelf and a file panel does not start at
   *  zero, and clamping to the window put the panel past the right edge. */
  const shellRef = useRef<HTMLElement | null>(null);
  const keep = useRef(onSave ?? onFlow);
  keep.current = onSave ?? onFlow;

  const draw = useCallback(
    (next: Flow) => {
      ringNow.current = undoable(ringNow.current, next);
      setRing(ringNow.current);
      onFlow(next);
    },
    [onFlow],
  );

  const back = useCallback(
    (move: (was: History) => History) => {
      const moved = move(ringNow.current);
      if (moved === ringNow.current) return;
      ringNow.current = moved;
      setRing(moved);
      setPicked(null);
      setLine(null);
      onFlow(moved.now);
    },
    [onFlow],
  );

  useEffect(() => {
    saves.current.soon(flow.id, () => keep.current(flow));
  }, [flow]);

  /* A tab going is the other half of a window going: whatever is still waiting
     is written now, rather than thrown away with the timers. */
  useEffect(() => {
    const flush = (): void => saves.current.now();
    window.addEventListener('beforeunload', flush);
    return () => {
      window.removeEventListener('beforeunload', flush);
      flush();
    };
  }, []);

  useEffect(() => {
    if (refused === null) return;
    const timer = setTimeout(() => setRefused(null), REFUSED_MS);
    return () => clearTimeout(timer);
  }, [refused]);

  const laid = useMemo(() => layOut(flow), [flow]);
  const run = latestRun(flow);
  const live = run !== null && (run.state === 'running' || run.state === 'needs-you');
  const chosen = flow.blocks.find((one) => one.id === picked) ?? null;
  const spot = laid.blocks.find((one) => one.id === picked) ?? null;
  const mayStart = canStart(flow, standing);
  /* The gate's block and the working one: Continue and Watch are about a block
     nobody had to pick. */
  const gated = laid.blocks.find((one) => one.state === 'needs-you') ?? null;
  const busy = laid.blocks.find((one) => one.state === 'running' || one.state === 'needs-you') ?? null;

  /* A block a press made is picked, so the panel opens on the words it needs. */
  const put = useCallback(
    (next: Flow) => {
      const id = justMade(next);
      draw(next);
      if (id !== null) setPicked(id);
      setPanelView('block');
    },
    [draw],
  );
  const add = useCallback(
    (kind: BlockKind) => put(addBlock(flow, kind, picked, laid.blocks)),
    [flow, laid.blocks, picked, put],
  );
  const duplicate = useCallback(
    (block: Block) => put(copyBlock(flow, block, laid.blocks)),
    [flow, laid.blocks, put],
  );
  const takeTemplate = useCallback(
    (id: string) => {
      const template = TEMPLATES.find((one) => one.id === id);
      if (template === undefined) return;
      draw(placeTemplate(flow, template));
      setPicked(null);
    },
    [flow, draw],
  );

  /* One handler, on the window and in the capture phase, so it hears the press
     wherever the hand is. Escape peels one layer at a time: the picker, a
     half-drawn join, the panel, then the window. */
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      const command = event.metaKey || event.ctrlKey;
      const inField =
        (event.target as Element | null)?.closest('input, textarea, select, [contenteditable]') != null;
      const down = event.key;

      if (down === 'Escape') {
        if (pickerOpen) {
          event.preventDefault();
          setPickerOpen(false);
          setPickerRound((was) => was + 1);
        } else if (joining !== null) setJoining(null);
        else if (picked !== null) {
          event.stopPropagation();
          setPicked(null);
        } else if (full) {
          event.stopPropagation();
          onFull(false);
        }
        return;
      }
      if (inField) return;

      const order = runOrder(flow);
      const at2 = order.findIndex((one) => one.id === picked);
      const step = (by: number): void =>
        setPicked(order[Math.max(0, Math.min(order.length - 1, at2 < 0 ? 0 : at2 + by))]?.id ?? null);
      const small = down.toLowerCase();

      if (command && small === 'z') {
        event.preventDefault();
        back(event.shiftKey ? redoHistory : undoHistory);
      } else if (command && small === 'd' && chosen !== null) {
        event.preventDefault();
        duplicate(chosen);
      } else if (command && down === 'Enter') {
        event.preventDefault();
        if (mayStart.ok) onStart();
        else setRefused(mayStart.because);
      } else if (down === 'Enter') {
        const next = chosen ?? order[0];
        if (next === undefined) return;
        event.preventDefault();
        setPicked(next.id);
        setPanelView('block');
      } else if (down === 'Backspace' || down === 'Delete') {
        /* The line somebody picked, or their block. Never while it is running:
           the shape is what is running. */
        if (live || (line === null && picked === null)) return;
        event.preventDefault();
        if (line === null) {
          draw(remove(flow, picked ?? ''));
          setPicked(null);
        } else {
          draw(unjoin(flow, line.child, line.parent));
          setLine(null);
        }
      } else if (down.startsWith('Arrow') && order.length > 0) {
        event.preventDefault();
        step(down === 'ArrowLeft' || down === 'ArrowUp' ? -1 : 1);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  });

  const keepFiles = useCallback(
    async (files: readonly File[]) => {
      if (onKeepAttachments === undefined || chosen === null) return;
      const kept = await onKeepAttachments(files);
      if (kept.length === 0) return;
      draw(change(flow, chosen.id, { attachments: [...chosen.attachments, ...kept.map((one) => one.id)] }));
    },
    [chosen, flow, onKeepAttachments, draw],
  );

  const held = attachments.filter((one) => chosen?.attachments.includes(one.id) === true);
  const count = (state: string): number => laid.blocks.filter((one) => one.state === state).length;
  return (
    <section className={`canvas ${full ? 'canvas--full' : ''}`} aria-label={flow.name} ref={shellRef}>
      <header className="canvas__bar">
        <input
          className="canvas__title" value={flow.name} aria-label={canvasWords.rename}
          onChange={(event) => draw({ ...flow, name: event.target.value })}
          // Empty is not a name: it falls back to the words it was asked first.
          onBlur={() => {
            if (flow.name.trim() === '') draw({ ...flow, name: canvasWords.named(flow.blocks) });
          }}
        />
        <span className="canvas__count">{canvasWords.counted(flow.blocks.length, count('done'), count('running'))}</span>
        <Quiet label={canvasWords.undo} onClick={() => back(undoHistory)} disabled={ring.past.length === 0} />
        <Quiet label={canvasWords.redo} onClick={() => back(redoHistory)} disabled={ring.future.length === 0} />
        {!isArranged(flow) ? null : (
          <Quiet
            label={canvasWords.tidy}
            onClick={() => {
              const where = tidy(flow);
              draw({ ...flow, blocks: flow.blocks.map((one) => ({ ...one, at: where[one.id] ?? { x: 0, y: 0 } })) });
            }}
          />
        )}

        <div className="canvas__far">
          {/* `In turn` and `In worktrees` are two answers to one question, so
              they are one control rather than two rows. */}
          <label className="canvas__lanes">
            <span className="canvas__lanesname">{canvasWords.blocks}</span>
            <select
              className="canvas__lanespick" aria-label={canvasWords.lanesNote} value={flow.lanes}
              disabled={live}
              onChange={(event) => draw({ ...flow, lanes: event.target.value === 'worktrees' ? 'worktrees' : 'in-turn' })}
            >
              <option value="in-turn">{canvasWords.inTurn}</option>
              <option value="worktrees">{canvasWords.inWorktrees}</option>
            </select>
          </label>
          {connection === null || onModel === undefined ? null : (
            <ThinkingWith
              key={pickerRound} state={connection} onSelect={onModel} onOpenChange={setPickerOpen}
              onConnect={onConnect ?? (() => undefined)} bare
              {...(onThinking === undefined ? {} : { onThinking })}
            />
          )}
          <Asking howFar={flow.howFar} onHowFar={(rung) => draw({ ...flow, howFar: rung })} opens="down-right" />
        </div>

        <Runs flow={flow} onWatch={onWatch} />

        <div className="canvas__run">
          {gated !== null ? (
            <button type="button" className="canvas__start" onClick={() => onContinue(gated.id)}>{canvasWords.continue}</button>
          ) : live ? (
            <button type="button" className="canvas__stop" onClick={onStop}>{canvasWords.stop}</button>
          ) : (
            // A refusal goes where the press was made, not into a sheet.
            <button
              type="button" className="canvas__start"
              onClick={() => (mayStart.ok ? onStart() : setRefused(mayStart.because))}
            >
              {canvasWords.start}
            </button>
          )}
          <button type="button" className="canvas__fillbtn" onClick={() => onFull(!full)} aria-pressed={full}>
            {canvasWords.fill}
          </button>
        </div>
      </header>

      <div className="canvas__bands">
        <CanvasPalette onPlace={add} onTemplate={takeTemplate} />
        {laid.blocks.length === 0 ? (
          <CanvasFirst
            canvases={canvases} onTemplate={takeTemplate}
            {...(onOpenCanvas === undefined ? {} : { onOpen: onOpenCanvas })}
            {...(onRenameCanvas === undefined ? {} : { onRename: onRenameCanvas })}
            {...(onDeleteCanvas === undefined ? {} : { onDelete: onDeleteCanvas })}
          />
        ) : (
          <CanvasSurface
            flow={flow} run={run} connection={connection} learning={learning} picked={picked} line={line}
            joining={joining} onLine={setLine} onJoining={setJoining} onFlow={draw}
            onAt={boardMoved}
            onOpen={(one) => onWatch?.(one)}
            onContinue={() => (gated === null ? undefined : onContinue(gated.id))}
            onPick={(one) => {
              setPicked(one);
              setPanelView('block');
            }}
          />
        )}
      </div>

      {chosen === null || spot === null ? null : (
        <BlockPanel
          key={chosen.id} block={chosen} flow={flow} connection={connection} thinking={thinking}
          going={live} view={panelView} onView={setPanelView}
          spot={(() => {
            const room = {
              across: shellRef.current?.clientWidth ?? window.innerWidth ?? 1200,
              down: shellRef.current?.clientHeight ?? window.innerHeight ?? 800,
            };
            // `beside` works in the board's own space; the panel is drawn
            // against the canvas, so the board's origin goes back in and the
            // whole thing is clamped once, in the space it is drawn in.
            const placed = beside(spot, at, PANEL, room);
            return {
              ...placed,
              x: Math.max(16, Math.min(placed.x + boardAt.x, room.across - PANEL.width - 16)),
              y: Math.max(16, Math.min(placed.y + boardAt.y, room.down - PANEL.height - 16)),
            };
          })()}
          attachments={held} onAttach={(files) => void keepFiles(files)}
          onDetach={(id) => draw(change(flow, chosen.id, { attachments: chosen.attachments.filter((one) => one !== id) }))}
          onChange={(over) => draw(change(flow, chosen.id, over))}
          onRemove={() => {
            draw(remove(flow, chosen.id));
            setPicked(null);
          }}
          onDuplicate={() => duplicate(chosen)} onClose={() => setPicked(null)}
        />
      )}

      <div className="canvas__footer">
        <CanvasFoot
          flow={flow} run={run} learning={learning} busy={busy?.id ?? null}
          onWatch={(one) => onWatch?.(one)} onReview={(branch) => onReview?.(branch)}
          onResume={() => onResume?.()}
          onAgain={() => {
            setPicked(null);
            onStart();
          }}
        />
        {refused === null ? null : <p className="canvas__refused" role="status">{refused}</p>}
      </div>
    </section>
  );
}
