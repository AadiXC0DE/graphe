import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { usePrefersReducedMotion } from '../lib/motion';
import './Clipped.css';

/** Past this, a block stops being something you read and becomes something you
 *  scroll past. Roughly twenty lines of the conversation's own type. */
export const READING_HEIGHT = 360;

type Props = {
  children: ReactNode;
  /** Where to cut. Overridable so a panel with less room can cut sooner. */
  height?: number;
  /** What the whole of it amounts to — "1,240 lines", "18 KB". Said beside the
   *  button so the size of what is hidden is known before it lands. */
  how?: string | null;
  /** What the button says when there is more. */
  label?: string;
  /** How it starts: open when the caller already knows this one should be
   *  readable in full — the newest reply, say. A starting position, not a
   *  leash: after mount the state belongs to whoever pressed the button, so a
   *  block does not snap shut (or open) underneath somebody later. */
  defaultOpen?: boolean;
};

/**
 * Long content, cut to a reading height with a way to see the rest.
 *
 * A skill file, a pasted brief or a command that printed a thousand lines are
 * all the same problem from where somebody is sitting: the thread stops being
 * readable and the thing they were following scrolls off the top. So anything
 * that would take over the column is cut, faded out, and offered whole.
 *
 * Nothing is added to content that already fits. A block short enough to read is
 * drawn exactly as it was given — no button, no border, no measured height — so
 * the ordinary case pays nothing for this.
 */
export default function Clipped({ children, height = READING_HEIGHT, how, label = 'Show all', defaultOpen = false }: Props) {
  const bodyRef = useRef<HTMLDivElement>(null);
  const [tall, setTall] = useState(false);
  const [open, setOpen] = useState(defaultOpen);
  const [full, setFull] = useState<number | null>(null);
  const reducedMotion = usePrefersReducedMotion();

  /* Measured rather than guessed: the same characters are a different height in
     a code block, a table and a paragraph, and a line count would be wrong for
     all three. Watched as well as measured, because a reply still arriving grows
     under this and crosses the threshold part-way through. */
  useEffect(() => {
    const body = bodyRef.current;
    if (body === null) return;
    const measure = () => {
      const grown = body.scrollHeight;
      setFull(grown);
      setTall(grown > height + 24);
    };
    measure();
    const watch = new ResizeObserver(measure);
    watch.observe(body);
    return () => watch.disconnect();
  }, [height, children]);

  /* Collapsing from below the fold would leave somebody looking at whatever the
     page pulled up under their eyes. Put the top of the block back on screen
     instead, which is where they were reading when they opened it. */
  const shut = useCallback(() => {
    setOpen(false);
    const body = bodyRef.current;
    if (body === null) return;
    const box = body.getBoundingClientRect();
    if (box.top >= 0) return;
    body.scrollIntoView({ block: 'start', behavior: reducedMotion ? 'auto' : 'smooth' });
  }, [reducedMotion]);

  if (!tall && !open) {
    return (
      <div className="clipped">
        <div className="clipped__body" ref={bodyRef}>
          {children}
        </div>
      </div>
    );
  }

  /* Animated to the measured height rather than to `none`, which cannot be
     transitioned. Exits run faster than entrances, per the motion tokens. */
  const style = reducedMotion
    ? { maxHeight: open ? 'none' : `${height}px` }
    : {
        maxHeight: open ? `${full ?? height}px` : `${height}px`,
        transition: `max-height ${open ? 'var(--dur-large) var(--ease-out-quart)' : 'var(--dur-exit) var(--ease-out-quart)'}`,
      };

  return (
    <div className={`clipped ${open ? '' : 'clipped--cut'}`}>
      <div className="clipped__body" ref={bodyRef} style={style}>
        {children}
      </div>
      <div className="clipped__more">
        <button
          type="button"
          className="clipped__act"
          onClick={open ? shut : () => setOpen(true)}
          aria-expanded={open}
        >
          {open ? 'Show less' : label}
        </button>
        {how === null || how === undefined || open ? null : (
          <span className="clipped__how">{how}</span>
        )}
      </div>
    </div>
  );
}

/** How much there is of it, for the line beside the button. Lines, because that
 *  is the unit somebody scrolling past a wall of text is counting in. */
export function howMuch(text: string): string | null {
  const lines = text.split('\n').length;
  if (lines < 2) return null;
  return `${lines.toLocaleString()} lines`;
}
