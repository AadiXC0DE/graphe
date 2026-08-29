import { useEffect, useState, type ReactNode } from 'react';
import { useCopying } from '../lib/copying';
import { canHighlight, highlight } from '../lib/highlight';
import Clipped, { howMuch } from './Clipped';
import './CodeBlock.css';

type Props = {
  /** The code itself, exactly as written. Never HTML. */
  code: string;
  /** A Shiki grammar name, or null to leave it uncoloured. */
  language: string | null;
  /** What the fence said, tidied for a person: "TypeScript", "Shell". */
  label: string | null;
  /**
   * The still-writing mark, when this block is the last thing said.
   *
   * It goes *inside* the code, after the final character, because that is where
   * the writing has got to. Rendered as a sibling underneath — which is what
   * happened before — it became an orange bar alone on a line below a finished-
   * looking box, and the one thing a caret must never say is "something else is
   * about to appear down here".
   */
  tail?: ReactNode;
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
export default function CodeBlock({ code, language, label, tail }: Props) {
  const [coloured, setColoured] = useState<{ code: string; html: string } | null>(null);
  const copying = useCopying();

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

  /* Only ever shown for the code it was made from. A block that is still
     growing falls back to plain text rather than showing a coloured version of
     what it used to say.

     A block carrying the still-writing mark is by definition the one being
     written, so it stays plain: the coloured path is a string of markup and
     there is nowhere inside it to put a React node. In practice this changes
     nothing — a fence that is still growing has never settled long enough to be
     coloured — but it means the caret is never the reason the two paths
     disagree. */
  const html =
    tail === undefined && coloured !== null && coloured.code === code ? coloured.html : null;

  const block =
    html === null ? (
      <div className="codeblock__code">
        <pre tabIndex={0}>
          <code>
            {code}
            {tail}
          </code>
        </pre>
      </div>
    ) : (
      <div
        className="codeblock__code"
        // Shiki's output, never the model's. The code went in as text and
        // came back as spans around that same text.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );

  return (
    <div className="codeblock">
      <div className="codeblock__bar">
        <span className="codeblock__lang">{label ?? 'Code'}</span>
        <button type="button" className="codeblock__copy" onClick={() => copying.copy(code)}>
          {copying.label}
        </button>
      </div>

      {/* A thousand-line dump is not a reply somebody reads. Cut it, say how
          much there is, and leave the full thing one press away. */}
      {tail === undefined ? (
        <Clipped how={howMuch(code)} label="Show all of it" height={280}>
          {block}
        </Clipped>
      ) : (
        block
      )}
    </div>
  );
}
