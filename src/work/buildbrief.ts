/** Turning a document into a build plan.
 *
 * The brief is the whole of Doc-to-Build's planning phase, so it can be read
 * and argued with without opening the app. Read-only at this stage — nothing is
 * changed until the person has seen the plan and said so — because the failure
 * designers fear most is forty files changed without warning.
 */

/** The instruction sent before the person's own document, followed by the
 *  document text. It asks for a numbered plan whose lines the reader turns into
 *  tasks. */
export const BUILD_BRIEF = [
  'Turn this document into a plan for building it, and tell me the plan.',
  '',
  'Use the numbered form — "1. Make the header sticky" — one step per line, in the order the work should happen.',
  'Keep each step small enough to finish and verify on its own. For every step:',
  '  - say what one change it makes, in a sentence a non-technical reader could check',
  '  - put the acceptance criteria under it, starting with "Acceptance:"',
  '  - where a command can prove it, put the test under it starting with "Test:"',
  '',
  'Only put a step in the plan because the document asks for it. Do not invent extra scope.',
  '',
  'Change nothing while I look. This is the planning pass.',
].join('\n');

/** The whole planning request, document first so the agent reads it against
 *  the project. */
export function asBuildRequest(document: string, instruction: string | null): string {
  return [
    document.trim(),
    '',
    `Build ${instruction === null || instruction.trim() === '' ? 'the plan above' : `${instruction.trim()} using the plan above`}.`,
    '',
    BUILD_BRIEF,
  ].join('\n');
}
