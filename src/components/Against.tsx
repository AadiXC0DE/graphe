import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import {
  AGAINST_WORDS as SAYS,
  canTake,
  compare,
  isFinal,
  saysNothingHere,
  saysSummary,
  type Difference,
  type Side,
} from '../lib/against';
import { boardWords, saysState } from '../work/board';
import './Against.css';
import './Sheet.css';

/**
 * Two or three goes at the same job, put next to each other so one can be
 * chosen.
 *
 * The board shows each go as a picture, a sentence and what it cost. This keeps
 * that reading and adds the only thing the board cannot say: where the results
 * actually differ. A column per go, then one row per file, so the question
 * "which of these did more to this file" is answered by looking across.
 *
 * Every go in the group gets a column, finished or not — watching one form is
 * half of why somebody opens this. A column that is still moving says so, and
 * carries no offer to take it: there is nothing there to take yet.
 *
 * Presentational: everything arrives as props.
 */

type Props = {
  open: boolean;
  sides: readonly Side[];
  onClose: () => void;
  onKeep: (id: string) => void;
  /** Serve every go that still has a copy, and show them in the pane. Left off,
   *  the offer is not made. */
  onOpenInBrowser?: () => void;
  busy?: boolean;
};

type Total = { touched: number; added: number; removed: number };

/** Everything one go changed, for the line under its name. */
function totalOf(files: readonly Difference[], id: string): Total {
  let touched = 0;
  let added = 0;
  let removed = 0;
  for (const file of files) {
    const count = file.counts[id];
    if (count === undefined) continue;
    touched += 1;
    added += count.added;
    removed += count.removed;
  }
  return { touched, added, removed };
}

function Row({ file, sides }: { file: Difference; sides: readonly Side[] }) {
  const names = file.onlyIn.map((id) => sides.find((side) => side.id === id)?.name ?? id);
  // The busiest cell in this row sets the length of the bars in it, so a row is
  // read across rather than against every other row on the page. A file only
  // one go touched has nothing to be read across, and a full bar there would
  // say "a lot of this" when it only means "the only one".
  const across = file.onlyIn.length > 1;
  const most = Math.max(
    1,
    ...sides.map((side) => {
      const count = file.counts[side.id];
      return count === undefined ? 0 : count.added + count.removed;
    }),
  );

  return (
    <li className="against__file">
      <div className="against__about">
        <p className="against__path">{file.path}</p>
        <p className="against__who">{SAYS.who(names, sides.length)}</p>
      </div>

      {sides.map((side) => {
        const count = file.counts[side.id];
        return (
          <div
            key={side.id}
            className={`against__cell${count === undefined ? ' against__cell--untouched' : ''}`}
          >
            <span className="against__whose">{side.name}</span>
            {count === undefined ? (
              <span className="against__untouched">
                {isFinal(side) ? SAYS.untouched : SAYS.untouchedYet}
              </span>
            ) : (
              <>
                <span className="against__tally">{SAYS.tally(count.added, count.removed)}</span>
                {across ? (
                  <span
                    className="against__bar"
                    aria-hidden="true"
                    style={{ '--part': (count.added + count.removed) / most } as CSSProperties}
                  />
                ) : null}
              </>
            )}
          </div>
        );
      })}
    </li>
  );
}

export default function Against({ open, sides, onClose, onKeep, onOpenInBrowser, busy = false }: Props) {
  const [opening, setOpening] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const { files, sameEverywhere } = useMemo(() => compare(sides), [sides]);

  const deciding = useMemo(() => {
    const same = new Set(sameEverywhere);
    return files.filter((file) => !same.has(file.path));
  }, [files, sameEverywhere]);

  useEffect(() => {
    if (!busy) setPressed(null);
  }, [busy]);

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

  return (
    <section className="sheet against" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="against__summary">
            {saysSummary(sides, deciding.length, sameEverywhere.length)}
          </p>
        </div>
        <div className="sheet__chips">
          {/* A patch says what changed; a running copy says what it looks like.
              Only offered where a copy is still there to serve. */}
          {onOpenInBrowser === undefined || !sides.some((one) => one.folder !== null) ? null : (
            <button
              type="button"
              className="against__browser"
              disabled={busy || opening}
              onClick={() => {
                setOpening(true);
                onOpenInBrowser();
              }}
            >
              {opening ? SAYS.opening : SAYS.inTheBrowser}
            </button>
          )}
        </div>
        <button type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="sheet__body scroll--auto">
        <div
          className="against__inner"
          style={{ '--against-columns': sides.length } as CSSProperties}
        >
          <ul className="against__heads">
            {/* The column the file names run down. Empty here, the way the
                corner of any comparison is. */}
            <li className="against__lead" aria-hidden="true" />
            {sides.map((side) => {
              const total = totalOf(files, side.id);
              const final = isFinal(side);
              const notYet = boardWords.notYet(side.state);
              return (
                <li key={side.id} className={`against__side${final ? '' : ' against__side--going'}`}>
                  <h2 className="against__name">{side.name}</h2>
                  {/* On every column, not only the ones still moving: a line
                      that appears on some of them is a line to be found. */}
                  <p className={`against__state against__state--${side.state}`}>
                    {saysState(side.state)}
                  </p>
                  <div className="against__frame">
                    {side.picture === null || side.picture === undefined ? (
                      <p className="against__instead">{SAYS.noPicture}</p>
                    ) : (
                      <img
                        className="against__picture"
                        src={side.picture}
                        alt={SAYS.picture(side.name)}
                      />
                    )}
                  </div>
                  <p className="against__total">
                    {final
                      ? SAYS.total(total.touched, total.added, total.removed)
                      : SAYS.soFar(total.touched, total.added, total.removed)}
                    {side.spent === null || side.spent === undefined ? null : (
                      <span className="against__spent">{side.spent}</span>
                    )}
                  </p>
                  {/* Finished is not the same as takeable: a go that did not
                      work is over and has nothing to hand over. Said where the
                      offer would have been, rather than as a press that fails
                      afterwards. */}
                  {canTake(side) ? (
                    <button
                      type="button"
                      className="against__keep"
                      disabled={busy}
                      onClick={() => {
                        setPressed(side.id);
                        onKeep(side.id);
                      }}
                    >
                      {busy && pressed === side.id ? SAYS.keeping : SAYS.keep}
                    </button>
                  ) : (
                    <p className="against__notyet">{notYet}</p>
                  )}
                </li>
              );
            })}
          </ul>

          {files.length === 0 ? (
            <p className="against__nothing">{saysNothingHere(sides)}</p>
          ) : (
            <>
              <h2 className="against__caption">{SAYS.files}</h2>
              {deciding.length === 0 ? null : (
                <ul className="against__files">
                  {deciding.map((file) => (
                    <Row key={file.path} file={file} sides={sides} />
                  ))}
                </ul>
              )}
            </>
          )}

          {/* The part nobody has to decide about, said once. */}
          {sameEverywhere.length === 0 ? null : (
            <p className="against__same">
              {SAYS.same(sameEverywhere.length)}{' '}
              <span className="against__samepaths">{sameEverywhere.join(', ')}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
