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

const MIN_SCALE = 0.5;
const MAX_SCALE = 3;

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
  const [toolsOpen, setToolsOpen] = useState(true);
  /** 'ok' after a copy lands, 'no' when it did not — idle is a third thing,
   *  so a failure is never mistaken for the button at rest. */
  const [copied, setCopied] = useState<'idle' | 'ok' | 'no'>('idle');
  const copiedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // The palette the diagram was drawn in. Diagrams bake their colours in at
  // render time, so a switch has to draw them again rather than hope CSS
  // catches up.
  const [themeMark, setThemeMark] = useState(() => document.documentElement.getAttribute('data-theme') ?? '');
  useEffect(() => {
    const onTheme = () => setThemeMark(document.documentElement.getAttribute('data-theme') ?? '');
    window.addEventListener('graphe:theme', onTheme);
    // Following the computer changes the palette with no attribute involved.
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    media.addEventListener('change', onTheme);
    return () => {
      window.removeEventListener('graphe:theme', onTheme);
      media.removeEventListener('change', onTheme);
    };
  }, []);

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
  }, [code, tail, themeMark]);

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
    const board = navigator.clipboard;
    if (board === undefined) {
      setCopied('no');
      if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
      copiedTimer.current = setTimeout(() => setCopied('idle'), 1600);
      return;
    }
    void board.writeText(code).then(
      () => {
        setCopied('ok');
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied('idle'), 1600);
      },
      () => {
        setCopied('no');
        if (copiedTimer.current !== null) clearTimeout(copiedTimer.current);
        copiedTimer.current = setTimeout(() => setCopied('idle'), 1600);
      },
    );
  };

  /** The picture's real size. Mermaid draws `width="100%"` with the geometry in
   *  a viewBox, so an <img> made from it has no width of its own — read the
   *  box instead of trusting img.width, which would export every diagram at
   *  whatever default size the browser invents. */
  const diagramSize = (markup: string): { width: number; height: number } | null => {
    const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
    const node = doc.querySelector('svg');
    if (node === null) return null;
    const parts = (node.getAttribute('viewBox') ?? '')
      .split(/[\s,]+/)
      .map((part) => Number.parseFloat(part))
      .filter((part) => Number.isFinite(part));
    if (
      parts.length === 4 &&
      parts[0] !== undefined &&
      parts[1] !== undefined &&
      parts[2] !== undefined &&
      parts[3] !== undefined &&
      parts[2] > 0 &&
      parts[3] > 0
    ) {
      return { width: parts[2], height: parts[3] };
    }
    const width = Number.parseFloat(node.getAttribute('width') ?? '');
    const height = Number.parseFloat(node.getAttribute('height') ?? '');
    if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0)
      return { width, height };
    return null;
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
    const size = diagramSize(svg) ?? { width: 800, height: 600 };
    const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const dpr = Math.max(2, window.devicePixelRatio || 1);
      canvas.width = size.width * dpr;
      canvas.height = size.height * dpr;
      canvas.style.width = `${size.width}px`;
      canvas.style.height = `${size.height}px`;
      const ctx = canvas.getContext('2d');
      if (ctx === null) {
        URL.revokeObjectURL(url);
        return;
      }
      ctx.scale(dpr, dpr);
      // The surface the diagram is shown on here, not an assumed white — a
      // dark palette drawn onto white is white ink on white paper.
      const shown =
        getComputedStyle(document.documentElement).getPropertyValue('--bg-sunken').trim() ||
        '#ffffff';
      ctx.fillStyle = shown;
      ctx.fillRect(0, 0, size.width, size.height);
      ctx.drawImage(img, 0, 0, size.width, size.height);
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

  const atMin = scale <= MIN_SCALE;
  const atMax = scale >= MAX_SCALE;
  const zoomIn = () => setScale((s) => Math.min(MAX_SCALE, Math.round((s + 0.25) * 100) / 100));
  const zoomOut = () => setScale((s) => Math.max(MIN_SCALE, Math.round((s - 0.25) * 100) / 100));
  const reset = () => {
    setScale(1);
    setOffset({ x: 0, y: 0 });
  };

  /* Pointer events, captured: a drag that runs past the frame keeps coming to
     this element instead of dying at its edge, which is where a pan of a
     zoomed-in diagram spends most of its life. Only worth doing once there is
     somewhere to pan — at 100% the touch is left alone so the page scrolls. */
  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (scale <= 1) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setDragging(true);
    dragStart.current = { x: e.clientX, y: e.clientY };
    offsetStart.current = { ...offset };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
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
          {/* A group, not role="toolbar": that role promises arrow-key roving
              focus these plain tab stops do not do. */}
          <div className="mermaid__toolbar" aria-label="Diagram controls">
            <button
              type="button"
              className={`mermaid__btn mermaid__btn--fold${toolsOpen ? ' mermaid__btn--open' : ''}`}
              onClick={() => setToolsOpen((was) => !was)}
              aria-expanded={toolsOpen}
              aria-label={toolsOpen ? 'Hide diagram controls' : 'Show diagram controls'}
              title={toolsOpen ? 'Hide controls' : 'Show controls'}
            >
              ‹
            </button>
            {toolsOpen ? (
              <>
                <button
                  type="button"
                  className="mermaid__btn"
                  onClick={copy}
                  aria-label="Copy diagram source"
                  title={copied === 'no' ? 'Could not copy' : 'Copy'}
                >
                  {copied === 'ok' ? 'Copied' : copied === 'no' ? 'Failed' : 'Copy'}
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
                <span className="mermaid__zoom" aria-hidden="true">
                  {Math.round(scale * 100)}%
                </span>
                <button
                  type="button"
                  className="mermaid__btn mermaid__btn--zoom"
                  onClick={zoomOut}
                  disabled={atMin}
                  aria-label="Zoom out"
                  title="Zoom out"
                >
                  -
                </button>
                <button
                  type="button"
                  className="mermaid__btn mermaid__btn--zoom"
                  onClick={zoomIn}
                  disabled={atMax}
                  aria-label="Zoom in"
                  title="Zoom in"
                >
                  +
                </button>
                <button
                  type="button"
                  className="mermaid__btn"
                  onClick={reset}
                  disabled={scale === 1 && offset.x === 0 && offset.y === 0}
                  aria-label="Reset zoom and pan"
                  title="Reset"
                >
                  Reset
                </button>
              </>
            ) : null}
          </div>
          <div
            className={`mermaid__viewport${dragging ? ' mermaid__viewport--dragging' : ''}${
              scale > 1 ? ' mermaid__viewport--pannable' : ''
            }`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
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
