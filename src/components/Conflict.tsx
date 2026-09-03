import { useEffect, useMemo, useRef, useState } from 'react';

import {
  canDecide,
  conflictWords,
  leftToDecide,
  readConflict,
  resolveWith,
  saysConflict,
  type Take,
} from '../diff/conflict';
import './Conflict.css';
import './Sheet.css';

type Props = {
  open: boolean;
  /** Every file this review left for somebody to settle. */
  paths: readonly string[];
  /** The one being read. */
  path: string | null;
  /** That file with the markers in it, or null while it is being read. */
  text: string | null;
  busy: boolean;
  onPath: (path: string) => void;
  /** The decided file, ready to be written. Never called while a place is
   *  still carrying its markers. */
  onSettle: (path: string, text: string) => void;
  /** Hand both sides to the conversation that made the change. */
  onAsk: (path: string, clashes: number) => void;
  onClose: () => void;
};

export const SAYS = {
  heading: conflictWords.screen,
  close: 'Close',
  reading: 'Reading both versions…',
  nothing: conflictWords.none,
  nothingDetail: conflictWords.noneDetail,
  place: (at: number, of: number): string => `Place ${String(at)} of ${String(of)}`,
} as const;

/** The three ways out of one place, in the order they are offered. */
const WAYS: readonly (readonly [Take, string])[] = [
  ['mine', conflictWords.takeMine],
  ['theirs', conflictWords.takeTheirs],
  ['both', conflictWords.takeBoth],
];

function Pane({ name, lines }: { name: string; lines: readonly string[] }) {
  return (
    <div className="clash__pane">
      <p className="clash__panename">{name}</p>
      <pre className="clash__code">
        {lines.length === 0 ? <span className="clash__empty">Nothing on this side.</span> : lines.join('\n')}
      </pre>
    </div>
  );
}

/**
 * A file both sides changed, decided place by place.
 *
 * The rule the screen exists to honour: a file whose markers could not be read
 * is reported and left byte for byte alone. No mine, no theirs, no "keep both"
 * over text nobody understood — the only thing offered there is handing it to
 * the conversation, or opening it yourself.
 */
export default function Conflict({
  open,
  paths,
  path,
  text,
  busy,
  onPath,
  onSettle,
  onAsk,
  onClose,
}: Props) {
  const shut = useRef<HTMLButtonElement>(null);
  const [picks, setPicks] = useState<ReadonlyMap<number, Take>>(() => new Map());

  const file = useMemo(() => readConflict(text ?? ''), [text]);
  const open_ = leftToDecide(file, picks);
  const decidable = canDecide(file);

  // A different file is a different set of decisions.
  useEffect(() => {
    setPicks(new Map());
  }, [path, text]);

  useEffect(() => {
    if (open) shut.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, onClose]);

  if (!open) return null;

  const pick = (at: number, take: Take): void => {
    setPicks((was) => {
      const next = new Map(was);
      if (next.get(at) === take) next.delete(at);
      else next.set(at, take);
      return next;
    });
  };

  let clashAt = -1;

  return (
    <section className="sheet clash" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="clash__count">
            {text === null
              ? SAYS.reading
              : decidable
                ? `${saysConflict(file)} ${conflictWords.stillOpen(open_)}.`
                : saysConflict(file)}
          </p>
        </div>

        <div className="sheet__chips" />

        {/* Never offered over a file that could not be read: the person is told
            it has been left alone, and the only way on is the conversation. */}
        <div className="sheet__save">
          <button
            type="button"
            className="sheet__savebtn"
            disabled={busy || !decidable || open_ > 0 || path === null}
            onClick={() => {
              if (path === null || !decidable || open_ > 0) return;
              onSettle(path, resolveWith(file, (at) => picks.get(at) ?? null));
            }}
          >
            {busy ? conflictWords.keeping : conflictWords.keep}
          </button>
        </div>

        <button ref={shut} type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body clash__body scroll--auto">
        <ul className="clash__files">
          {paths.map((one) => (
            <li key={one}>
              <button
                type="button"
                className={`clash__file ${one === path ? 'clash__file--open' : ''}`}
                aria-current={one === path ? 'true' : undefined}
                onClick={() => onPath(one)}
              >
                {one}
              </button>
            </li>
          ))}
        </ul>

        <div className="clash__reading">
          {path === null || paths.length === 0 ? (
            <div className="clash__blank">
              <h2 className="clash__blanktitle">{SAYS.nothing}</h2>
              <p className="clash__blankdetail">{SAYS.nothingDetail}</p>
            </div>
          ) : text === null ? (
            <p className="clash__waiting">{SAYS.reading}</p>
          ) : !file.ok ? (
            <div className="clash__blank">
              <h2 className="clash__blanktitle">{conflictWords.unreadable}</h2>
              <button
                type="button"
                className="clash__ask"
                disabled={busy}
                onClick={() => onAsk(path, file.clashes)}
              >
                {conflictWords.askItToReconcile}
              </button>
            </div>
          ) : file.clashes === 0 ? (
            <div className="clash__blank">
              <h2 className="clash__blanktitle">{conflictWords.resolved}</h2>
            </div>
          ) : (
            <>
              <button
                type="button"
                className="clash__ask"
                disabled={busy}
                onClick={() => onAsk(path, file.clashes)}
              >
                {conflictWords.askItToReconcile}
              </button>

              {file.regions.map((region, index) => {
                if (region.kind === 'same') {
                  return region.lines.length === 0 ? null : (
                    <pre key={`same-${String(index)}`} className="clash__same scroll--auto">
                      {region.lines.join('\n')}
                    </pre>
                  );
                }
                clashAt += 1;
                const here = clashAt;
                const taken = picks.get(here) ?? null;
                return (
                  <div key={`clash-${String(index)}`} className="clash__place">
                    <div className="clash__placetop">
                      <p className="clash__placename">{SAYS.place(here + 1, file.clashes)}</p>
                      <span className="clash__ways" role="group" aria-label={SAYS.place(here + 1, file.clashes)}>
                        {WAYS.map(([take, name]) => (
                          <button
                            key={take}
                            type="button"
                            className={`clash__way ${taken === take ? 'clash__way--on' : ''}`}
                            aria-pressed={taken === take}
                            disabled={busy}
                            onClick={() => pick(here, take)}
                          >
                            {name}
                          </button>
                        ))}
                      </span>
                    </div>
                    <div className={`clash__panes ${region.base === null ? '' : 'clash__panes--three'}`}>
                      <Pane name={region.mineLabel || conflictWords.mine} lines={region.mine} />
                      {region.base === null ? null : (
                        <Pane name={region.baseLabel || conflictWords.base} lines={region.base} />
                      )}
                      <Pane name={region.theirsLabel || conflictWords.theirs} lines={region.theirs} />
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
