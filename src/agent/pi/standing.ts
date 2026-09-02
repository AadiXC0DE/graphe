/** What Graphe says to the model on every single call.
 *
 * The checklist used to travel with the person's typed message. So a steer
 * carried it, a retry after a rate limit did not, a message an add-on injected
 * did not, and neither did anything after the conversation was tidied up — and
 * those are exactly the turns where a long job forgets it had a list.
 *
 * It lives in the system prompt now, appended last, so it is there whatever
 * else is installed. Add-ons write into the system prompt too, and on a small
 * model the system prompt wins over anything in a user message.
 *
 * The other half of that: the prompt has a budget. Pi's own text, forty tools'
 * guidelines, an add-on's five-kilobyte tool description, `AGENTS.md`, skills
 * and memory all land in the same window as the work. Past the budget this
 * trims in a fixed order and says how big it got, rather than letting a model
 * quietly stop being able to hold the job.
 *
 * Pure. What it is handed is worked out by the shell; what it does with it is
 * decided here, and tested here.
 */

/** How much system prompt a small model can carry and still work a long list.
 *  Measured in characters, because that is what can be counted without a
 *  tokeniser for whichever model is in use. */
export const PROMPT_BUDGET = 60_000;

/** What one add-on's tool descriptions may weigh before its row says so. They
 *  reach the model through the tool schema rather than the system prompt, so
 *  this is a number to report, not one to cut at. */
export const EXTENSION_BUDGET = 2_000;

/** What one skill may carry. */
export const SKILL_BUDGET = 12_000;

/** What a project's `AGENTS.md` may carry before it becomes a pointer. */
export const AGENTS_BUDGET = 8_000;

export const standingWords = {
  open: '<graphe-standing>',
  close: '</graphe-standing>',
  /** The rules that hold whatever else is installed. */
  rules: [
    'Work the whole list. An unticked step is a step that is not done.',
    'Call step_done(n) as each step lands, naming the step by its number.',
    'A progress report is not a step. Do not stop to summarise while steps are still unticked.',
    'A second opinion (an advisor verdict, a review, a list of what is not yet proven) is advice on the work. It is never permission to leave the list unfinished.',
    'A step that cannot be done is step_failed(n, why) or step_skipped(n, why), said out loud, never left quietly unticked.',
  ],
  agentsTrimmed: 'The rest of this file is on disk. Read it if you need it.',
  skillTrimmed: 'This skill is longer than shown. Ask for the rest if you need it.',
} as const;

/* -------------------------------------------------------------------------- */
/* The block                                                                   */
/* -------------------------------------------------------------------------- */

/** As many rows of the list as a prompt can carry without becoming the prompt.
 *  Past this the block says how many more there are. */
export const MOST_ROWS = 60;

export type Standing = {
  /** The checklist, as markdown, and how far along it is. */
  list: { markdown: string; done: number; total: number; rows: number } | null;
  /** What the person asked the run to reach, when there is one. */
  goal: string | null;
  /** The two notes most worth carrying. Bounded, because memory is not the job. */
  notes: readonly string[];
};

function notesLine(notes: readonly string[], most = 600): string | null {
  const lines = notes.map((one) => `- ${one.replace(/\s+/g, ' ').trim()}`).filter((one) => one !== '- ');
  if (lines.length === 0) return null;
  let out = '';
  for (const line of lines) {
    if (out.length + line.length + 1 > most) break;
    out = out === '' ? line : `${out}\n${line}`;
  }
  return out === '' ? null : `Worth remembering:\n${out}`;
}

/**
 * Graphe's own block, or nothing when there is nothing standing.
 *
 * Nothing rather than an empty block: a fence with no content in it is prompt
 * a model still has to read past.
 */
export function standingBlock(standing: Standing): string | null {
  const parts: string[] = [];
  if (standing.list !== null && standing.list.total > 0) {
    const { markdown, done, total, rows } = standing.list;
    const more = rows > MOST_ROWS ? `\n…and ${String(rows - MOST_ROWS)} more steps on the list.` : '';
    parts.push(
      `The checklist on screen, ${String(done)} of ${String(total)} settled:\n${markdown}${more}`,
    );
  }
  if (standing.goal !== null && standing.goal.trim() !== '') {
    parts.push(`Working toward: ${standing.goal.trim()}`);
  }
  if (parts.length > 0) parts.push(standingWords.rules.join('\n'));
  const notes = notesLine(standing.notes);
  if (notes !== null) parts.push(notes);
  if (parts.length === 0) return null;
  return [standingWords.open, parts.join('\n\n'), standingWords.close].join('\n');
}

/* -------------------------------------------------------------------------- */
/* The budget                                                                  */
/* -------------------------------------------------------------------------- */

/** One piece held to its cap, on the way in rather than after the prompt has
 *  been assembled. What is cut is on disk, and the tail says so. */
export function withinBudget(text: string, most: number, tail: string): string {
  return firstParagraph(text, most, tail);
}

function firstParagraph(text: string, most: number, tail: string): string {
  const trimmed = text.trim();
  if (trimmed.length <= most) return trimmed;
  const stop = trimmed.indexOf('\n\n');
  const head = stop > 0 && stop < most ? trimmed.slice(0, stop) : trimmed.slice(0, most);
  return `${head.trimEnd()}\n${tail}`;
}

/** What the model chip says about the size of the prompt. Said as characters
 *  rather than tokens: a token count that is right for one model is wrong for
 *  the next, and a wrong number is worse than a plain one. */
export function saysPromptSize(now: number, budget = PROMPT_BUDGET): string {
  const thousands = Math.round(now / 100) / 10;
  const over = now > budget ? ' · over budget' : '';
  return `Prompt ${String(thousands)}k${over}`;
}
