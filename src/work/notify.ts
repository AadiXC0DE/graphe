/** Being told about work while you are looking at something else.
 *
 * Three answers to every kind of interruption: a notification, a bounce, or
 * nothing. Which one a preference means, whether the moment is worth one at
 * all, and what the dock badge should say are decided here so they can be
 * tested; the shell owns `Notification`, `app.dock.bounce()` and
 * `app.dock.setBadge()`, none of which exist in a test and one of which does
 * not exist off macOS.
 *
 * Pure.
 */

/** What being told looks like. */
export type Telling = 'system' | 'bounce' | 'nothing';

/** Why somebody is being told. */
export type Because = 'finished' | 'needs-you';

export const notifyWords = {
  system: 'System notification',
  bounce: 'Bounce the Dock',
  nothing: 'Nothing',
} as const;

/** The three, in the order a segmented control reads them: most said first. */
export const TELLINGS: readonly { id: Telling; says: string }[] = [
  { id: 'system', says: notifyWords.system },
  { id: 'bounce', says: notifyWords.bounce },
  { id: 'nothing', says: notifyWords.nothing },
];

/** A saved answer, read the forgiving way. Anything unreadable leaves the
 *  default standing rather than turning being told off. */
export function asTelling(raw: unknown, fallback: Telling = 'system'): Telling {
  return raw === 'system' || raw === 'bounce' || raw === 'nothing' ? raw : fallback;
}

/** How this person asked to be told, and where they are looking now. */
export type HowTheyAsked = {
  finished: Telling;
  needsYou: Telling;
  /** Whether the window is the thing in front of them. */
  inFront: boolean;
};

/**
 * What to do about one thing that happened.
 *
 * A run that finished while somebody was watching it finish needs no
 * notification about it. A question does, either way: nothing else moves until
 * it is answered, and the window it is in may be behind three others.
 */
export function howToTell(because: Because, asked: HowTheyAsked): Telling {
  if (because === 'finished') return asked.inFront ? 'nothing' : asked.finished;
  return asked.needsYou;
}

/** Whether a telling makes a noise. Only where somebody asked for one, and
 *  never for the answer that does nothing. */
export function makesASound(told: Telling, sound: boolean): boolean {
  return sound && told !== 'nothing';
}

/**
 * What the dock badge should say.
 *
 * Empty at nothing waiting, and empty where nobody asked for a badge: a dock
 * showing 0 is a dock saying there is something.
 */
export function badgeFor(waiting: number, on: boolean): string {
  if (!on) return '';
  const count = Number.isFinite(waiting) ? Math.max(0, Math.floor(waiting)) : 0;
  return count === 0 ? '' : String(count);
}
