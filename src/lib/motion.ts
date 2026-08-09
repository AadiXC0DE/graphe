import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

/**
 * Whether this person has asked for less movement.
 *
 * Most of the app answers that question in CSS, which is the right place for it.
 * This exists for the one thing a stylesheet cannot reach: scrolling that is
 * done in JavaScript. `UI-DESIGN.md` says every animation ships with its
 * reduced-motion counterpart and means it — including the ones a media query
 * would never see.
 *
 * It listens rather than reading once, because the setting can change while the
 * window is open and somebody who turns it on mid-session is asking for it now,
 * not next launch.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(
    () => globalThis.matchMedia?.(QUERY).matches ?? false,
  );

  useEffect(() => {
    const media = globalThis.matchMedia?.(QUERY);
    if (media === undefined) return;
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  return reduced;
}
