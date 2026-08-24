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

  // overlay controls
  const [scale, setScale] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef({ x: 0, y: 0 });
  const offsetStart = useRef({ x: 0, y: 0 });
  const [copied, setCopied] = useState(false);
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
    },
    [],
  );

  // reset transform when diagram changes
  useEffect(() => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  }, [state?.svg]);

  const svg = state !== null && state.code === code ? state.svg : null;

  const copy = () => {
    void navigator.clipboard?.writeText(code).then(
      () => {
        setCopied(true);
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied(false), 1600);
      },
      () => {
        setCopied(false);
      },
    );
  };

  const downloadSVG = () => {
    if (svg === null) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'diagram.svg';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadPNG = () => {
    if (svg === null) return;
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const width = img.width || 800;
      const height = img.height || 600;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.scale(dpr, dpr);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      if (typeof canvas.toBlob === 'function') {
        canvas.toBlob((pngBlob) => {
          if (pngBlob === null) return;
          const pngUrl = URL.createObjectURL(pngBlob);
          const a = document.createElement('a');
          a.href = pngUrl;
          a.download = 'diagram.png';
          a.click();
          URL.revokeObjectURL(pngUrl);
        }, 'image/png');
      } else {
        const pngUrl = canvas.toDataURL('image/png');
        const a = document.createElement('a');
        a.href = pngUrl;
        a.download = 'diagram.png';
        a.click();
      }
    };
    img.onerror = () => URL.revokeObjectURL(url);
    img.src = url;
  };

  const zoomIn = () => setScale((s) => Math.min(3, Math.round((s + 0.25) * 100) / 100));
  const zoomOut = () => setScale((s) => Math.max(0.5, Math.round((s - 0.25) * 100) / 100));
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  const onPointerDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };

  const onPointerMove = (e: React.MouseEvent) => {
    if (!dragging) return;
    const dx = e.clientX - dragStart.current.x;
    const dy = e.clientY - dragStart.current.y;
    setOffset({ x: offsetStart.current.x + dx, y: offsetStart.current.y + dy });
  };

  const onPointerUp = () => {
    setDragging(false);
  };

  return (
    <div className="mermaid" ref={rootRef}>
      {svg === null ? (
        <CodeBlock code={code} language={null} label="Diagram" tail={tail} />
      ) : (
        <div className="mermaid__wrap">
          <div className="mermaid__toolbar" role="toolbar" aria-label="Diagram controls">
            <button
              type="button"
              className="mermaid__btn"
              onClick={copy}
              aria-label="Copy diagram source"
              title={copied ? 'Copied' : 'Copy'}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
            <button
              type="button"
              className="mermaid__btn"
              onClick={downloadSVG}
              aria-label="Download SVG"
              title="Download SVG"
            >
              SVG
            </button>
            <button
              type="button"
              className="mermaid__btn"
              onClick={downloadPNG}
              aria-label="Download PNG"
              title="Download PNG"
            >
              PNG
            </button>
            <button
              type="button"
              className="mermaid__btn mermaid__btn--zoom"
              onClick={zoomOut}
              aria-label="Zoom out"
              title="Zoom out"
            >
              -
            </button>
            <button
              type="button"
              className="mermaid__btn mermaid__btn--zoom"
              onClick={zoomIn}
              aria-label="Zoom in"
              title="Zoom in"
            >
              +
            </button>
            <button
              type="button"
              className="mermaid__btn"
              onClick={reset}
              aria-label="Reset zoom and pan"
              title="Reset"
            >
              Reset
            </button>
          </div>
          <div
            className={`mermaid__viewport${dragging ? ' mermaid__viewport--dragging' : ''}`}
            onMouseDown={onPointerDown}
            onMouseMove={onPointerMove}
            onMouseUp={onPointerUp}
            onMouseLeave={onPointerUp}
          >
            {/* The engine's output, never the model's. Bounded transform via CSS. */}
            <div
              className="mermaid__svg"
              style={{
                transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})`,
                transformOrigin: 'center center',
              }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
