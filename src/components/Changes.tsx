import { useEffect, useMemo, useRef, useState } from 'react';

import { WORDS, countsOf, diffOf, parseDiff } from '../diff/hunks';
import type { FileChange, Hunk } from '../diff/hunks';
import './Changes.css';
import './Sheet.css';

type Props = {
  open: boolean;
  /** Unified diff text, or null while it is being read. */
  diff: string | null;
  busy?: boolean;
  onClose: () => void;
  /** The person kept a subset. Hand back a valid unified diff of ONLY those
   *  hunks, built with diffOf(). Empty selection must never call this. */
  onKeep: (diff: string) => void;
};

export const SAYS = {
  heading: 'What changed',
  reading: 'Reading the change',
  readingDetail: 'A moment. This is being read off the disk.',
  nothing: 'Nothing has changed.',
  keptNothing: 'Nothing kept.',
  nothingDetail: 'When there is work to look through, it will show up here.',
  keepAll: 'Keep all',
  dropAll: 'Drop all',
  keep: 'Keep',
  working: 'Keeping…',
  close: 'Close',
  moved: (from: string, to: string): string => `${from} → ${to}`,
  tally: (added: number, removed: number): string => `+${String(added)} −${String(removed)}`,
  /** Where a piece sits in the file it belongs to. */
  where: (hunk: Hunk): string => {
    const gone = hunk.newLines === 0;
    const from = gone ? hunk.oldStart : hunk.newStart;
    const count = gone ? hunk.oldLines : hunk.newLines;
    return count <= 1 ? `Line ${String(from)}` : `Lines ${String(from)}–${String(from + count - 1)}`;
  },
  confirm: (kept: number): string =>
    kept === 0 ? 'Nothing kept' : `Keep ${String(kept)} ${kept === 1 ? 'change' : 'changes'}`,
} as const;

/* -------------------------------------------------------------------------- */
/* The logic, kept out of the markup so it can be read and tested on its own   */
/* -------------------------------------------------------------------------- */

/** Every piece, in the order the eye meets them. One flat list, so moving down
 *  from the last piece of a file lands on the first piece of the next. */
export function orderOf(files: readonly FileChange[]): readonly string[] {
  return files.flatMap((file) => file.hunks.map((hunk) => hunk.id));
}

/** One step from where the keyboard is. It stops at the ends rather than
 *  wrapping: coming back round to the top of a review reads as a lost place. */
export function stepBy(
  order: readonly string[],
  at: string | null,
  step: number,
): string | null {
  if (order.length === 0) return null;
  const here = at === null ? -1 : order.indexOf(at);
  if (here === -1) return order[step < 0 ? order.length - 1 : 0] ?? null;
  const next = Math.min(order.length - 1, Math.max(0, here + step));
  return order[next] ?? null;
}

/** One piece, flipped. */
export function withHunk(dropped: ReadonlySet<string>, id: string): ReadonlySet<string> {
  const next = new Set(dropped);
  if (!next.delete(id)) next.add(id);
  return next;
}

/** A whole file's pieces, and nobody else's. */
export function withFile(
  dropped: ReadonlySet<string>,
  file: FileChange,
  keep: boolean,
): ReadonlySet<string> {
  const next = new Set(dropped);
  for (const hunk of file.hunks) {
    if (keep) next.delete(hunk.id);
    else next.add(hunk.id);
  }
  return next;
}

/** What a file's own toggle should read as. A file with no pieces to choose
 *  between — a picture, a move — counts as kept, because it is. */
export function fileKeep(file: FileChange, dropped: ReadonlySet<string>): 'all' | 'some' | 'none' {
  const off = file.hunks.filter((hunk) => dropped.has(hunk.id)).length;
  if (off === 0) return 'all';
  return off === file.hunks.length ? 'none' : 'some';
}

/**
 * The files with only the kept pieces left in them, for counting.
 *
 * Counting only. The patch cannot be built from this: `diffOf` works out how
 * far each kept piece has moved from the dropped ones above it, and a list with
 * the dropped ones already removed would put every line number back where the
 * whole change would have left it.
 */
export function keptOf(
  files: readonly FileChange[],
  dropped: ReadonlySet<string>,
): readonly FileChange[] {
  const out: FileChange[] = [];
  for (const file of files) {
    const hunks = file.hunks.filter((hunk) => !dropped.has(hunk.id));
    if (hunks.length === 0) continue;
    out.push({ ...file, hunks });
  }
  return out;
}

/** The patch that goes back, holding the kept pieces and nothing else. */
export function patchOf(files: readonly FileChange[], dropped: ReadonlySet<string>): string {
  return diffOf(files, (hunk) => !dropped.has(hunk.id));
}

export type Line = {
  /** `\\` is the note about a missing last newline, which belongs to no side. */
  sign: '+' | '-' | ' ' | '\\';
  text: string;
  before: number | null;
  after: number | null;
};

