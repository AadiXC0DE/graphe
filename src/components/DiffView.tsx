import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { foldIn, foldUnchanged } from '../diff/collapse';
import { WORDS } from '../diff/hunks';
import type { FileChange, Hunk } from '../diff/hunks';
import { piecesOf } from '../diff/paint';
import type { Token } from '../diff/paint';
import {
  BUDGET,
  captionOf,
  commentsByLine,
  entriesOf,
  fileAt,
  fileKeep,
  fileRows,
  indexOfFile,
  indexOfHunk,
  lineAt,
  lineKey,
  lineOf,
  onlySpacing,
  sidesOf,
  tallyOf,
} from '../diff/rows';
import type { Cell, DiffComment, Entry, Reading } from '../diff/rows';
import { sideWords } from '../diff/sidebyside';
import type { Line, Mark, Row } from '../diff/sidebyside';
import { tokensOf } from '../lib/highlight';
import { languageOf } from '../lib/markdown';
import { ago } from '../lib/when';
import { useWindowed } from '../lib/windowed';
import './DiffView.css';

type Props = {
  files: readonly FileChange[];
  /** The pieces that have been dropped. Left off, this is a diff somebody is
   *  reading rather than deciding about, and no keep or drop is drawn. */
  dropped?: ReadonlySet<string>;
  onToggle?: (hunk: Hunk) => void;
  onKeepFile?: (file: FileChange, keep: boolean) => void;
  /** The piece the keyboard is standing on, brought into view as it moves. */
  at?: string | null;
  onAt?: (id: string) => void;
  busy?: boolean;
  /** Ask the conversation about one piece. Both carry file and line, so the
   *  answer starts where the eye already is. */
  onExplain?: (file: string, line: number) => void;
  onFix?: (file: string, line: number) => void;
  /** Remarks already on the change, drawn under the lines they were left on. */
  comments?: readonly DiffComment[];
  /** Left off, no line offers to take a remark and the gutter is as it was. */
  onComment?: (file: string, line: number, text: string) => void | Promise<void>;
  /** More of the file than git sent, around a line at the edge of a piece.
   *  Left off, a fold still opens what is already in hand. */
  onExpand?: (file: string, around: number) => void | Promise<void>;
  /** The screen around this one already lists the files, so the list starts
   *  shut and the code gets the width. The toggle is still there, and it
   *  remembers separately: shutting it beside a list must not shut it where
   *  the list is the only one there is. */
  alreadyListed?: boolean;
};

export const DIFF_SAYS = {
  split: sideWords.split,
  unified: sideWords.unified,
  reading: 'How to read it',
  keep: 'Keep',
  keepAll: 'Keep all',
  dropAll: 'Drop all',
  explain: 'Explain this hunk',
  fix: 'Fix this',
  onlyMoved: 'The file only moved; not a line inside it changed.',
  moved: (from: string, to: string): string => `${from} → ${to}`,
  tally: (added: number, removed: number): string => `+${String(added)} −${String(removed)}`,
  /** Where a piece sits in the file it belongs to. */
  where: (hunk: Hunk): string => {
    const gone = hunk.newLines === 0;
    const from = gone ? hunk.oldStart : hunk.newStart;
    const count = gone ? hunk.oldLines : hunk.newLines;
    return count <= 1 ? `Line ${String(from)}` : `Lines ${String(from)}–${String(from + count - 1)}`;
  },
  rest: (hunks: number): string =>
    `${String(hunks)} more ${hunks === 1 ? 'hunk' : 'hunks'}, not laid out yet.`,
  drawRest: 'Lay out the rest',
  files: 'Files',
  hideFiles: 'Hide the file list',
  showFiles: 'Show the file list',
  whitespace: 'Whitespace',
  whitespaceWhy: 'Show lines where only the spacing changed',
  collapse: 'Collapse unchanged',
  collapseWhy: 'Fold long runs of unchanged lines',
  hidden: (lines: number): string =>
    `Show ${String(lines)} more ${lines === 1 ? 'line' : 'lines'}`,
  more: 'More context',
  moreWhy: 'Read more of the file than git sent',
  between: (lines: number): string =>
    `${String(lines)} more ${lines === 1 ? 'line' : 'lines'}`,
  comment: 'Comment on this line',
  saying: 'Write a comment',
  post: 'Post',
  cancel: 'Cancel',
  whole: (files: number, added: number, removed: number): string =>
    `${String(files)} ${files === 1 ? 'file' : 'files'} · +${String(added)} −${String(removed)}`,
} as const;

