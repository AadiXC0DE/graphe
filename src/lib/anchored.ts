/** Where a menu goes, in window coordinates rather than its parent's.
 *
 * A menu positioned `absolute` lands relative to whichever ancestor happens to
 * be positioned, so the same control drew its menu above the composer in one
 * place and off the top right of a sheet in another. Measured from the control
 * itself, there is no ancestor to be wrong about.
 *
 * The side is a preference, not an instruction. Asked for one there is no room
 * for, the menu takes the other: a chip at the top of a settings card wants to
 * hang down however it was called, and one in the composer at the bottom of the
 * window wants to stand up. Either way it is clamped to the window, and told
 * how tall it is allowed to be, because a menu whose first row is off the top
 * of the screen is a menu somebody cannot use.
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export type Side = 'below-right' | 'above-left';

/** Room from the window's edge, and the least a menu can usefully be. */
const EDGE = 8;
const LEAST = 180;

export function useAnchored(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  side: Side,
  /** The tallest the menu wants to be, whatever room there turns out to be. */
  most = 440,
): CSSProperties | null {
  const [at, setAt] = useState<CSSProperties | null>(null);
  useLayoutEffect(() => {
    if (!open) {
      setAt(null);
      return;
    }
    const place = (): void => {
      const r = ref.current?.getBoundingClientRect();
      if (r === undefined) return;
      const tall = window.innerHeight;
      const wide = window.innerWidth;
      const under = tall - r.bottom - EDGE * 2;
      const over = r.top - EDGE * 2;
      /* What was asked for, unless there is not room for it and there is room
         the other way. */
      const below = side === 'below-right' ? under >= LEAST || under >= over : under > over && under >= LEAST;

      const height = Math.min(most, Math.max(LEAST, Math.floor(below ? under : over)));
      if (below) {
        setAt({
          position: 'fixed',
          top: Math.round(r.bottom + EDGE),
          right: Math.round(Math.min(Math.max(EDGE, wide - r.right), wide - EDGE)),
          maxHeight: height,
        });
        return;
      }
      setAt({
        position: 'fixed',
        bottom: Math.round(Math.min(Math.max(EDGE, tall - r.top + EDGE), tall - EDGE)),
        left: Math.round(Math.max(EDGE, Math.min(r.left, wide - EDGE))),
        maxHeight: height,
      });
    };
    place();
    window.addEventListener('resize', place);
    // Captured, so a scroll anywhere above the control moves the menu with it.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side, most, ref]);
  return at;
}
