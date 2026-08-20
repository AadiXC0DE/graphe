/** The words for work that waits to be let in.
 *
 * Here rather than beside the machinery in `src/history/attempts.ts` because
 * the window says them and the window has no folders, no processes and no
 * Node. One copy of each sentence, reachable from both sides, which is the only
 * way two things that must say the same thing go on saying it.
 */

/** Every sentence this feature can put in front of somebody. */
export const holdWords = {
  /** The control, in the panel band where the rest of landing lives. */
  label: 'Check new work before it lands',
  hint: 'Off: I change your files as I go, and every change is one undo away. On: where there is something to look at, I do the work in a copy and show you the result, and your own files are not touched until you say yes — and everywhere else I save first, so one press puts it back.',
  making: 'Working on it in a copy of your project. Your own files are untouched.',
  waiting: 'This is finished and waiting for you. Nothing has reached your project yet.',
  approve: 'Let it in',
  setAside: 'Set it aside',
  /** When the pictures show something wrong. The same two answers, the other
   *  way round: the safe one carries the weight and letting it in says what it
   *  is. Nobody is stopped — a picture is evidence, not a veto. */
  approveAnyway: 'Let it in anyway',
  lookAgain: 'The pictures show a problem. Set it aside to keep your project as it is.',
  /** Over the pictures the decision arrives with. */
  seeIt: 'Before you say yes',
  /** While they are still being taken. Both answers stay live throughout. */
  looking: 'Making a picture of it…',
  now: 'How it looks now',
  ifIn: 'If you let it in',
  /** Said where a picture should have been, and never instead of the answer. */
  decideAnyway: 'You can still let it in or set it aside.',
  atWidth: 'Look at it at another size',
  bringBack: 'Bring it back',
  undo: 'Undo',
  isIn: 'It is in. Your project looks like this now.',
  isAside: 'Set aside. Your project is exactly as it was, and this is still here if you want it.',
} as const;