/** What the two presses on a hunk send. Written where the model reads them and
 *  not where they are pressed, so the sentence and the button agree. */
export const CHANGE_WORDS = {
  explain: (file: string, line: number): string =>
    `Explain the change at ${file}:${String(line)}. What does it do, and what else does it touch?`,
  fix: (file: string, line: number): string =>
    `Something is wrong with the change at ${file}:${String(line)}. Read it, work out what, and fix it.`,
} as const;

/** Which reading somebody last chose. Remembered, because it is a habit rather
 *  than a decision about one particular change. */
const REMEMBERED = 'graphe.diff.reading';

/** Whether the file list is out. */
const FILES_SHOWN = 'graphe.diff.files';

/** The same habit, kept apart for a diff drawn beside a list of its own files.
 *  Shut there by default: two lists of one thing is one list too many. */
const FILES_BESIDE = 'graphe.diff.files.beside';

/** Whether long runs of unchanged lines are folded. On unless turned off. */
const COLLAPSED = 'graphe.diff.collapse';

function remembered(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function keep(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* A window that cannot remember still draws the diff. */
  }
}

function rememberedReading(): Reading {
  try {
    return localStorage.getItem(REMEMBERED) === 'unified' ? 'unified' : 'split';
  } catch {
    return 'split';
  }
}

function remember(reading: Reading): void {
  try {
    localStorage.setItem(REMEMBERED, reading);
  } catch {
    /* A window that cannot remember still draws the diff. */
  }
}

/** One row of code, before anything has been measured. */
const GUESS_ROW = 22;
/** Rows kept either side of the visible slice. Diff rows are short, so a flick
 *  of the wheel crosses a lot of them. */
const OVER_ROWS = 40;

/** Past this the colour is skipped: a hunk this size is generated, and nobody
 *  is reading it for the syntax. */
const TOO_MUCH = 120_000;

function grammarFor(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? null : languageOf(name.slice(dot + 1));
}

type Painted = { before: readonly (readonly Token[])[]; after: readonly (readonly Token[])[] };

/** The grammar's tokens for one line, from whichever side that line lives on. */
function tokensFor(painted: Painted | undefined, hunk: Hunk, line: Line): readonly Token[] | null {
  if (painted === undefined) return null;
  if (line.after !== null) return painted.after[line.after - hunk.newStart] ?? null;
  if (line.before !== null) return painted.before[line.before - hunk.oldStart] ?? null;
  return null;
}

function Tick() {
  return (
    <svg className="diffview__tick" viewBox="0 0 12 12" width="12" height="12" aria-hidden="true">
      <path d="M2.5 6.2 4.8 8.5 9.5 3.6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Code({
  text,
  tokens,
  marks,
  note,
}: {
  text: string;
  tokens: readonly Token[] | null;
  marks: readonly Mark[];
  note: string | null;
}) {
  const pieces = piecesOf(text, tokens, marks);
  return (
    <code className="diffview__code">
      {pieces.map((piece, at) => (
        <span
          key={at}
          className={piece.marked ? 'diffview__mark' : undefined}
          style={piece.colour === null ? undefined : ({ color: piece.colour } as CSSProperties)}
        >
          {piece.text}
        </span>
      ))}
      {note === null ? null : <span className="diffview__note">{note}</span>}
    </code>
  );
}

/** The folder a path is in, and the file itself. The directory is the quiet
 *  half: two files with the same name are told apart by it, and nothing else
 *  in the row is. */
function dirOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? '' : `${path.slice(0, at)}/`;
}

function nameOf(path: string): string {
  const at = path.lastIndexOf('/');
  return at < 0 ? path : path.slice(at + 1);
}

/** Which of the two tints a line takes, or none. */
function toneOf(line: Line | null): string {
  if (line === null) return 'blank';
  if (line.sign === '+') return 'in';
  if (line.sign === '-') return 'out';
  return 'same';
}

