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
  label: 'Check my work before it lands',
  hint: 'I do the work in a copy of your project and show it to you. Nothing reaches your files until you say yes.',
  making: 'Working on it in a copy of your project. Your own files are untouched.',
  waiting: 'This is finished and waiting for you. Nothing has reached your project yet.',
  approve: 'Let it in',
  setAside: 'Set it aside',
  bringBack: 'Bring it back',
  undo: 'Undo',
  isIn: 'It is in. Your project looks like this now.',
  isAside: 'Set aside. Your project is exactly as it was, and this is still here if you want it.',
} as const;
