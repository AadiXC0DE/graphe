/** Where a menu goes, in window coordinates rather than its parent's.
 *
 * A menu positioned `absolute` lands relative to whichever ancestor happens to
 * be positioned, so the same control drew its menu above the composer in one
 * place and off the top right of a sheet in another. Measured from the control
 * itself, there is no ancestor to be wrong about.
 */

import { useLayoutEffect, useState, type CSSProperties, type RefObject } from 'react';

export type Side = 'below-right' | 'above-left';

export function useAnchored(
  ref: RefObject<HTMLElement | null>,
  open: boolean,
  side: Side,
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
      setAt(
        side === 'below-right'
          ? { position: 'fixed', top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }
          : { position: 'fixed', bottom: window.innerHeight - r.top + 8, left: r.left },
      );
    };
    place();
    window.addEventListener('resize', place);
    // Captured, so a scroll anywhere above the control moves the menu with it.
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, side, ref]);
  return at;
}
