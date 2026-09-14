/** What one conversation hands to the next, in words the person can edit.
 *
 * "Continue in a new chat" is a new conversation with a new identity: nothing of
 * the old transcript comes with it, and nothing pretends to. What travels is one
 * message, written out of what was actually said and actually written — the
 * objective, where it got to, the files it touched, and which folder it worked
 * in — and it lands in the box as a draft rather than being sent, because the
 * person knows what matters better than a summary does.
 *
 * Pure, and deliberately not a model call: a handoff that costs a request is a
 * handoff nobody presses, and one a model invented would be worse than none.
 */

export type Handoff = {
  /** What the source conversation was called. */
  from: string;
  /** What it was asked, from its own first words. */
  objective: string | null;
  /** What it last said, which is where it had got to. */
  gotTo: string | null;
  /** Paths it wrote or read, most recent first, as it named them. */
  files: readonly string[];
  /** The folder the new conversation will work in. */
  folder: string;
  /** The project's name, in the words the person calls their folder. */
  project: string;
};

export const continuationWords = {
  /** One word, because it is a button: the sentence underneath does the rest. */
  label: 'Continue',
  hint: 'Start a new conversation with a note about where this one got to. Edit it before you send.',
  fork: 'Fork',
  forkHint:
    'A second conversation with the same history, so another direction can be tried without losing this one.',
  archive: 'Archive',
  archiveHint: 'Keep it, out of the list.',
  unarchive: 'Unarchive',
} as const;

/** One line, from something somebody said: newlines flattened, cut at a word if
 *  it is long, empty when there is nothing worth carrying. */
function oneLine(text: string | null, most: number): string | null {
  if (text === null) return null;
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat === '') return null;
  if (flat.length <= most) return flat;
  const cut = flat.slice(0, most);
  const at = cut.lastIndexOf(' ');
  return `${(at > most / 2 ? cut.slice(0, at) : cut).trimEnd()}…`;
}

/**
 * The note, as one message.
 *
 * Written in the second person about the work rather than about the machinery:
 * a person reading it back a week later needs to know what was being made, what
 * happened, and which files it is in — not which conversation id this came from.
 */
export function handoffMessage(handoff: Handoff): string {
  const lines: string[] = [];
  const objective = oneLine(handoff.objective, 240);
  const gotTo = oneLine(handoff.gotTo, 300);
  lines.push(
    objective === null
      ? `Continuing from "${handoff.from}".`
      : `Continuing from "${handoff.from}", which started with: ${objective}`,
  );
  if (gotTo !== null) lines.push(`Where it got to: ${gotTo}`);
  const files = [...handoff.files].slice(0, 12);
  if (files.length > 0) {
    lines.push(`Files it worked in: ${files.join(', ')}`);
  }
  lines.push(
    `This conversation works in ${handoff.folder}, so everything already written there is here. Nothing else of "${handoff.from}" comes across: ask if you need it.`,
  );
  return lines.join('\n\n');
}
