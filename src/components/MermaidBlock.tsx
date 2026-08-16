import { useEffect, useRef, useState } from 'react';
import CodeBlock from './CodeBlock';
import { renderMermaid } from '../lib/mermaid';
import './Mermaid.css';

type Props = {
  /** The diagram text, exactly as written. Never HTML. */
  code: string;
  /** The still-writing mark, when this block is the last thing said. */
  tail?: React.ReactNode;
};

/** How long the text has to stop changing before it is worth drawing. Same
 *  rule as CodeBlock's SETTLED_MS: a diagram that is still streaming would be
 *  redrawn every few tens of milliseconds, so we wait for a pause instead. */
const SETTLED_MS = 120;

/**
 * A diagram, in the stream of a reply.
 *
 * It renders as its plain code first, always, and the picture arrives
 * afterwards if it arrives at all. Same order as colouring in CodeBlock, and
 * for the same reason: the engine is a large async import, no reply should
 * wait on it to become readable, and a diagram the engine cannot draw stays a
 * code block rather than vanishing.
 *
 * The SVG is the engine's own sanitised output, never the model's text — the
 * diagram went in as a string and only the engine's picture comes back. See
 * src/lib/mermaid.ts for the security side.
 */
export default function MermaidBlock({ code, tail }: Props) {
  const [state, setState] = useState<{ code: string; svg: string } | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    /* A block that is still being written stays plain text. */
    if (tail !== undefined) {
      setState(null);
      return;
    }
    let live = true;
    const root = rootRef.current;
    if (root === null) return;

    const wait = setTimeout(() => {
      const run = () => {
        void renderMermaid(code).then((svg) => {
          if (live && svg !== null) setState({ code, svg });
        });
      };
      /* Off-screen diagrams wait until they are near the viewport — history
         reloads render a lot of blocks nobody is looking at yet. */
      if (typeof IntersectionObserver === 'undefined') {
        run();
        return;
      }
      const observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) {
            observer.disconnect();
            run();
          }
        },
        { rootMargin: '160px 0px' },
      );
      observer.observe(root);
    }, SETTLED_MS);

    return () => {
      live = false;
      clearTimeout(wait);
    };
  }, [code, tail]);

  const svg = state !== null && state.code === code ? state.svg : null;

  return (
    <div className="mermaid" ref={rootRef}>
      {svg === null ? (
        <CodeBlock code={code} language={null} label="Diagram" tail={tail} />
      ) : (
        /* The engine's output, never the model's. */
        <div className="mermaid__svg" dangerouslySetInnerHTML={{ __html: svg }} />
      )}
    </div>
  );
}
