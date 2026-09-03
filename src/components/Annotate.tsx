import { useCallback, useEffect, useRef, useState } from 'react';
import {
  apart,
  backingFor,
  drawMarked,
  drawMarks,
  lookFor,
  markedName,
  notesIn,
  pictureAt,
  pinSide,
  saidOn,
  simplify,
  TOOLS,
  worthKeeping,
  type Mark,
  type Marked,
  type Point,
  type Size,
  type Tool,
} from '../lib/annotations';
import './Sheet.css';
import './Annotate.css';

/**
 * Drawing on a picture instead of describing it.
 *
 * A box, an arrow, a line drawn by hand, and a note pinned to a point — the four
 * things a designer has been putting on a screenshot for thirty years, and no
 * fifth one. What comes back out is the picture with the marks burnt into it
 * *and* the marks in words with their coordinates, so whoever reads it has both
 * the drawing and what was written on it.
 */

export type AnnotateProps = {
  /** The picture to draw on: a file URL, an object URL or a data URL. */
  source: string;
  /** What it is called. Shown under the heading, and kept on the copy. */
  name?: string;
  /** The marked-up picture and what was said on it. */
  onDone: (marked: Marked) => void;
  onClose: () => void;
};

export const SAYS = {
  heading: 'Draw on it',
  untitled: 'A picture',
  close: 'Close',
  undo: 'Undo',
  use: 'Use this',
  tools: {
    box: 'Box',
    arrow: 'Arrow',
    freehand: 'Draw',
    note: 'Note',
  },
  hints: {
    box: 'Drag a box around the part you mean.',
    arrow: 'Drag from anywhere to the thing you are pointing at.',
    freehand: 'Hold down and draw straight on it.',
    note: 'Click where it matters, then write what you mean.',
  },
  notePlaceholder: 'This, but tighter',
  noteAt: (number: number) => `Note ${String(number)}`,
  wontOpen: 'That picture will not open here.',
  cannotUse: 'I could not turn that into a picture to send. A PNG or a JPEG will work.',
  marks: (count: number) => (count === 1 ? '1 mark' : `${String(count)} marks`),
} as const;

/** The tools in reach of a number key, in the order they sit in the row. */
const TOOL_KEYS: readonly string[] = ['1', '2', '3', '4'];

