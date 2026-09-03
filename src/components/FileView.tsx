import { useEffect, useMemo, useState } from 'react';
import { useCopying } from '../lib/copying';
import { canHighlight, highlight } from '../lib/highlight';
import { languageLabel, languageOf } from '../lib/markdown';
import './FileView.css';

type Props = {
  /** The file's own path, exactly as it is. */
  path: string;
  /** Its contents. Null while it is still on its way. */
  text: string | null;
  /** Why it cannot be shown, in plain words. */
  trouble?: string | null;
  /** Left off, no way out is drawn. */
  onClose?: () => void;
  /** Read in the thread's own column rather than in a card over it: every
   *  line, numbered, with a way of finding a word in it. */
  whole?: boolean;
  onWhole?: (want: boolean) => void;
  /** Ask the conversation about a run of lines. */
  onAsk?: (path: string, from: number, to: number) => void;
};

/** How much of a long file appears at once, and how much each "show more" adds.
 *  Enough to read a whole component; far short of what it costs to draw fifty
 *  thousand lines nobody scrolled to. */
const CHUNK = 1200;

/** Past this, the colouring is skipped whatever the file is called: a single
 *  enormous line is the one shape a highlighter is slow on. */
const TOO_MUCH = 400_000;

/** The grammar a filename implies, from its ending alone. */
function endingOf(path: string): string | null {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? null : name.slice(dot + 1);
}

/**
 * One file, to read and nothing else.
 *
 * The path is at the top in plain sight, which everywhere else in this product
 * would be wrong — it is right here for the same reason "Show me" is allowed to
 * print a command: somebody who has opened this asked what things are actually
 * called, and a friendlier paraphrase would be useless and faintly patronising
 * at once.
 *
 * Nothing here can be edited. The way to change a file is to ask for the change,
 * and a text box that looked editable but was not would be a worse lie than no
 * text box at all.
 */
