/** Research, properly.
 *
 * The difference between asking a question and researching one is not effort,
 * it is method: break the question up, send somebody after each part, and treat
 * a single source as a lead rather than an answer. The agent will do that when
 * it is asked to and mostly will not when it is not, so this asks — once, in
 * front of the person's own words, and never instead of them.
 *
 * Pure, and one place: the brief is the whole of the feature, so it can be read
 * and argued with without opening the app.
 */

/** Every word this mode puts on screen. */
export const researchWords = {
  /** On the chip, when it is the way of working in force. */
  chip: 'Digs deep',
  name: 'Research it properly',
  note: 'Sends several helpers out at once, weighs what they disagree about, and reports before touching anything.',
} as const;

/**
 * The brief, in front of what somebody actually asked.
 *
 * Numbered because the order is the method — splitting before searching is what
 * makes the helpers independent, and independent helpers are the only reason
 * two of them agreeing means anything.
 *
 * The last line is load-bearing: research that quietly turns into changes is
 * how somebody ends up reviewing a diff they never asked for.
 */
export const RESEARCH_BRIEF = [
  'Treat this as research rather than a change.',
  '',
  '1. Break the question into the separate things that would have to be true, and say what they are before you start.',
  '2. Send a helper after each one, several at the same time rather than one after another. Give each a whole question it can answer without the others.',
  '3. Read this project as well as the web. What the code already does is evidence, and it outranks anything written about what it should do.',
  '4. Where two answers disagree, or where one rests on a single source, send another helper to settle it rather than picking the one you saw first.',
  '5. Report what you found, how sure you are of each part, and what you could not confirm. Name your sources.',
  '',
  'When the research is about work that could be implemented, finish with a concrete numbered implementation plan under the exact heading "IMPLEMENTATION PLAN". Omit that heading when implementation is not relevant.',
  '',
  'Change nothing until I have read it and said so.',
].join('\n');

/** What is actually sent. The brief first, then their sentence whole and
 *  unedited — a request paraphrased into a brief is a request nobody can check
 *  the answer against. */
export function asResearch(asked: string): string {
  const said = asked.trim();
  if (said === '') return said;
  return `${RESEARCH_BRIEF}\n\nThe question:\n\n${said}`;
}

/**
 * The implementation-plan section the model chose to include in its research.
 *
 * There is deliberately no intent word list here. "Digs deep" applies to one
 * message and then returns to Auto, so the person's next words reach the model
 * unchanged. The model decides whether those words mean implement, research
 * more, challenge a premise, or something else. This only reads the explicit
 * structured section the research brief asked the model to produce, so a large
 * implementation gets a real build checklist without guessing from keywords.
 */
export function implementationPlanFromResearch(report: string): string | null {
  const marker = /^(?:#{1,6}\s*)?IMPLEMENTATION PLAN:?\s*$/im;
  const found = marker.exec(report);
  if (found === null) return null;
  const after = report.slice(found.index + found[0].length).trim();
  return after === '' ? null : after;
}
