/** What Escape means, given what is on screen.
 *
 * Escape is the one key that means different things depending on what is in
 * front of somebody, and the order matters more than any of the individual
 * answers: a sheet is closed by whatever drew it, and a run is only ever
 * stopped when there is nothing else Escape could have meant. Getting that
 * order wrong is a press meant to close a panel that stops a job instead —
 * which is the loudest way this app can misread somebody.
 *
 * Pure, so the order is a thing that can be checked rather than a thing that
 * was true once.
 */

/** What is up, and what is going. */
export type OnScreen = {
  /** Something nearer the key already answered it — a menu inside the
   *  composer, or anything below the window. */
  answeredAlready: boolean;
  /** The connect sheet, and whether it is mid-flight. */
  connectOpen: boolean;
  connectBusy: boolean;
  /** The conversation switcher. */
  switching: boolean;
  /** Any of the sheets that close themselves. */
  overlayUp: boolean;
  /** A run in flight. */
  busy: boolean;
};

export type EscapeMeans =
  | 'nothing'
  | 'cancel-connect'
  | 'close-connect'
  | 'close-switcher'
  | 'let-the-sheet-have-it'
  | 'stop';

export function escapeMeans(screen: OnScreen): EscapeMeans {
  if (screen.answeredAlready) return 'nothing';
  // A connect flow mid-flight is cancelled rather than closed: closing it would
  // leave something running with nowhere to report.
  if (screen.connectOpen) return screen.connectBusy ? 'cancel-connect' : 'close-connect';
  if (screen.switching) return 'close-switcher';
  /* A sheet closes itself — it knows what it has open inside it. What matters
     here is that this is BEFORE `busy`: a press meant to close a panel must
     never stop the work. */
  if (screen.overlayUp) return 'let-the-sheet-have-it';
  if (screen.busy) return 'stop';
  return 'nothing';
}