function SplitRow({ row, hunk, painted }: { row: Row; hunk: Hunk; painted: Painted | undefined }) {
  return (
    <div className="diffview__row diffview__row--split">
      <span className="diffview__no">{row.left?.before ?? ''}</span>
      <span className={`diffview__side diffview__side--${toneOf(row.left)}`}>
        {row.left === null ? null : (
          <Code
            text={row.left.text}
            tokens={tokensFor(painted, hunk, row.left)}
            marks={row.leftMarks}
            note={row.leftNote}
          />
        )}
      </span>
      <span className="diffview__no">{row.right?.after ?? ''}</span>
      <span className={`diffview__side diffview__side--${toneOf(row.right)}`}>
        {row.right === null ? null : (
          <Code
            text={row.right.text}
            tokens={tokensFor(painted, hunk, row.right)}
            marks={row.rightMarks}
            note={row.rightNote}
          />
        )}
      </span>
    </div>
  );
}

function OneRow({ cell, hunk, painted }: { cell: Cell; hunk: Hunk; painted: Painted | undefined }) {
  return (
    <div className={`diffview__row diffview__row--one diffview__row--${toneOf(cell.line)}`}>
      <span className="diffview__no">{cell.line.before ?? ''}</span>
      <span className="diffview__no">{cell.line.after ?? ''}</span>
      <span className="diffview__sign" aria-hidden="true">
        {cell.line.sign === '\\' ? '' : cell.line.sign}
      </span>
      <Code
        text={cell.line.text}
        tokens={tokensFor(painted, hunk, cell.line)}
        marks={cell.marks}
        note={cell.note}
      />
    </div>
  );
}

/** A file's heading. Drawn in the list where the file starts, and again pinned
 *  above the scroller once that row has gone past the top. */
function FileTop({
  file,
  dropped,
  busy,
  onKeepFile,
}: {
  file: FileChange;
  dropped: ReadonlySet<string>;
  busy: boolean;
  onKeepFile: ((file: FileChange, keep: boolean) => void) | undefined;
}) {
  const state = fileKeep(file, dropped);
  const added = file.hunks.reduce((sum, hunk) => sum + hunk.added, 0);
  const removed = file.hunks.reduce((sum, hunk) => sum + hunk.removed, 0);
  return (
    <div className={`diffview__filetop ${state === 'none' ? 'diffview__filetop--off' : ''}`}>
      <span className={`diffview__kind diffview__kind--${file.kind}`}>{WORDS.kinds[file.kind]}</span>
      <span className="diffview__path" title={file.path}>
        {file.kind === 'renamed' ? DIFF_SAYS.moved(file.oldPath, file.path) : file.path}
      </span>
      {file.hunks.length === 0 ? null : (
        <span className="diffview__tally">{DIFF_SAYS.tally(added, removed)}</span>
      )}
      {onKeepFile === undefined || file.hunks.length === 0 ? null : (
        <span className="diffview__fileall">
          <button
            type="button"
            className={`diffview__small ${state === 'all' ? 'diffview__small--on' : ''}`}
            onClick={() => onKeepFile(file, true)}
            disabled={busy}
          >
            {DIFF_SAYS.keepAll}
          </button>
          <button
            type="button"
            className={`diffview__small ${state === 'none' ? 'diffview__small--on' : ''}`}
            onClick={() => onKeepFile(file, false)}
            disabled={busy}
          >
            {DIFF_SAYS.dropAll}
          </button>
        </span>
      )}
    </div>
  );
}

/** One remark, under the line it was left on. */
function Said({ said }: { said: DiffComment }) {
  const when = Date.parse(said.at);
  return (
    <div className="diffview__said">
      <span className="diffview__by">{said.author}</span>
      {Number.isNaN(when) ? null : <span className="diffview__when">{ago(when)}</span>}
      <p className="diffview__saidbody">{said.body}</p>
    </div>
  );
}

/**
 * A change, drawn.
 *
 * One flat list of rows for the whole diff, windowed, so a twenty thousand line
 * change is a few dozen elements rather than twenty thousand. The two readings
 * are the same rows arranged differently, and the word marks inside a changed
 * pair survive both, because they come from the pairing rather than from the
 * layout.
 *
 * It draws and nothing else: keeping, dropping and steering all arrive as props
 * and go straight back out. A viewer opened on a past version passes none of
 * them and gets a reader.
 */
