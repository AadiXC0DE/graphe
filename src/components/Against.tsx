import { useEffect, useMemo, useState, type CSSProperties } from 'react';

import { parseDiff, type FileChange } from '../diff/hunks';
import { AGAINST_WORDS as SAYS, saysNothingHere, type Side } from '../lib/against';
import { boardWords, saysState } from '../work/board';
import {
  compare,
  compareWords,
  pickOne,
  saysComparison,
  type Attempt,
  type Column,
  type Comparison,
  type FileRow,
} from '../work/compare';
import DiffView from './DiffView';
import './Against.css';
import './Sheet.css';

/**
 * Two or three goes at the same job, put next to each other so one can be
 * chosen.
 *
 * The board shows each go as a picture, a sentence and what it cost. This keeps
 * that reading and adds the only thing the board cannot say: where the results
 * actually differ, and against what. Every column is held against one base, so
 * three columns are three answers to the same question rather than three
 * unrelated patches.
 *
 * Every go in the group gets a column, finished or not — watching one form is
 * half of why somebody opens this. A column that is still moving says so, and
 * carries no offer to take it: there is nothing there to take yet.
 *
 * Presentational: everything arrives as props.
 */

/** A go, as the shell hands it over: the board's side plus the base every one
 *  of them started from. */
type SideOfWork = Side & { base?: string | null };

type Props = {
  open: boolean;
  sides: readonly SideOfWork[];
  onClose: () => void;
  onKeep: (id: string) => void;
  /** Serve every go that still has a copy, and show them in the pane. Left off,
   *  the offer is not made. */
  onOpenInBrowser?: () => void;
  busy?: boolean;
};

/** What one go changed, by file, so a row can draw the change itself and not
 *  only the size of it. */
type ByPath = ReadonlyMap<string, FileChange>;

