import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';

import { WORDS } from '../diff/hunks';
import type { FileChange, Hunk } from '../diff/hunks';
import { piecesOf } from '../diff/paint';
import type { Token } from '../diff/paint';
import {
  BUDGET,
  captionOf,
  entriesOf,
  fileAt,
  fileKeep,
  indexOfHunk,
  lineOf,
  sidesOf,
} from '../diff/rows';
import type { Cell, Entry, Reading } from '../diff/rows';
import { sideWords } from '../diff/sidebyside';
import type { Line, Mark, Row } from '../diff/sidebyside';
import { tokensOf } from '../lib/highlight';
import { languageOf } from '../lib/markdown';
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
}: Props) {
  const [reading, setReading] = useState<Reading>(rememberedReading);
  const [budget, setBudget] = useState(BUDGET);
  const scroller = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const heights = useRef<number[]>([]);

  const { entries } = useMemo(
    () => entriesOf(files, reading, budget),
    [files, reading, budget],
  );

  const { first, last, before, after, measure: mark } = useWindowed(entries.length, {
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
  }, [entries]);

  const [painted, setPainted] = useState<ReadonlyMap<string, Painted>>(() => new Map());
  const asked = useRef<Set<string>>(new Set());

  useEffect(() => {
    asked.current = new Set();
    setPainted(new Map());
    setBudget(BUDGET);
  }, [files]);

  /* Only the pieces somebody is looking at are coloured. The highlighter is a
     large late import and a diff can hold a thousand hunks; asking it for all
     of them would spend the budget on code nobody scrolled to. */
  const inView = useMemo(() => {
    const seen = new Map<string, Hunk>();
    for (let step = first; step < last; step += 1) {
      const entry = entries[step];
      if (entry === undefined || (entry.kind !== 'split' && entry.kind !== 'one')) continue;
      if (!seen.has(entry.hunk.id)) seen.set(entry.hunk.id, entry.hunk);
    }
    return [...seen.values()];
  }, [entries, first, last]);

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
    const index = indexOfHunk(entries, at);
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
  }, [at, entries]);

  const here = fileAt(entries, first);

  const drawEntry = (entry: Entry): React.ReactNode => {
    if (entry.kind === 'file') {
      const file = entry.file;
      const state = fileKeep(file, dropped ?? new Set<string>());
      const added = file.hunks.reduce((sum, hunk) => sum + hunk.added, 0);
      const removed = file.hunks.reduce((sum, hunk) => sum + hunk.removed, 0);
      return (
        <div className={`diffview__filetop ${state === 'none' ? 'diffview__filetop--off' : ''}`}>
          <span className={`diffview__kind diffview__kind--${file.kind}`}>
            {WORDS.kinds[file.kind]}
          </span>
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

    const off = dropped?.has(entry.hunk.id) ?? false;
    const body =
      entry.kind === 'split' ? (
        <SplitRow row={entry.row} hunk={entry.hunk} painted={painted.get(entry.hunk.id)} />
      ) : (
        <OneRow cell={entry.cell} hunk={entry.hunk} painted={painted.get(entry.hunk.id)} />
      );
    return off ? <div className="diffview__dropped">{body}</div> : body;
  };

  return (
    <section className={`diffview diffview--${reading}`}>
      <div className="diffview__band">
        <span className="diffview__here">{here === null ? '' : here.path}</span>
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

      <div className="diffview__body scroll--auto" ref={scroller}>
        <div className="diffview__list" ref={list}>
          <div style={{ height: before }} aria-hidden="true" />
          {entries.slice(first, last).map((entry, offset) => (
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
    </section>
  );
}