function bare(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/** One piece's body, with the line numbers each side would give it. */
export function linesOf(hunk: Hunk): readonly Line[] {
  const rows: Line[] = [];
  const all = hunk.text.split('\n');
  let before = hunk.oldStart;
  let after = hunk.newStart;
  for (let at = 1; at < all.length; at += 1) {
    const raw = all[at] ?? '';
    // The last entry is the text's own closing newline, not a line.
    if (at === all.length - 1 && raw === '') break;
    const line = bare(raw);
    const mark = line[0] ?? ' ';
    if (mark === '\\') {
      rows.push({ sign: '\\', text: line, before: null, after: null });
    } else if (mark === '+') {
      rows.push({ sign: '+', text: line.slice(1), before: null, after });
      after += 1;
    } else if (mark === '-') {
      rows.push({ sign: '-', text: line.slice(1), before, after: null });
      before += 1;
    } else {
      rows.push({ sign: ' ', text: line.slice(1), before, after });
      before += 1;
      after += 1;
    }
  }
  return rows;
}

/** The name git prints after the second `@@` — the function a piece sits in. */
export function captionOf(hunk: Hunk): string {
  const head = bare(hunk.text.split('\n')[0] ?? '');
  const found = /^@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@/.exec(head);
  return found === null ? '' : head.slice(found[0].length).trim();
}

/* -------------------------------------------------------------------------- */

function Tick() {
  return (
    <svg className="changes__tick" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.5 6.2 4.8 8.5 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * A change, read piece by piece, with a yes or no on each one.
 *
 * Everything is kept until it is unkept, and a dropped piece stays exactly where
 * it was in the list. Toggling is the thing that happens twenty times in a row
 * here, so it costs colour and opacity and never a line of layout — the piece
 * under the cursor is still under the cursor afterwards.
 */
export default function Changes({ open, diff, busy = false, onClose, onKeep }: Props) {
  const body = useRef<HTMLDivElement>(null);
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [at, setAt] = useState<string | null>(null);

  const files = useMemo(() => (diff === null ? [] : parseDiff(diff)), [diff]);
  const order = useMemo(() => orderOf(files), [files]);
  const here = at !== null && order.includes(at) ? at : (order[0] ?? null);

  const kept = useMemo(() => countsOf(keptOf(files, dropped)), [files, dropped]);
  const canKeep = kept.hunks > 0 && !busy;

  // A different change is a different set of choices.
  useEffect(() => {
    setDropped(new Set<string>());
    setAt(null);
  }, [diff]);

  /* The list takes the focus, not the way out. Space and Enter belong to
     whatever the keyboard is standing on, and standing on the Close button
     means the first press of either does the one thing nobody meant. */
  useEffect(() => {
    if (open) body.current?.focus();
  }, [open]);

  /* Instant, never smooth: this rides the arrow keys, and a scroll that eases
     into place turns a held key into a slide. */
  useEffect(() => {
    if (here === null) return;
    body.current
      ?.querySelector(`[data-piece="${CSS.escape(here)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [here]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') != null) return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        onClose();
        return;
      }
      if (event.key === 'j' || event.key === 'ArrowDown') {
        event.preventDefault();
        setAt(stepBy(order, here, 1));
        return;
      }
      if (event.key === 'k' || event.key === 'ArrowUp') {
        event.preventDefault();
        setAt(stepBy(order, here, -1));
        return;
      }
      if (event.key === 'a') {
        setDropped(new Set<string>());
        return;
      }
      if (event.key === 'd') {
        setDropped(new Set(order));
        return;
      }
      // A press on a focused control is that control's, not ours.
      if (target?.closest('button, a, select') != null) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (here !== null) setDropped((was) => withHunk(was, here));
        return;
      }
      if (event.key === 'Enter' && kept.hunks > 0 && !busy) {
        event.preventDefault();
        onKeep(patchOf(files, dropped));
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, order, here, files, dropped, kept.hunks, busy, onClose, onKeep]);

  if (!open) return null;

  const head = (
    <header className="sheet__top">
      <div className="sheet__titles">
        <h1 className="sheet__title">{SAYS.heading}</h1>
        {/* The line under the heading says what would be kept, so it has to
            stop short of "there is nothing here" when there plainly is. */}
        {diff !== null && files.length === 0 ? null : (
          <p className="changes__count">
            {diff === null
              ? SAYS.reading
              : kept.hunks === 0
                ? SAYS.keptNothing
                : WORDS.summary(kept)}
          </p>
        )}
      </div>

      <div className="sheet__chips">
        {files.length === 0 ? null : (
          <>
            <button
              type="button"
              className="changes__all"
              onClick={() => setDropped(new Set<string>())}
              disabled={busy}
            >
              {SAYS.keepAll}
              <kbd className="sheet__key">A</kbd>
            </button>
            <button
              type="button"
              className="changes__all"
              onClick={() => setDropped(new Set(order))}
              disabled={busy}
            >
              {SAYS.dropAll}
              <kbd className="sheet__key">D</kbd>
            </button>
          </>
        )}
      </div>

      {files.length === 0 ? null : (
        <div className="sheet__save">
          <button
            type="button"
            className="sheet__savebtn"
            disabled={!canKeep}
            onClick={() => {
              if (!canKeep) return;
              onKeep(patchOf(files, dropped));
            }}
          >
            {busy ? SAYS.working : SAYS.confirm(kept.hunks)}
          </button>
        </div>
      )}

      <button type="button" className="sheet__close" onClick={onClose}>
        {SAYS.close}
        <kbd className="sheet__key">Esc</kbd>
      </button>
    </header>
  );

  if (diff === null) {
    return (
      <section className="sheet changes" aria-label={SAYS.heading}>
        {head}
        <div className="sheet__body scroll--auto">
          <div className="changes__blank">
            <h2 className="changes__blanktitle">{SAYS.reading}</h2>
            <p className="changes__blankdetail">{SAYS.readingDetail}</p>
          </div>
        </div>
      </section>
    );
  }

  if (files.length === 0) {
    return (
      <section className="sheet changes" aria-label={SAYS.heading}>
        {head}
        <div className="sheet__body scroll--auto">
          <div className="changes__blank">
            <h2 className="changes__blanktitle">{SAYS.nothing}</h2>
            <p className="changes__blankdetail">{SAYS.nothingDetail}</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="sheet changes" aria-label={SAYS.heading}>
      {head}

      <div className="sheet__body scroll--auto" ref={body} tabIndex={-1}>
        <ol className="changes__files">
          {files.map((file) => {
            const state = fileKeep(file, dropped);
            const added = file.hunks.reduce((sum, hunk) => sum + hunk.added, 0);
            const removed = file.hunks.reduce((sum, hunk) => sum + hunk.removed, 0);
            return (
              <li
                key={`${file.oldPath}>${file.path}`}
                className={`changes__file ${state === 'none' ? 'changes__file--off' : ''}`}
              >
                <div className="changes__filetop">
                  <span className={`changes__kind changes__kind--${file.kind}`}>
                    {WORDS.kinds[file.kind]}
                  </span>
                  <span className="changes__path">
                    {file.kind === 'renamed' ? SAYS.moved(file.oldPath, file.path) : file.path}
                  </span>
                  {file.hunks.length === 0 ? null : (
                    <span className="changes__tally">{SAYS.tally(added, removed)}</span>
                  )}
                  {file.hunks.length === 0 ? null : (
                    <span className="changes__fileall">
                      <button
                        type="button"
                        className={`changes__small ${state === 'all' ? 'changes__small--on' : ''}`}
                        onClick={() => setDropped((was) => withFile(was, file, true))}
                        disabled={busy}
                      >
                        {SAYS.keepAll}
                      </button>
                      <button
                        type="button"
                        className={`changes__small ${state === 'none' ? 'changes__small--on' : ''}`}
                        onClick={() => setDropped((was) => withFile(was, file, false))}
                        disabled={busy}
                      >
                        {SAYS.dropAll}
                      </button>
                    </span>
                  )}
                </div>

                {file.hunks.length === 0 ? (
                  <p className="changes__whole">
                    {file.binary ? WORDS.whole : 'The file only moved; not a line inside it changed.'}
                  </p>
                ) : null}

                {file.hunks.map((hunk) => {
                  const off = dropped.has(hunk.id);
                  const caption = captionOf(hunk);
                  return (
                    <div
                      key={hunk.id}
                      data-piece={hunk.id}
                      aria-current={hunk.id === here ? 'true' : undefined}
                      className={`changes__piece ${off ? 'changes__piece--off' : ''} ${
                        hunk.id === here ? 'changes__piece--here' : ''
                      }`}
                    >
                      <button
                        type="button"
                        className="changes__piecetop"
                        aria-pressed={!off}
                        disabled={busy}
                        onClick={() => {
                          setAt(hunk.id);
                          setDropped((was) => withHunk(was, hunk.id));
                        }}
                      >
                        <span className="changes__box">
                          <Tick />
                        </span>
                        <span className="changes__keep">{SAYS.keep}</span>
                        <span className="changes__where">{SAYS.where(hunk)}</span>
                        {caption === '' ? null : <span className="changes__in">{caption}</span>}
                        <span className="changes__tally">{SAYS.tally(hunk.added, hunk.removed)}</span>
                      </button>

                      <div className="changes__lines scroll--auto">
                        {linesOf(hunk).map((line, index) => (
                          <div
                            key={`${hunk.id}:${String(index)}`}
                            className={`changes__line changes__line--${
                              line.sign === '+' ? 'in' : line.sign === '-' ? 'out' : line.sign === '\\' ? 'note' : 'same'
                            }`}
                          >
                            <span className="changes__no">{line.before ?? ''}</span>
                            <span className="changes__no">{line.after ?? ''}</span>
                            <span className="changes__sign" aria-hidden="true">
                              {line.sign === '\\' ? '' : line.sign}
                            </span>
                            <code className="changes__code">{line.text}</code>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </li>
            );
          })}
        </ol>
      </div>
    </section>
  );
}