function Row({
  file,
  columns,
  changes,
  showing,
  onShow,
  busy,
}: {
  file: FileRow;
  columns: readonly Column[];
  changes: ReadonlyMap<string, ByPath>;
  showing: boolean;
  onShow: () => void;
  busy: boolean;
}) {
  const names = file.touched.map((id) => columns.find((one) => one.id === id)?.name ?? id);
  // The busiest cell in this row sets the length of the bars in it, so a row is
  // read across rather than against every other row on the page. A file only
  // one go touched has nothing to be read across, and a full bar there would
  // say "a lot of this" when it only means "the only one".
  const across = file.touched.length > 1;
  const most = Math.max(
    1,
    ...columns.map((one) => {
      const count = file.counts[one.id];
      return count === undefined ? 0 : count.added + count.removed;
    }),
  );

  return (
    <li className={`against__file${showing ? ' against__file--open' : ''}`}>
      <button
        type="button"
        className="against__about"
        aria-expanded={showing}
        onClick={onShow}
        title={compareWords.readIt}
      >
        <span className="against__path">{file.path}</span>
        <span className="against__who">{SAYS.who(names, columns.length)}</span>
      </button>

      {columns.map((one) => {
        const count = file.counts[one.id];
        return (
          <div
            key={one.id}
            className={`against__cell${count === undefined ? ' against__cell--untouched' : ''}`}
          >
            <span className="against__whose">{one.name}</span>
            {count === undefined ? (
              <span className="against__untouched">
                {one.final ? SAYS.untouched : SAYS.untouchedYet}
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

      {/* The change itself, one go under another, because the counts say how
          much and never what. */}
      {!showing ? null : (
        <div className="against__reading">
          {file.touched.map((id) => {
            const change = changes.get(id)?.get(file.path);
            if (change === undefined) return null;
            return (
              <section key={id} className="against__readingone">
                <h3 className="against__readingname">
                  {columns.find((one) => one.id === id)?.name ?? id}
                </h3>
                <DiffView files={[change]} busy={busy} />
              </section>
            );
          })}
        </div>
      )}
    </li>
  );
}

export default function Against({
  open,
  sides,
  onClose,
  onKeep,
  onOpenInBrowser,
  busy = false,
}: Props) {
  const [opening, setOpening] = useState(false);
  const [pressed, setPressed] = useState<string | null>(null);
  const [showing, setShowing] = useState<string | null>(null);

  /* Every go against one starting point. The base is the same for all of them
     and is carried on each, so the set needs no envelope of its own. */
  const base = useMemo(
    () => sides.map((one) => one.base ?? '').find((one) => one !== '') ?? '',
    [sides],
  );
  const attempts = useMemo<readonly Attempt[]>(
    () =>
      sides.map((one) => ({
        id: one.id,
        name: one.name,
        state: one.state,
        diff: one.diff,
        picture: one.picture ?? null,
        spent: one.spent ?? null,
      })),
    [sides],
  );
  const comparison: Comparison = useMemo(() => compare(attempts, base), [attempts, base]);

  const deciding = useMemo(
    () => comparison.files.filter((file) => file.differs),
    [comparison],
  );

  const changes = useMemo(() => {
    const found = new Map<string, ByPath>();
    for (const one of attempts) {
      const byPath = new Map<string, FileChange>();
      for (const file of parseDiff(one.diff)) if (file.path !== '') byPath.set(file.path, file);
      found.set(one.id, byPath);
    }
    return found;
  }, [attempts]);

  const bySide = useMemo(() => new Map(sides.map((one) => [one.id, one])), [sides]);

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
    <section className="sheet against" aria-label={compareWords.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{compareWords.heading}</h1>
          <p className="against__summary">{saysComparison(attempts, comparison)}</p>
          {base === '' ? null : (
            <p className="against__base">{compareWords.against(base)}</p>
          )}
        </div>
        <div className="sheet__chips">
          {/* A patch says what changed; a running copy says what it looks like.
              Only offered where a copy is still there to serve. */}
          {onOpenInBrowser === undefined || !sides.some((one) => one.folder != null) ? null : (
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
          style={{ '--against-columns': comparison.attempts.length } as CSSProperties}
        >
          <ul className="against__heads">
            {/* The column the file names run down. Empty here, the way the
                corner of any comparison is. */}
            <li className="against__lead" aria-hidden="true" />
            {comparison.attempts.map((column) => {
              const side = bySide.get(column.id);
              const state = side?.state ?? 'waiting';
              // What taking this one means, worked out by the same function
              // that does the taking, so the sentence and the press agree.
              const taking = pickOne(comparison, column.id);
              return (
                <li
                  key={column.id}
                  className={`against__side${column.final ? '' : ' against__side--going'}`}
                >
                  <h2 className="against__name">{column.name}</h2>
                  {/* On every column, not only the ones still moving: a line
                      that appears on some of them is a line to be found. */}
                  <p className={`against__state against__state--${state}`}>{saysState(state)}</p>
                  <div className="against__frame">
                    {side?.picture == null ? (
                      <p className="against__instead">{SAYS.noPicture}</p>
                    ) : (
                      <img
                        className="against__picture"
                        src={side.picture}
                        alt={SAYS.picture(column.name)}
                      />
                    )}
                  </div>
                  <p className="against__total">
                    {column.line}
                    {side?.spent == null ? null : (
                      <span className="against__spent">{side.spent}</span>
                    )}
                  </p>
                  {/* Finished is not the same as takeable: a go that did not
                      work is over and has nothing to hand over. Said where the
                      offer would have been, rather than as a press that fails
                      afterwards. */}
                  {column.canTake && taking !== null ? (
                    <button
                      type="button"
                      className="against__keep"
                      disabled={busy}
                      title={taking.says}
                      onClick={() => {
                        setPressed(taking.land);
                        onKeep(taking.land);
                      }}
                    >
                      {busy && pressed === column.id ? SAYS.keeping : compareWords.keep}
                    </button>
                  ) : (
                    <p className="against__notyet">{boardWords.notYet(state)}</p>
                  )}
                </li>
              );
            })}
          </ul>

          {comparison.files.length === 0 ? (
            <p className="against__nothing">{saysNothingHere(sides)}</p>
          ) : (
            <>
              <h2 className="against__caption">{SAYS.files}</h2>
              {deciding.length === 0 ? null : (
                <ul className="against__files">
                  {deciding.map((file) => (
                    <Row
                      key={file.path}
                      file={file}
                      columns={comparison.attempts}
                      changes={changes}
                      busy={busy}
                      showing={showing === file.path}
                      onShow={() => setShowing((was) => (was === file.path ? null : file.path))}
                    />
                  ))}
                </ul>
              )}
            </>
          )}

          {/* The part nobody has to decide about, said once. */}
          {comparison.sameInAll.length === 0 ? null : (
            <p className="against__same">
              {SAYS.same(comparison.sameInAll.length)}{' '}
              <span className="against__samepaths">{comparison.sameInAll.join(', ')}</span>
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