export default function DiffView({
  files,
  dropped,
  onToggle,
  onKeepFile,
  at = null,
  onAt,
  busy = false,
  onExplain,
  onFix,
  comments,
  onComment,
  onExpand,
  alreadyListed = false,
}: Props) {
  const [reading, setReading] = useState<Reading>(rememberedReading);
  const [budget, setBudget] = useState(BUDGET);
  /* Folded with `[`. Kept, because whether somebody wants the list is a habit
     rather than a decision about this change. */
  const filesKey = alreadyListed ? FILES_BESIDE : FILES_SHOWN;
  const [listing, setListing] = useState(() =>
    alreadyListed ? remembered(FILES_BESIDE) === 'open' : remembered(FILES_SHOWN) !== 'shut',
  );
  const [spacing, setSpacing] = useState(false);
  const [collapsed, setCollapsed] = useState(() => remembered(COLLAPSED) !== 'no');
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set<string>());
  /* The line a remark is being written on, and the row that is drawn under. */
  const [asking, setAsking] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [topAt, setTopAt] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const heights = useRef<number[]>([]);

  const { entries } = useMemo(
    () => entriesOf(files, reading, budget),
    [files, reading, budget],
  );

  /* A pair whose two sides differ only in spacing is noise in a review of the
     words. Hidden by default, and the toolbar says so rather than the diff
     quietly being shorter than the file. */
  const shown = useMemo(() => {
    if (spacing) return entries;
    return entries.filter((entry) => {
      if (entry.kind === 'split') {
        const { left, right } = entry.row;
        return left === null || right === null || !onlySpacing(left.text, right.text);
      }
      return true;
    });
  }, [entries, spacing]);

  /* Three lines of context either side of a change; the rest is one row that
     says how much is under it. */
  const folded = useMemo(
    () => (collapsed ? foldUnchanged(shown, opened) : shown),
    [shown, collapsed, opened],
  );

  const said = useMemo(() => commentsByLine(comments ?? []), [comments]);

  const { first, last, before, after, measure: mark } = useWindowed(folded.length, {
    scroller,
    list,
    guess: GUESS_ROW,
    over: OVER_ROWS,
  });

  const measure = useCallback(
    (index: number, el: HTMLElement | null) => {
      if (el !== null && el.offsetHeight > 0) heights.current[index] = el.offsetHeight;
      mark(index, el);
    },
    [mark],
  );

  // A different arrangement is a different set of heights.
  useEffect(() => {
    heights.current = [];
  }, [folded]);

  const [painted, setPainted] = useState<ReadonlyMap<string, Painted>>(() => new Map());
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    asked.current = new Set();
    setPainted(new Map());
    setBudget(BUDGET);
    setOpened(new Set<string>());
    setAsking(null);
  }, [files]);

  /* Which row the scroller is actually standing on, rather than where the
     window starts: the pinned heading and the file list both follow it. */
  useEffect(() => {
    const pane = scroller.current;
    if (pane === null) return;
    const settle = (): void => {
      let top = 0;
      let index = 0;
      while (index < folded.length) {
        const tall = heights.current[index];
        const step = tall === undefined || tall <= 0 ? GUESS_ROW : tall;
        if (top + step > pane.scrollTop) break;
        top += step;
        index += 1;
      }
      setTopAt(index);
    };
    pane.addEventListener('scroll', settle, { passive: true });
    settle();
    return () => pane.removeEventListener('scroll', settle);
    // The window sliding means rows have been measured, and the arithmetic
    // above reads those heights.
  }, [folded, first, last]);

  /* Only the pieces somebody is looking at are coloured. The highlighter is a
     large late import and a diff can hold a thousand hunks; asking it for all
     of them would spend the budget on code nobody scrolled to. */
  const inView = useMemo(() => {
    const seen = new Map<string, Hunk>();
    for (let step = first; step < last; step += 1) {
      const entry = folded[step];
      if (entry === undefined || (entry.kind !== 'split' && entry.kind !== 'one')) continue;
      if (!seen.has(entry.hunk.id)) seen.set(entry.hunk.id, entry.hunk);
    }
    return [...seen.values()];
  }, [folded, first, last]);

  useEffect(() => {
    let live = true;
    for (const hunk of inView) {
      if (asked.current.has(hunk.id)) continue;
      asked.current.add(hunk.id);
      const language = grammarFor(hunk.path);
      if (language === null || hunk.text.length > TOO_MUCH) continue;
      const sides = sidesOf(hunk);
      void Promise.all([
        tokensOf(sides.before, language),
        tokensOf(sides.after, language),
      ]).then(([one, other]) => {
        if (!live || (one === null && other === null)) return;
        setPainted((was) => new Map(was).set(hunk.id, { before: one ?? [], after: other ?? [] }));
      });
    }
    return () => {
      live = false;
    };
  }, [inView]);

  /* Instant, never smooth: this rides the arrow keys, and a scroll that eases
     into place turns a held key into a slide. A piece the window has not drawn
     yet is reached by the arithmetic instead. */
  useEffect(() => {
    if (at === null) return;
    const index = indexOfHunk(folded, at);
    if (index < 0) return;
    const drawn = [...(list.current?.querySelectorAll('[data-piece]') ?? [])].find(
      (el) => el.getAttribute('data-piece') === at,
    );
    if (drawn !== undefined) {
      drawn.scrollIntoView({ block: 'nearest' });
      return;
    }
    const pane = scroller.current;
    if (pane === null) return;
    let top = 0;
    for (let step = 0; step < index; step += 1) {
      const tall = heights.current[step];
      top += tall === undefined || tall <= 0 ? GUESS_ROW : tall;
    }
    pane.scrollTop = top;
  }, [at, folded]);

  const here = fileAt(folded, topAt);
  const rows = useMemo(() => fileRows(files, dropped ?? new Set<string>()), [files, dropped]);
  const whole = useMemo(() => tallyOf(rows), [rows]);

  /* The heading pins above the scroller only once its own row has gone past the
     top, so a file never carries two headings at once. */
  const headAt = here === null ? -1 : indexOfFile(folded, here.path);
  const pinned = here !== null && headAt >= 0 && headAt < topAt;

  const open = useCallback((key: string) => {
    setOpened((was) => new Set(was).add(key));
  }, []);

  const goToFile = useCallback(
    (path: string) => {
      const index = indexOfFile(folded, path);
      if (index < 0) return;
      const pane = scroller.current;
      if (pane === null) return;
      let top = 0;
      for (let step = 0; step < index; step += 1) {
        const tall = heights.current[step];
        top += tall === undefined || tall <= 0 ? GUESS_ROW : tall;
      }
      pane.scrollTop = top;
    },
    [folded],
  );

  /* `n` and `p` move a file at a time, `[` folds the list, `e` opens the fold
     nearest the cursor. The hunk keys are the caller's, on the sheet around
     this. */
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, [contenteditable="true"]') != null) return;
      if (event.key === '[') {
        event.preventDefault();
        setListing((was) => {
          keep(filesKey, was ? 'shut' : 'open');
          return !was;
        });
        return;
      }
      if (event.key === 'e') {
        if (at === null) return;
        const key = foldIn(folded, at);
        if (key === null) return;
        event.preventDefault();
        open(key);
        return;
      }
      if (event.key !== 'n' && event.key !== 'p') return;
      const from = rows.findIndex((one) => one.path === (here?.path ?? ''));
      const to = rows[Math.max(0, Math.min(rows.length - 1, from + (event.key === 'n' ? 1 : -1)))];
      if (to === undefined) return;
      event.preventDefault();
      goToFile(to.path);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rows, here, goToFile, at, folded, open, filesKey]);

  const drawEntry = (entry: Entry): React.ReactNode => {
    if (entry.kind === 'file') {
      return (
        <FileTop
          file={entry.file}
          dropped={dropped ?? new Set<string>()}
          busy={busy}
          onKeepFile={onKeepFile}
        />
      );
    }

    if (entry.kind === 'whole') {
      return (
        <p className="diffview__whole">
          {entry.file.binary ? WORDS.whole : DIFF_SAYS.onlyMoved}
        </p>
      );
    }

    if (entry.kind === 'hunk') {
      const hunk = entry.hunk;
      const off = dropped?.has(hunk.id) ?? false;
      const caption = captionOf(hunk);
      const line = lineOf(hunk);
      return (
        <div
          data-piece={hunk.id}
          aria-current={hunk.id === at ? 'true' : undefined}
          className={`diffview__piece ${off ? 'diffview__piece--off' : ''} ${
            hunk.id === at ? 'diffview__piece--here' : ''
          }`}
        >
          {onToggle === undefined ? (
            <span className="diffview__where">{DIFF_SAYS.where(hunk)}</span>
          ) : (
            <button
              type="button"
              className="diffview__toggle"
              aria-pressed={!off}
              disabled={busy}
              onClick={() => {
                onAt?.(hunk.id);
                onToggle(hunk);
              }}
            >
              <span className="diffview__box">
                <Tick />
              </span>
              <span className="diffview__keep">{DIFF_SAYS.keep}</span>
              <span className="diffview__where">{DIFF_SAYS.where(hunk)}</span>
            </button>
          )}
          {caption === '' ? null : <span className="diffview__in">{caption}</span>}
          <span className="diffview__tally">{DIFF_SAYS.tally(hunk.added, hunk.removed)}</span>
          {onExplain === undefined ? null : (
            <button
              type="button"
              className="diffview__ask"
              onClick={() => onExplain(hunk.path, line)}
            >
              {DIFF_SAYS.explain}
            </button>
          )}
          {onFix === undefined ? null : (
            <button type="button" className="diffview__ask" onClick={() => onFix(hunk.path, line)}>
              {DIFF_SAYS.fix}
            </button>
          )}
        </div>
      );
    }

    if (entry.kind === 'rest') {
      return (
        <div className="diffview__rest">
          <span className="diffview__restsaid">{DIFF_SAYS.rest(entry.hunks)}</span>
          <button
            type="button"
            className="diffview__small"
            onClick={() => setBudget((was) => was + BUDGET)}
          >
            {DIFF_SAYS.drawRest}
          </button>
        </div>
      );
    }

    /* The lines between two pieces. Nothing here has them, so the only thing
       to do with the row is ask the caller for them. */
    if (entry.kind === 'gap') {
      return (
        <div className="diffview__folded">
          {onExpand === undefined ? (
            <span className="diffview__between">{DIFF_SAYS.between(entry.hidden)}</span>
          ) : (
            <button
              type="button"
              className="diffview__unfold"
              title={DIFF_SAYS.moreWhy}
              onClick={() => void onExpand(entry.hunk.path, entry.line)}
            >
              {DIFF_SAYS.hidden(entry.hidden)}
            </button>
          )}
        </div>
      );
    }

    if (entry.kind === 'fold') {
      return (
        <div className="diffview__folded">
          <button type="button" className="diffview__unfold" onClick={() => { open(entry.key); }}>
            {DIFF_SAYS.hidden(entry.hidden)}
          </button>
          {onExpand === undefined || !entry.edge ? null : (
            <button
              type="button"
              className="diffview__small"
              title={DIFF_SAYS.moreWhy}
              onClick={() => void onExpand(entry.hunk.path, entry.line)}
            >
              {DIFF_SAYS.more}
            </button>
          )}
        </div>
      );
    }

    const off = dropped?.has(entry.hunk.id) ?? false;
    const body =
      entry.kind === 'split' ? (
        <SplitRow row={entry.row} hunk={entry.hunk} painted={painted.get(entry.hunk.id)} />
      ) : (
        <OneRow cell={entry.cell} hunk={entry.hunk} painted={painted.get(entry.hunk.id)} />
      );
    const line = lineAt(entry);
    const key = line === null ? null : lineKey(entry.hunk.path, line);
    const on = key === null ? undefined : said.get(key);
    const writing = key !== null && key === asking;
    return (
      <>
        <div className={`diffview__lined ${off ? 'diffview__dropped' : ''}`}>
          {body}
          {onComment === undefined || key === null ? null : (
            <button
              type="button"
              className="diffview__add"
              title={DIFF_SAYS.comment}
              aria-label={DIFF_SAYS.comment}
              onClick={() => {
                setAsking(key);
                setDraft('');
              }}
            >
              +
            </button>
          )}
        </div>
        {on?.map((one) => <Said key={one.id} said={one} />)}
        {!writing || line === null || onComment === undefined ? null : (
          <div className="diffview__saying">
            <textarea
              className="diffview__field"
              placeholder={DIFF_SAYS.saying}
              value={draft}
              autoFocus
              onChange={(event) => { setDraft(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Escape') setAsking(null);
              }}
            />
            <div className="diffview__sayrow">
              <button type="button" className="diffview__small" onClick={() => { setAsking(null); }}>
                {DIFF_SAYS.cancel}
              </button>
              <button
                type="button"
                className="diffview__small diffview__small--on"
                disabled={draft.trim() === ''}
                onClick={() => {
                  void onComment(entry.hunk.path, line, draft.trim());
                  setAsking(null);
                  setDraft('');
                }}
              >
                {DIFF_SAYS.post}
              </button>
            </div>
          </div>
        )}
      </>
    );
  };

  return (
    <section className={`diffview diffview--${reading} ${listing ? 'diffview--listing' : ''}`}>
      <div className="diffview__band">
        <button
          type="button"
          className="diffview__fold"
          aria-expanded={listing}
          title={listing ? DIFF_SAYS.hideFiles : DIFF_SAYS.showFiles}
          onClick={() =>
            setListing((was) => {
              keep(filesKey, was ? 'shut' : 'open');
              return !was;
            })
          }
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <rect x="1.75" y="2.75" width="12.5" height="10.5" rx="2.25" stroke="currentColor" strokeWidth="1.5" />
            <path d="M6 2.75v10.5" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        <span className="diffview__here">{here === null ? '' : here.path}</span>
        <span className="diffview__whole">{DIFF_SAYS.whole(whole.files, whole.added, whole.removed)}</span>
        <button
          type="button"
          className={`diffview__way ${spacing ? 'diffview__way--on' : ''}`}
          aria-pressed={spacing}
          title={DIFF_SAYS.whitespaceWhy}
          onClick={() => setSpacing((was) => !was)}
        >
          {DIFF_SAYS.whitespace}
        </button>
        <button
          type="button"
          className={`diffview__way ${collapsed ? 'diffview__way--on' : ''}`}
          aria-pressed={collapsed}
          title={DIFF_SAYS.collapseWhy}
          onClick={() =>
            setCollapsed((was) => {
              keep(COLLAPSED, was ? 'no' : 'yes');
              return !was;
            })
          }
        >
          {DIFF_SAYS.collapse}
        </button>
        <span className="diffview__ways" role="group" aria-label={DIFF_SAYS.reading}>
          <button
            type="button"
            className={`diffview__way ${reading === 'split' ? 'diffview__way--on' : ''}`}
            aria-pressed={reading === 'split'}
            onClick={() => {
              setReading('split');
              remember('split');
            }}
          >
            {DIFF_SAYS.split}
          </button>
          <button
            type="button"
            className={`diffview__way ${reading === 'unified' ? 'diffview__way--on' : ''}`}
            aria-pressed={reading === 'unified'}
            onClick={() => {
              setReading('unified');
              remember('unified');
            }}
          >
            {DIFF_SAYS.unified}
          </button>
        </span>
      </div>

      <div className="diffview__panes">
      {listing ? (
        <nav className="diffview__files scroll--auto" aria-label={DIFF_SAYS.files}>
          {rows.map((one) => (
            <button
              key={one.path}
              type="button"
              className={`diffview__file ${one.path === here?.path ? 'diffview__file--here' : ''} ${
                one.keeping === 'none' ? 'diffview__file--off' : ''
              }`}
              onClick={() => goToFile(one.path)}
              title={one.path}
            >
              <span className={`diffview__filekind diffview__filekind--${one.kind}`} aria-hidden="true">
                {WORDS.kinds[one.kind].slice(0, 1)}
              </span>
              <span className="diffview__filepath">
                <span className="diffview__filedir">{dirOf(one.path)}</span>
                <span className="diffview__filename">{nameOf(one.path)}</span>
              </span>
              <span className="diffview__filetally">
                <span className="diffview__fileadded">+{one.added}</span>
                <span className="diffview__fileremoved">−{one.removed}</span>
              </span>
            </button>
          ))}
        </nav>
      ) : null}

      <div className="diffview__pane">
        {pinned ? (
          <div className="diffview__pinned">
            <FileTop
              file={here}
              dropped={dropped ?? new Set<string>()}
              busy={busy}
              onKeepFile={onKeepFile}
            />
          </div>
        ) : null}
        <div className="diffview__body scroll--auto" ref={scroller}>
          <div className="diffview__list" ref={list}>
            <div style={{ height: before }} aria-hidden="true" />
            {folded.slice(first, last).map((entry, offset) => (
              <div
                key={entry.key}
                ref={(el) => {
                  measure(first + offset, el);
                }}
              >
                {drawEntry(entry)}
              </div>
            ))}
            <div style={{ height: after }} aria-hidden="true" />
          </div>
        </div>
      </div>
      </div>
    </section>
  );
}