export default function Annotate({ source, name, onDone, onClose }: AnnotateProps) {
  const [tool, setTool] = useState<Tool>('box');
  const [marks, setMarks] = useState<readonly Mark[]>([]);
  const [undone, setUndone] = useState<readonly Mark[]>([]);
  const [natural, setNatural] = useState<Size | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [trouble, setTrouble] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const board = useRef<HTMLCanvasElement | null>(null);
  const shown = useRef<HTMLImageElement | null>(null);
  const firstTool = useRef<HTMLButtonElement | null>(null);

  /* The drawing loop reads these rather than the state it mirrors: a stroke
     redraws on every pointer move, and re-rendering React at that rate is how a
     canvas starts dropping frames. */
  const marksNow = useRef<readonly Mark[]>(marks);
  marksNow.current = marks;
  const undoneNow = useRef<readonly Mark[]>(undone);
  undoneNow.current = undone;
  const naturalNow = useRef<Size | null>(natural);
  naturalNow.current = natural;

  const draft = useRef<Mark | null>(null);
  const drawingWith = useRef<number | null>(null);
  const frame = useRef<number | null>(null);
  const counted = useRef(0);
  /* What a note said when it was opened, so Esc can put it back. */
  const wasSaid = useRef('');

  const nextId = (): string => {
    counted.current += 1;
    return `m${String(counted.current)}`;
  };

  /* ------------------------------------------------------------------ paint */

  const paint = useCallback(() => {
    frame.current = null;
    const canvas = board.current;
    const size = naturalNow.current;
    if (canvas === null || size === null) return;

    const back = backingFor(
      canvas.getBoundingClientRect(),
      size,
      globalThis.devicePixelRatio > 0 ? globalThis.devicePixelRatio : 1,
    );
    if (canvas.width !== back.width) canvas.width = back.width;
    if (canvas.height !== back.height) canvas.height = back.height;

    const ink = canvas.getContext('2d');
    if (ink === null) return;
    ink.setTransform(1, 0, 0, 1, 0, 0);
    ink.clearRect(0, 0, canvas.width, canvas.height);

    const going = draft.current;
    drawMarks(
      ink,
      going === null ? marksNow.current : [...marksNow.current, going],
      lookFor(size, back.scaleX, back.scaleY),
    );
  }, []);

  const repaint = useCallback(() => {
    if (frame.current !== null) return;
    frame.current = requestAnimationFrame(paint);
  }, [paint]);

  useEffect(() => {
    repaint();
  }, [marks, natural, repaint]);

  useEffect(
    () => () => {
      if (frame.current === null) return;
      // Cleared as well as cancelled. Leaving the handle behind made the next
      // mount think a paint was already on its way, and nothing was ever drawn.
      cancelAnimationFrame(frame.current);
      frame.current = null;
    },
    [],
  );

  /* The window changing shape and the window changing screen both move where
     the picture is drawn, and only one of them is a resize of this element. */
  useEffect(() => {
    const canvas = board.current;
    if (canvas === null || natural === null) return;
    const watching = new ResizeObserver(() => repaint());
    watching.observe(canvas);
    const again = () => repaint();
    globalThis.addEventListener('resize', again);
    return () => {
      watching.disconnect();
      globalThis.removeEventListener('resize', again);
    };
  }, [natural, repaint]);

  /* ---------------------------------------------------------------- the hand */

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>): Point | null => {
    const size = naturalNow.current;
    const canvas = board.current;
    if (size === null || canvas === null) return null;
    return pictureAt(canvas.getBoundingClientRect(), size, event.clientX, event.clientY);
  };

  const start = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (event.button !== 0) return;
    /* Keeps the browser from doing its own thing with the press: no text
       selection dragged across the picture, and no focus pulled out of a note's
       field the instant that field appears under the same click that made it. */
    event.preventDefault();
    const at = pointOf(event);
    if (at === null) return;

    if (tool === 'note') {
      const id = nextId();
      wasSaid.current = '';
      setMarks([...settled(editing), { id, kind: 'note', at, text: '' }]);
      setUndone([]);
      setEditing(id);
      return;
    }

    event.currentTarget.setPointerCapture(event.pointerId);
    drawingWith.current = event.pointerId;
    draft.current =
      tool === 'freehand'
        ? { id: nextId(), kind: 'freehand', points: [at] }
        : { id: nextId(), kind: tool, from: at, to: at };
    repaint();
  };

  const move = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingWith.current !== event.pointerId) return;
    const going = draft.current;
    const size = naturalNow.current;
    const at = pointOf(event);
    if (going === null || size === null || at === null) return;

    if (going.kind === 'freehand') {
      const last = going.points[going.points.length - 1];
      /* One sample per pointer event is far more than a line needs, and every
         one of them is a point the export has to carry. */
      if (last !== undefined && apart(last, at) < Math.max(0.75, size.width / 900)) return;
      draft.current = { ...going, points: [...going.points, at] };
    } else if (going.kind === 'box' || going.kind === 'arrow') {
      draft.current = { ...going, to: at };
    }
    repaint();
  };

  const end = (event: React.PointerEvent<HTMLCanvasElement>) => {
    if (drawingWith.current !== event.pointerId) return;
    drawingWith.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    const going = draft.current;
    draft.current = null;
    const size = naturalNow.current;
    if (going === null || size === null) {
      repaint();
      return;
    }

    const done: Mark =
      going.kind === 'freehand'
        ? { ...going, points: simplify(going.points, Math.max(0.6, size.width / 1200)) }
        : going;

    if (worthKeeping(done, size)) {
      setMarks([...marksNow.current, done]);
      setUndone([]);
    } else {
      repaint();
    }
  };

  /* --------------------------------------------------------------- undoing */

  const undo = useCallback(() => {
    const was = marksNow.current;
    const last = was[was.length - 1];
    if (last === undefined) return;
    setEditing(null);
    setMarks(was.slice(0, -1));
    setUndone([...undoneNow.current, last]);
  }, []);

  const redo = useCallback(() => {
    const back = undoneNow.current;
    const last = back[back.length - 1];
    if (last === undefined) return;
    setUndone(back.slice(0, -1));
    setMarks([...marksNow.current, last]);
  }, []);

  /* ----------------------------------------------------------------- notes */

  const say = (id: string, text: string) => {
    setMarks(
      marksNow.current.map((one) => (one.id === id && one.kind === 'note' ? { ...one, text } : one)),
    );
  };

  /* A pin with nothing written on it is a click somebody changed their mind
     about. Every way out of the field agrees on that, so it is one function
     rather than the same filter written in three places. */
  const settled = useCallback(
    (id: string | null): readonly Mark[] =>
      id === null
        ? marksNow.current
        : marksNow.current.filter(
            (one) => !(one.id === id && one.kind === 'note' && one.text.trim() === ''),
          ),
    [marksNow],
  );

  const keepNote = useCallback(() => {
    if (editing === null) return;
    setEditing(null);
    setMarks(settled(editing));
  }, [editing, settled]);

  const dropNote = useCallback(() => {
    const id = editing;
    if (id === null) return;
    setEditing(null);
    const back = wasSaid.current;
    setMarks(
      back.trim() === ''
        ? marksNow.current.filter((one) => one.id !== id)
        : marksNow.current.map((one) =>
            one.id === id && one.kind === 'note' ? { ...one, text: back } : one,
          ),
    );
  }, [editing]);

  /* ---------------------------------------------------------------- sending */

  const apply = useCallback(async () => {
    const picture = shown.current;
    const size = naturalNow.current;
    if (picture === null || size === null) return;
    /* A pin nobody wrote on never goes out, whichever way the field was left. */
    const sending = marksNow.current.filter(
      (one) => one.kind !== 'note' || one.text.trim() !== '',
    );
    setBusy(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = size.width;
      canvas.height = size.height;
      const ink = canvas.getContext('2d');
      if (ink === null) throw new Error('no surface');

      drawMarked(ink, picture, size, sending);
      const dataUrl = canvas.toDataURL('image/png');
      const blob = await new Promise<Blob | null>((done) => {
        canvas.toBlob(done, 'image/png');
      });
      if (blob === null) throw new Error('nothing came out');

      onDone({
        file: new File([blob], markedName(name), { type: 'image/png' }),
        dataUrl,
        width: size.width,
        height: size.height,
        said: saidOn(sending, size),
        marks: sending,
      });
    } catch {
      setTrouble(SAYS.cannotUse);
    } finally {
      setBusy(false);
    }
  }, [name, onDone]);

  /* -------------------------------------------------------------- the keys */

  useEffect(() => {
    firstTool.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      /* The note field owns every key while somebody is writing in it. */
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === 'TEXTAREA' || tag === 'INPUT') return;

      if (event.key === 'Escape') {
        event.stopPropagation();
        event.preventDefault();
        onClose();
        return;
      }

      const held = event.metaKey || event.ctrlKey;
      if (held && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
        return;
      }
      if (held && event.key === 'Enter') {
        event.preventDefault();
        void apply();
        return;
      }

      const at = TOOL_KEYS.indexOf(event.key);
      const picked = at === -1 ? undefined : TOOLS[at];
      if (picked !== undefined) {
        event.preventDefault();
        setTool(picked);
      }
    };

    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose, redo, undo, apply]);

  /* --------------------------------------------------------------- drawing */

  const opened = (event: React.SyntheticEvent<HTMLImageElement>) => {
    const picture = event.currentTarget;
    const wide = picture.naturalWidth > 0 ? picture.naturalWidth : picture.width;
    const tall = picture.naturalHeight > 0 ? picture.naturalHeight : picture.height;
    if (wide > 0 && tall > 0) setNatural({ width: wide, height: tall });
    else setTrouble(SAYS.wontOpen);
  };

  const live = tool === 'note' || editing !== null;
  const said = trouble ?? SAYS.hints[tool];

  return (
    <section className="sheet draw" aria-label={SAYS.heading}>
      <header className="sheet__top">
        <div className="sheet__titles">
          <h1 className="sheet__title">{SAYS.heading}</h1>
          <p className="sheet__from">{name ?? SAYS.untitled}</p>
        </div>

        <nav className="sheet__chips" aria-label="What to draw with">
          {TOOLS.map((one, index) => (
            <button
              key={one}
              ref={index === 0 ? firstTool : undefined}
              type="button"
              className={`sheet__chip draw__tool ${tool === one ? 'sheet__chip--here' : ''}`}
              aria-pressed={tool === one}
              onClick={() => setTool(one)}
            >
              {SAYS.tools[one]}
              <span className="sheet__chipcount">{TOOL_KEYS[index]}</span>
            </button>
          ))}
        </nav>

        <button type="button" className="sheet__close" onClick={onClose}>
          {SAYS.close}
          <kbd className="sheet__key">Esc</kbd>
        </button>
      </header>

      <div className="draw__stage">
        <div
          className="draw__paper"
          style={
            natural === null
              ? undefined
              : {
                  ['--ratio' as string]: String(natural.width / Math.max(1, natural.height)),
                  ['--most' as string]: `${String(Math.max(natural.width, 640))}px`,
                }
          }
        >
          <img
            ref={shown}
            className="draw__picture"
            src={source}
            alt={name ?? SAYS.untitled}
            draggable={false}
            onLoad={opened}
            onError={() => setTrouble(SAYS.wontOpen)}
          />

          <canvas
            ref={board}
            className="draw__ink"
            aria-hidden="true"
            onPointerDown={start}
            onPointerMove={move}
            onPointerUp={end}
            onPointerCancel={end}
          />

          <div className={`draw__notes ${live ? 'draw__notes--live' : ''}`}>
            {natural === null
              ? null
              : notesIn(marks).map(({ note, number }) => (
                  <div
                    key={note.id}
                    className={`draw__note draw__note--${pinSide(note.at, natural)}`}
                    style={{
                      left: `${((note.at.x / natural.width) * 100).toFixed(3)}%`,
                      top: `${((note.at.y / natural.height) * 100).toFixed(3)}%`,
                    }}
                  >
                    <button
                      type="button"
                      className="draw__pin"
                      aria-label={SAYS.noteAt(number)}
                      onClick={() => {
                        if (editing === note.id) return;
                        setMarks(settled(editing));
                        wasSaid.current = note.text;
                        setEditing(note.id);
                      }}
                    />

                    {editing === note.id ? (
                      <textarea
                        className="draw__field"
                        rows={2}
                        value={note.text}
                        placeholder={SAYS.notePlaceholder}
                        aria-label={SAYS.noteAt(number)}
                        autoFocus
                        onChange={(event) => say(note.id, event.target.value)}
                        onBlur={keepNote}
                        onKeyDown={(event) => {
                          event.stopPropagation();
                          if (event.key === 'Enter' && !event.shiftKey) {
                            event.preventDefault();
                            keepNote();
                          }
                          if (event.key === 'Escape') {
                            event.preventDefault();
                            dropNote();
                          }
                        }}
                      />
                    ) : note.text.trim() === '' ? null : (
                      <span className="draw__said">{note.text}</span>
                    )}
                  </div>
                ))}
          </div>
        </div>
      </div>

      <footer className="draw__foot">
        <p className={`draw__hint ${trouble === null ? '' : 'draw__hint--trouble'}`}>{said}</p>

        <div className="draw__acts">
          {marks.length === 0 ? null : <span className="draw__count">{SAYS.marks(marks.length)}</span>}
          <button
            type="button"
            className="draw__act"
            onClick={undo}
            disabled={marks.length === 0}
          >
            {SAYS.undo}
            <kbd className="sheet__key">⌘Z</kbd>
          </button>
          <button
            type="button"
            className="draw__act draw__act--go"
            onClick={() => void apply()}
            disabled={busy || natural === null}
          >
            {SAYS.use}
          </button>
        </div>
      </footer>
    </section>
  );
}
