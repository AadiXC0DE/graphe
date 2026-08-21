import { useEffect, useMemo, useRef, useState } from 'react';
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
export default function FileView({ path, text, trouble, onClose }: Props) {
  const [cap, setCap] = useState(CHUNK);
  const [coloured, setColoured] = useState<{ code: string; html: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
  const shown = useMemo(() => lines.slice(0, cap), [lines, cap]);
  const code = useMemo(() => shown.join('\n'), [shown]);

  /** Nothing to read: a file full of bytes rather than words. */
  const binary = text !== null && text.includes('\u0000');

  useEffect(() => {
    setCap(CHUNK);
    setColoured(null);
  }, [path]);

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

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  const html = coloured !== null && coloured.code === code ? coloured.html : null;
  const rest = lines.length - shown.length;
  const cut = path.lastIndexOf('/');
  const where = cut === -1 ? '' : path.slice(0, cut + 1);
  const name = cut === -1 ? path : path.slice(cut + 1);

  const copy = () => {
    void navigator.clipboard?.writeText(path).then(
      () => {
        setCopyFailed(false);
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => {
        // Said, rather than swallowed. A Copy that quietly does nothing leaves
        // whatever was on the clipboard before, which reads as copying the
        // wrong thing.
        setCopyFailed(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopyFailed(false), 2600);
      },
    );
  };

  return (
    <section className="fileview" aria-label={name}>
      <div className="fileview__bar">
        <span className="fileview__path" title={path}>
          <span className="fileview__where">{where}</span>
          <span className="fileview__file">{name}</span>
        </span>

        <span className="fileview__tail">
          {label === null ? null : <span className="fileview__kind">{label}</span>}
          <button type="button" className="fileview__act" onClick={copy}>
            {copyFailed ? 'Press \u2318C' : copied ? 'Copied' : 'Copy path'}
          </button>
          {onClose === undefined ? null : (
            <button type="button" className="fileview__act" onClick={onClose}>
              Close
            </button>
          )}
        </span>
      </div>

      {trouble !== null && trouble !== undefined && trouble !== '' ? (
        <p className="fileview__say">{trouble}</p>
      ) : text === null ? (
        <p className="fileview__say">Opening it…</p>
      ) : binary ? (
        <p className="fileview__say">This one is not text, so there is nothing to read here.</p>
      ) : (
        <>
          {html === null ? (
            <div className="fileview__code">
              <pre tabIndex={0}>
                <code>
                  {shown.map((line, index) => (
                    // Index is the line number here, which is the one place it
                    // is genuinely the identity of the row.
                    <span className="line" key={index}>
                      {line}
                      {'\n'}
                    </span>
                  ))}
                </code>
              </pre>
            </div>
          ) : (
            <div
              className="fileview__code"
              // Shiki's own markup, built from the file as text. See
              // src/lib/highlight.ts.
              dangerouslySetInnerHTML={{ __html: html }}
            />
          )}

          {rest > 0 ? (
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
