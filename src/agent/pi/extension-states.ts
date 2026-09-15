/** What an add-on is doing here, in one word somebody can act on.
 *
 * An add-on is not simply installed or not: it arrives with a folder, or it is
 * added from a catalogue; a project's copy stays off until somebody says yes to
 * that exact code; a chat built before it was added cannot see it until it is
 * built again; the add-ons setting leaves it out entirely; its files can be
 * missing from an install that half landed; and its own code can fail to load.
 * Those are nine different situations and the screen used to have two words for
 * all of them, which is how "added it and nothing happened" stays a mystery.
 *
 * The decision is made from facts the shell already has. Nothing here reads a
 * disk, a session or Pi: the caller hands over what it knows and this says what
 * that adds up to, in the words the screen shows.
 */

import { MOST_ROUNDS } from '../../work/carryon';
import type { Policy } from './extension-policy';

/** The states the screen draws. One per row, in the plan's own words. */
export type ExtensionState =
  | 'discovered'
  | 'needs trust'
  | 'installed'
  | 'active here'
  | 'activation pending'
  | 'disabled'
  | 'incompatible'
  | 'failed';

/** Everything the decision needs about one extension. */
export type ExtensionFacts = {
  /** The file Pi would load, as the row shows it. */
  where: string;
  /** How it got here: added from the catalogue, carried by the folder, or put
   *  there by hand. Three different promises, so three words. */
  cameFrom: 'installed' | 'carried' | 'loose';
  /** Whether it lives inside the project in front. */
  inThisProject: boolean;
  /** A trust decision applies to this exact code and has not been made. */
  needsTrust: boolean;
  /** Loaded in this conversation. */
  loaded: boolean;
  /** What the loader does with it here, or null when that was never decided. */
  policy: Policy | null;
  /** Anything was read from it at all. Not read is not a verdict. */
  looked: boolean;
  /** It arrived or changed after this conversation opened, so this chat is
   *  running what it was built with rather than what is on disk. */
  pending: boolean;
  /** Every conversation in this project it is loaded into, by name. */
  activeIn: readonly string[];
  /** Why it is not running, in one sentence, with whatever the loader said. */
  problem: { says: string; logs: readonly string[] } | null;
  /** Installed, and the files it says it ships are not on this disk. */
  filesMissing: boolean;
};

/**
 * Which of the eight it is.
 *
 * Ordered by what somebody needs to know first. Something that cannot run at
 * all beats something that is merely waiting; a question nobody has answered
 * beats an outcome; and "running in this chat" beats every fact about the
 * install behind it, because it is the one the person is watching.
 */
export function stateOf(facts: ExtensionFacts): ExtensionState {
  if (facts.filesMissing) return 'incompatible';
  if (facts.problem !== null) return 'failed';
  if (facts.needsTrust) return 'needs trust';
  if (facts.policy === 'off') return 'disabled';
  if (facts.loaded) return 'active here';
  if (facts.pending) return 'activation pending';
  if (facts.cameFrom === 'installed') return 'installed';
  return 'discovered';
}

/**
 * The row's own words for a state.
 *
 * The number of conversations is in here rather than in a separate field: "in
 * three chats" is what makes a state useful, and "active here" that reads the
 * same whether it is one chat or four is a label rather than an answer.
 */
export function saysState(state: ExtensionState, activeIn: readonly string[]): string {
  const chats =
    activeIn.length === 0
      ? ''
      : activeIn.length === 1
        ? ` in ${activeIn[0] ?? 'one chat'}`
        : ` in ${String(activeIn.length)} chats`;
  switch (state) {
    case 'active here':
      return `Running${chats}.`;
    case 'installed':
      return 'Added. Not loaded in this chat yet.';
    case 'needs trust':
      return 'Came with this project. It stays off until you turn it on.';
    case 'activation pending':
      return 'Installed; reload this chat to activate';
    case 'disabled':
      return 'Left out here by the add-ons setting.';
    case 'incompatible':
      return 'Installed, but the files it says it ships are not on this computer.';
    case 'failed':
      return 'It did not load.';
    default:
      return 'Found here, and nothing has loaded it.';
  }
}

/** What to call where it came from, on the row. */
export const ORIGIN_WORDS: Readonly<Record<ExtensionFacts['cameFrom'], string>> = {
  installed: 'Added',
  carried: 'Came with the project',
  loose: 'Put here by hand',
};

/** What to call how far it reaches. */
export function scopeOf(facts: Pick<ExtensionFacts, 'inThisProject'>): string {
  return facts.inThisProject ? 'This project' : 'Every project';
}

/**
 * What a conversation knows about one extension, which is the half of the facts
 * only a built session can answer: whether its code loaded, what the loader
 * decided to do with it, what it registered, and why it failed.
 *
 * Kept apart from `ExtensionFacts` because the project's own knowledge — trust,
 * what was installed, whether a change landed under this chat — belongs to the
 * shell, and neither side should have to fake the other's.
 */
export type ExtensionReport = {
  /** The file Pi would load, as the add-on's own manifest resolved it. */
  where: string;
  id: string;
  version: string | null;
  /** Loaded into this conversation. */
  loaded: boolean;
  /** Anything was read from it here at all. */
  looked: boolean;
  /** What the loader does with it here, or null when nothing decided. */
  policy: Policy | null;
  /** The `/` commands it registered here. */
  commands: readonly string[];
  /** Its own card says it asks for turns by itself. Read here rather than from
   *  the add-ons list, so a limit can be stated about the add-on that is
   *  actually loaded instead of one that shares its name. */
  startsTurns: boolean;
  /** Why it did not load, in one sentence, with what the loader said. */
  problem: { says: string; logs: readonly string[] } | null;
};