export default function FileView({ path, text, trouble, onClose, whole = false, onWhole, onAsk }: Props) {
  const [cap, setCap] = useState(CHUNK);
  const [coloured, setColoured] = useState<{ code: string; html: string } | null>(null);
  const [finding, setFinding] = useState<string | null>(null);
  const [at, setAt] = useState(0);
  const copying = useCopying({ idle: 'Copy path' });

  const ending = endingOf(path);
  const language = languageOf(ending);
  const label = languageLabel(ending);

  /* A file ending in a newline is not a file with an empty last line, and
     numbering one would be a row nobody wrote. */
  const lines = useMemo(() => {
    if (text === null) return [];
    const split = text.split('\n');
    if (split.length > 1 && split[split.length - 1] === '') split.pop();
    return split;
  }, [text]);
  // Read whole, there is nothing to hold back: the highlighter already skips
  // anything over 400 KB, which is the only reason a cap existed.
  const shown = useMemo(() => (whole ? lines : lines.slice(0, cap)), [lines, cap, whole]);

  /** Every line the word is on, in order. */
  const found = useMemo(() => {
    const needle = (finding ?? '').trim().toLowerCase();
    if (needle === '') return [] as number[];
    const rows: number[] = [];
    lines.forEach((line, index) => {
      if (line.toLowerCase().includes(needle)) rows.push(index + 1);
    });
    return rows;
  }, [lines, finding]);

  useEffect(() => {
    setAt(0);
  }, [finding]);

  const standing = found[at] ?? null;
  useEffect(() => {
    if (standing === null) return;
    document
      .querySelector(`.fileview__code [data-line="${String(standing)}"]`)
      ?.scrollIntoView({ block: 'center' });
  }, [standing]);
  const code = useMemo(() => shown.join('\n'), [shown]);

  /** Nothing to read: a file full of bytes rather than words. */
  const binary = text !== null && text.includes('\u0000');

  useEffect(() => {
    setCap(CHUNK);
    setColoured(null);
    setFinding(null);
  }, [path]);

  /* Only while it has the column. In the card over the thread the keys belong
     to the conversation behind it. */
  useEffect(() => {
    if (!whole) return;
    const onKey = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'f') {
        event.preventDefault();
        setFinding((was) => (was === null ? '' : was));
        return;
      }
      if (event.key === 'Escape' && finding !== null) {
        event.preventDefault();
        event.stopPropagation();
        setFinding(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [whole, finding]);

  useEffect(() => {
    if (binary || !canHighlight(language) || code === '' || code.length > TOO_MUCH) return;
    let live = true;
    void highlight(code, language).then((html) => {
      if (live && html !== null) setColoured({ code, html });
    });
    return () => {
      live = false;
    };
  }, [code, language, binary]);

  const html = coloured !== null && coloured.code === code ? coloured.html : null;
  const rest = lines.length - shown.length;
  const cut = path.lastIndexOf('/');
  const where = cut === -1 ? '' : path.slice(0, cut + 1);
  const name = cut === -1 ? path : path.slice(cut + 1);

  return (
    <section className="fileview" aria-label={name}>
      <div className="fileview__bar">
        <span className="fileview__path" title={path}>
          <span className="fileview__where">{where}</span>
          <span className="fileview__file">{name}</span>
        </span>

        <span className="fileview__tail">
          {label === null ? null : <span className="fileview__kind">{label}</span>}
          <button type="button" className="fileview__act" onClick={() => copying.copy(path)}>
            {copying.label}
          </button>
          {onWhole === undefined ? null : (
            <button
              type="button"
              className="fileview__act"
              onClick={() => onWhole(!whole)}
              title={whole ? 'Back to the conversation' : 'Read it in full ⌘⇧E'}
            >
              {whole ? 'Back' : 'Expand'}
            </button>
          )}
          {onClose === undefined ? null : (
            <button type="button" className="fileview__act" onClick={onClose}>
              Close
            </button>
          )}
        </span>
      </div>

      {finding === null ? null : (
        <div className="fileview__find" role="search">
          <input
            type="search"
            className="fileview__findbox"
            autoFocus
            value={finding}
            placeholder="Find in this file"
            aria-label="Find in this file"
            onChange={(event) => setFinding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter') return;
              event.preventDefault();
              setAt((was) => (found.length === 0 ? 0 : (was + (event.shiftKey ? -1 : 1) + found.length) % found.length));
            }}
          />
          <span className="fileview__foundcount">
            {finding.trim() === ''
              ? ''
              : found.length === 0
                ? 'Not in this file'
                : `${String(at + 1)} of ${String(found.length)}`}
          </span>
          <button type="button" className="fileview__act" onClick={() => setFinding(null)}>
            Done
          </button>
        </div>
      )}

      {trouble !== null && trouble !== undefined && trouble !== '' ? (
        <p className="fileview__say">{trouble}</p>
      ) : text === null ? (
        <p className="fileview__say">Opening it…</p>
      ) : binary ? (
        <p className="fileview__say">This one is not text, so there is nothing to read here.</p>
      ) : (
        <>
          {html === null ? (
            <div className="fileview__code scroll--auto">
              <pre tabIndex={0}>
                <code>
                  {shown.map((line, index) => (
                    // Index is the line number here, which is the one place it
                    // is genuinely the identity of the row.
                    <span
                      className={`line ${found[at] === index + 1 ? 'line--found' : ''}`}
                      data-line={index + 1}
                      key={index}
                    >
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          ) : (
            <div
              className="fileview__code scroll--auto"
              // Shiki's own markup, built from the file as text. See
              // src/lib/highlight.ts.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {!whole || onAsk === undefined || lines.length === 0 ? null : (
            <div className="fileview__more">
              <button
                type="button"
                className="fileview__act"
                onClick={() => onAsk(path, 1, lines.length)}
              >
                Ask about this file
              </button>
            </div>
          )}

          {rest > 0 && !whole ? (
            <div className="fileview__more">
              <span className="fileview__rest">
                {shown.length} of {lines.length} lines
              </span>
              <button type="button" className="fileview__act" onClick={() => setCap(cap + CHUNK)}>
                Show more
              </button>
            </div>
          ) : null}
        </>
      )}
    </section>
  );
}
