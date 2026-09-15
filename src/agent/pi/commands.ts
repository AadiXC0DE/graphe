/** The `/` commands a conversation answers to, and which of them are whose.
 *
 * Two things offer one. Graphe's own ways of working are files: `review.md` is
 * `/review`, and the person can read, edit and delete it. An add-on registers a
 * command with Pi instead, and Pi runs it in its command context — its handler
 * gets the argument string and the session, which is a different thing from a
 * sentence being handed to the model. Typing one and having it arrive as prose
 * is the failure this module exists to prevent: the add-on is asked to count
 * something and the model is told "count something".
 *
 * A word only one of them answers to is not a decision. A word both answer to
 * is: the workflow wins, because it is the one in front of the person and
 * deleting it hands the name over, and the add-on's row says why it cannot run
 * rather than disappearing from the list as though it were never registered.
 *
 * Nothing here reads Pi. The names are handed in as Pi holds them at that
 * moment, which is what makes a command whose add-on went away while a message
 * waited behind another one detectable: ask again and it is not there.
 */

/** One command an add-on offers here, as Pi holds it. */
export type AddonCommand = {
  /** Without the slash: the word somebody types. */
  name: string;
  description: string;
  /** The add-on that offers it, in the words its own card uses. */
  from: string;
};

/** The part of a way of working this decision needs. */
export type WorkflowHere = {
  /** With the slash, as `src/work/workflows.ts` writes it. */
  command: string;
  name: string;
  description: string;
  source: 'global' | 'project';
};

/** One row of the `/` picker. */
export type PickerCommand = {
  /** With the slash: what the row offers and what is put in the box. */
  command: string;
  name: string;
  description: string;
  /** The project, this computer, or the add-on that offers it. */
  from: string;
  /** How it runs: as Graphe's prompt, or in Pi's command context. */
  runs: 'workflow' | 'addon';
  /** Set when something else already answers to this word. Said on the row
   *  rather than leaving it to be discovered by pressing it. */
  shadowed: string | null;
};

/** The word a message opens with, without its slash. Null when it does not
 *  open with one — a slash inside a sentence is a slash, and a path is a path. */
export function leadingWord(text: string): string | null {
  return /^\/([a-z][a-z0-9-]*)(?:\s|$)/i.exec(text.trim())?.[1] ?? null;
}

/**
 * Where a typed `/word` goes.
 *
 * The add-on's command only reaches Pi when nothing of Graphe's already answers
 * to the name: Pi dispatches its own commands before it reads templates, so
 * handing it a word a workflow also owns would run the add-on's handler while
 * the picker said the workflow's name.
 */
export function routeFor(
  word: string,
  here: { workflows: readonly WorkflowHere[]; addons: readonly AddonCommand[] },
): 'workflow' | 'addon' | 'unknown' {
  const command = `/${word}`;
  if (here.workflows.some((one) => one.command === command)) return 'workflow';
  if (here.addons.some((one) => one.name === word)) return 'addon';
  return 'unknown';
}

/**
 * Both kinds as one list for the picker: Graphe's own first, in the order they
 * are offered, then what the add-ons here registered.
 */
export function pickerCommands(
  workflows: readonly WorkflowHere[],
  addons: readonly AddonCommand[],
): readonly PickerCommand[] {
  const rows: PickerCommand[] = workflows.map((one) => ({
    command: one.command,
    name: one.name,
    description: one.description,
    from: one.source === 'project' ? 'This project' : 'Your computer',
    runs: 'workflow',
    shadowed: null,
  }));

  for (const one of addons) {
    const command = `/${one.name}`;
    const owner = rows.find((row) => row.command === command);
    rows.push({
      command,
      name: one.name,
      description: one.description,
      from: one.from,
      runs: 'addon',
      // Still a row when the name is taken: somebody reading the list is owed
      // the reason it cannot be pressed, not a shorter list they cannot
      // account for. Pi dispatches its own commands before templates, so
      // handing it a word a workflow owns would run the wrong one.
      shadowed:
        owner === undefined
          ? null
          : owner.runs === 'workflow'
            ? `A way of working in ${owner.from} already answers to this.`
            : 'Another add-on here already answers to this.',
    });
  }
  return rows;
}