/** The one row the screen draws per add-on. */
export type ExtensionRow = {
  id: string;
  version: string | null;
  where: string;
  /** Where it came from, and how far it reaches, in the screen's words. */
  origin: string;
  scope: string;
  state: ExtensionState;
  /** One sentence for the state, with the chats it is running in. */
  says: string;
  /** Conversations in this project it is loaded into, by name. */
  activeIn: readonly string[];
  /** The `/` commands it offers here. */
  commands: readonly string[];
  /** The limit that applies to it here, one sentence each. Empty where there
   *  is none to state — a limit nobody applies is worse than silence. */
  limits: readonly string[];
  /** A concise error, and the raw text behind it. Both empty when nothing
   *  went wrong. */
  problem: string | null;
  logs: readonly string[];
};

/** One add-on as the screen draws it, from everything known about it. */
export function extensionRow(
  facts: ExtensionFacts & ExtensionReport & { limit?: string | null | undefined },
): ExtensionRow {
  const state = stateOf(facts);
  return {
    id: facts.id,
    version: facts.version,
    where: facts.where,
    origin: ORIGIN_WORDS[facts.cameFrom],
    scope: scopeOf(facts),
    state,
    says: stateSaid(facts, state),
    activeIn: facts.activeIn,
    commands: facts.commands,
    // The shell's own statement first, then the limit every add-on that starts
    // turns shares. Both are read, not assumed: an add-on whose card says it
    // starts nothing gets neither.
    limits: [
      ...(facts.limit === null || facts.limit === undefined ? [] : [facts.limit]),
      ...(facts.startsTurns ? [limitWords.startsTurns(MOST_ROUNDS)] : []),
    ],
    problem: facts.problem?.says ?? null,
    logs: facts.problem?.logs ?? [],
  };
}

/**
 * What an add-on cannot do here, in one sentence each.
 *
 * Both are limits of the host rather than of any one add-on, and both are worth
 * saying before somebody relies on the thing: Pi has no hook that can refuse a
 * turn an add-on starts inside itself, so the most Graphe can do is watch it and
 * end it at the round budget — and the budget is shared with every other reason
 * a run carries on, so an add-on that loops spends rounds the person's own
 * carry-on would have had.
 */
export const limitWords = {
  startsTurns: (most: number): string =>
    `It can start turns of its own. Nothing can refuse one before it begins, because Pi has no hook for that, so it is watched, and a run it starts is ended past ${String(most)} rounds.`,
} as const;

/** The state's own sentence, with the failure the loader gave where there is
 *  one: "it did not load" without the reason is a shrug. */
function stateSaid(facts: ExtensionFacts, state: ExtensionState): string {
  if (state === 'failed' && facts.problem !== null) return facts.problem.says;
  return saysState(state, facts.activeIn);
}

/* -------------------------------------------------------------------------- */
/* Everything seen here, as rows                                               */
/* -------------------------------------------------------------------------- */

/** One add-on this computer has, before any conversation says what it did with
 *  it: the file Pi would load, where it came from, and the project's own
 *  decision about it. */
export type SeenHere = Pick<ExtensionFacts, 'where' | 'cameFrom' | 'inThisProject' | 'needsTrust' | 'filesMissing'> & {
  id: string;
  version: string | null;
  /** The one limit worth knowing before somebody relies on this add-on, in the
   *  shell's own words, or null where there is none to state. A fact about the
   *  add-on rather than about a conversation, so it is here rather than on a
   *  session's report — the advisor's one-setting limit is the one this exists
   *  for. */
  limit?: string | null | undefined;
};

/** One open conversation in this project, named as the person reading the list
 *  knows it, with what it loaded and which add-ons a change landed under while
 *  it was open. */
export type SessionHere = {
  name: string;
  /** Ids changed since this chat was built, so this chat is running what it was
   *  built with rather than what is on disk. */
  pending: readonly string[];
  reports: readonly ExtensionReport[];
};

/**
 * Every add-on this project can see, one row each, in the eight states.
 *
 * The two halves are joined by the file that would run, which is the one
 * coordinate discovery, the loader and the project's trust all agree on —
 * matching by a package name instead would show an add-on twice the moment its
 * id and its folder disagreed.
 *
 * Nothing here is invented to fill a row: an add-on no conversation has looked
 * at is `discovered`, and one whose loader said nothing is not called failed.
 */
export function extensionRows(
  seen: readonly SeenHere[],
  sessions: readonly SessionHere[],
): readonly ExtensionRow[] {
  return seen.map((one) => {
    const about = sessions.flatMap((session) =>
      session.reports
        .filter((report) => report.where === one.where)
        .map((report) => ({ session, report })),
    );
    const running = about.filter((it) => it.report.loaded);
    const trouble = about.find((it) => it.report.problem !== null) ?? null;
    const decided = about.find((it) => it.report.policy !== null) ?? null;
    const pending = one.where === '' || running.length > 0
      ? false
      : sessions.some((session) => session.pending.includes(one.id));

    return extensionRow({
      ...one,
      looked: about.some((it) => it.report.looked),
      loaded: running.length > 0,
      policy: decided?.report.policy ?? null,
      pending,
      activeIn: running.map((it) => it.session.name),
      commands: about.flatMap((it) => it.report.commands),
      startsTurns: about.some((it) => it.report.startsTurns),
      limit: one.limit ?? null,
      problem: trouble?.report.problem ?? null,
    });
  });
}
