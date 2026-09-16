/** What you can put down.
 *
 * Seven blocks and three templates somebody already worked out. Under 900px of
 * room the list folds to its marks, because the board is what the room is for,
 * and a mark without its word carries a floating label instead.
 */

import { useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import {
  BLOCKS,
  TEMPLATES,
  canvasWords,
  change,
  place,
  type Block,
  type BlockKind,
  type Flow,
  type Placed,
} from '../../work/canvas';
import { Mark } from './BlockCard';

/* -------------------------------------------------------------------------- */
/* Putting one down                                                             */
/* -------------------------------------------------------------------------- */

/** Where a block placed after the picked one lands: beside it and clear of the
 *  children it already has, so a block added to an arranged canvas is seen. */
function landing(flow: Flow, parent: Placed | null): { at: { x: number; y: number } } | null {
  if (parent === null) return null;
  const under = flow.blocks.filter((one) => one.after.includes(parent.id)).length;
  return { at: { x: parent.x + 320, y: parent.y + under * 152 } };
}

/** One block, placed after whatever was picked and put somewhere visible. */
export function addBlock(flow: Flow, kind: BlockKind, after: string | null, laid: readonly Placed[]): Flow {
  const next = place(flow, kind, after);
  const block = next.blocks[next.blocks.length - 1];
  if (block === undefined) return flow;
  const where = landing(flow, laid.find((one) => one.id === after) ?? null);
  return where === null ? next : change(next, block.id, where);
}

/** A copy carries everything the block was set to: one that lost the words
 *  would be a second press to make it say the same thing again. */
export function copyBlock(flow: Flow, block: Block, laid: readonly Placed[]): Flow {
  const next = place(flow, block.kind, block.after.length === 0 ? null : block.after);
  const made = next.blocks[next.blocks.length - 1];
  if (made === undefined) return flow;
  const { id: _was, at: _sat, ...setting } = block;
  const here = laid.find((one) => one.id === block.id);
  return change(next, made.id, {
    ...setting,
    ...(here === undefined ? {} : { at: { x: here.x, y: here.y + 152 } }),
  });
}

/** The block a press just made, so it can be picked without searching for it. */
export function justMade(flow: Flow): string | null {
  return flow.blocks[flow.blocks.length - 1]?.id ?? null;
}

type Props = {
  onPlace: (kind: BlockKind) => void;
  onTemplate: (id: string) => void;
};

export default function CanvasPalette({ onPlace, onTemplate }: Props) {
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
                type="button" className="canvas__pick" data-kind={spec.kind}
                onClick={() => onPlace(spec.kind)} title={spec.note} onMouseEnter={show(spec.name)}
                onFocus={show(spec.name)} onMouseLeave={() => setTip(null)} onBlur={() => setTip(null)}
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

        {/* Folded, a template is four marks nobody can tell apart from a block.
            It keeps its words or it does not appear. */}
        <div className="canvas__loopband">
          <h2 className="canvas__band">{canvasWords.templates}</h2>
          <ul className="canvas__list">
            {TEMPLATES.map((one) => (
              <li key={one.id}>
                <button
                  type="button" className="canvas__pick canvas__pick--loop" data-template={one.id}
                  onClick={() => onTemplate(one.id)} title={one.note}
                >
                  <span className="canvas__picktext">
                    <span className="canvas__pickname">{one.name}</span>
                    <span className="canvas__shape" aria-hidden="true">
                      {one.blocks.map((shape, index) => (
                        <span key={`${shape.kind}-${String(index)}`} className="canvas__shapemark">
                          <Mark kind={shape.kind} />
                        </span>
                      ))}
                    </span>
                    <span className="canvas__picknote">{one.note}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

/** One canvas the project has, for the list under the templates. */
export type CanvasSummary = { id: string; name: string };

/** Not in `canvasWords`: nothing else in the app renames a whole thing from a
 *  row, and the title field's own word is a sentence about the field. */
const RENAME = 'Rename';
const KEEP = 'Keep';

/**
 * The board with nothing on it.
 *
 * The three templates are presses rather than a paragraph about them, because a
 * shape somebody can read at a glance is worth more than a sentence describing
 * it. Under them the project's other canvases: a canvas is a thing a project
 * has several of, and the way back to one has to be somewhere the hand already
 * is rather than behind a menu.
 */
export function CanvasFirst({
  canvases,
  onTemplate,
  onOpen,
  onRename,
  onDelete,
}: {
  canvases: readonly CanvasSummary[];
  onTemplate: (id: string) => void;
  onOpen?: (id: string) => void;
  onRename?: (id: string, name: string) => void;
  onDelete?: (id: string) => void;
}) {
  const [naming, setNaming] = useState<string | null>(null);
  const [word, setWord] = useState('');
  /* Which one is being thrown away. Asked first: a canvas is a drawing somebody
   *  made, and there is nothing to drag it back from. */
  const [doomed, setDoomed] = useState<CanvasSummary | null>(null);

  return (
    <div className="canvas__nothing">
      <h2 className="canvas__nothingtitle">{canvasWords.empty}</h2>
      <p className="canvas__nothingnote">{canvasWords.emptyNote}</p>
      <ul className="canvas__loops">
        {TEMPLATES.map((one) => (
          <li key={one.id}>
            <button
              type="button" className="canvas__loop" data-template={one.id}
              onClick={() => onTemplate(one.id)}
            >
              <span className="canvas__loopshape" aria-hidden="true">
                {one.blocks.map((shape, index) => (
                  <span key={`${shape.kind}-${String(index)}`} className="canvas__loopmark">
                    <Mark kind={shape.kind} />
                  </span>
                ))}
              </span>
              <span className="canvas__loopname">{one.name}</span>
              <span className="canvas__loopnote">{one.note}</span>
            </button>
          </li>
        ))}
      </ul>

      {canvases.length === 0 ? null : (
        <div className="canvas__others">
          <h3 className="canvas__band">{canvasWords.canvases}</h3>
          <ul className="canvas__list">
            {canvases.map((one) => (
              <li className="canvas__other" key={one.id}>
                {naming === one.id ? (
                  <form
                    className="canvas__otherform"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (word.trim() !== '') onRename?.(one.id, word.trim());
                      setNaming(null);
                    }}
                  >
                    <input
                      className="canvas__otherfield" value={word}
                      autoFocus
                      aria-label={canvasWords.rename} onChange={(event) => setWord(event.target.value)}
                      onBlur={() => setNaming(null)}
                    />
                    <button type="submit" className="canvas__otherdo">{RENAME}</button>
                  </form>
                ) : (
                  <>
                    <span className="canvas__othername">{one.name}</span>
                    {onOpen === undefined ? null : (
                      <button type="button" className="canvas__otherdo" onClick={() => onOpen(one.id)}>
                        {canvasWords.open}
                      </button>
                    )}
                    {onRename === undefined ? null : (
                      <button
                        type="button" className="canvas__otherdo"
                        onClick={() => {
                          setWord(one.name);
                          setNaming(one.id);
                        }}
                      >
                        {RENAME}
                      </button>
                    )}
                    {onDelete === undefined ? null : (
                      <button
                        type="button" className="canvas__otherdo" onClick={() => setDoomed(one)}
                      >
                        {canvasWords.delete}
                      </button>
                    )}
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {doomed === null ? null : (
        <div className="canvas__sure" role="alertdialog" aria-label={canvasWords.delete}>
          <p className="canvas__surequestion">{doomed.name}</p>
          <div className="canvas__surerow">
            <button type="button" className="canvas__surekeep" onClick={() => setDoomed(null)}>{KEEP}</button>
            <button
              type="button" className="canvas__suredo"
              onClick={() => {
                onDelete?.(doomed.id);
                setDoomed(null);
              }}
            >
              {canvasWords.delete}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
