import { useEffect, useRef, useState } from 'react';
import { canHighlight, highlight } from '../lib/highlight';
import './CodeBlock.css';

type Props = {
  /** The code itself, exactly as written. Never HTML. */
  code: string;
  /** A Shiki grammar name, or null to leave it uncoloured. */
  language: string | null;
  /** What the fence said, tidied for a person: "TypeScript", "Shell". */
  label: string | null;
};

/**
 * How long the code has to stop changing before it is worth colouring.
 *
 * While a fence is streaming, its text changes every few tens of milliseconds
 * and every one of those changes would invalidate the colour. Waiting for a
 * pause means a block is plain while it is being written and coloured a moment
 * after it is finished — one upgrade, in one direction, with nothing flickering
 * back and forth in between.
 */
const SETTLED_MS = 120;

/**
 * A fenced block of code.
 *
 * It renders as plain text first, always, and the colour arrives afterwards if
 * it arrives at all. That order is the whole design: the highlighter is a large
 * async import, and no reply should wait on it to become readable. Because both
 * states use the same font, size and line height, the upgrade changes colour and
 * nothing else — no reflow, no jump, nothing to notice.
 *
 * The coloured markup is Shiki's, built from the code as text; the model's own
 * output never reaches the DOM as markup. See src/lib/highlight.ts.
 */
export default function CodeBlock({ code, language, label }: Props) {
  const [coloured, setColoured] = useState<{ code: string; html: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!canHighlight(language)) return;
    let live = true;
    const wait = setTimeout(() => {
      void highlight(code, language).then((html) => {
        if (live && html !== null) setColoured({ code, html });
      });
    }, SETTLED_MS);
    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [code, language]);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  /* Only ever shown for the code it was made from. A block that is still
     growing falls back to plain text rather than showing a coloured version of
     what it used to say. */
  const html = coloured !== null && coloured.code === code ? coloured.html : null;

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => {
        /* Nothing to say. The code is on screen and can be selected by hand. */
      },
    );
  };

  return (
    <div className="codeblock">
      <div className="codeblock__bar">
        <span className="codeblock__lang">{label ?? 'Code'}</span>
        <button type="button" className="codeblock__copy" onClick={copy}>
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>

      {html === null ? (
        <div className="codeblock__code">
          <pre tabIndex={0}>
            <code>{code}</code>
          </pre>
        </div>
      ) : (
        <div
          className="codeblock__code"
          // Shiki's output, never the model's. The code went in as text and
          // came back as spans around that same text.
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}
