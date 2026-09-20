/** Whether the window is somewhere somebody can see it.
 *
 * A window that is minimised, or sitting behind another one, still runs: a
 * walk of a project, a picture of a browser, a render nobody looks at. The
 * browser is the authority on which it is — `visibilityState` is what
 * Electron's own window manager feeds — and it says so the moment it changes.
 *
 * Answered once on the way in, so a window that opens behind something else
 * does not do a screenful of work before it has been told.
 */

export function whenHidden(on: (hidden: boolean) => void): () => void {
  const read = (): void => on(document.visibilityState === 'hidden');
  document.addEventListener('visibilitychange', read);
  read();
  return () => document.removeEventListener('visibilitychange', read);
}
