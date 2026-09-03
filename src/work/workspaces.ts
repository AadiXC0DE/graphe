/** Every conversation with a copy of the project, as a card.
 *
 * A copy is invisible today: it is a folder somewhere and a branch name, and
 * the only way to learn what is in one is to open the conversation and then
 * open the diff. So the work of four conversations is four places nobody looks,
 * and the one that stopped to ask a question waits there until somebody
 * happens back.
 *
 * A card is the opposite: branch, base, what changed, when it last moved, what
 * it came to, and which of five things is true of it right now. Ordered so the
 * one that wants a person is at the top and the ones already landed are at the
 * bottom — a list where the thing that needs you is buried is a list nobody
 * reads.
 *
 * Pure. Facts in, cards out; the caller reads git and the ledger.
 */

import { formatMoney, type Money } from '../cost/money';

/** Where one copy is up to.
 *
 * `put away` is the folder given back while the branch stays — see
 * `putAwayWorktree`. It is not an ending, and drawing it as one is how somebody
 * decides a conversation's work is gone. */
export type CardState = 'working' | 'needs you' | 'ready to review' | 'landed' | 'put away';

/** One card, drawn. */
export type Workspace = {
  /** The conversation this copy belongs to. */
  address: string;
  title: string;
  branch: string;
  /** The branch it started from, so "3 files ahead of main" has a *of what*. */
  base: string;
  changed: number;
  added: number;
  removed: number;
  lastAt: number;
  cost: Money | null;
  state: CardState;
  /** The working tree holds something the branch does not, so the copy cannot
   *  be given back without losing it. */
  holdsWork: boolean;
};

/** What the caller knows about one copy. Everything a card needs and nothing
 *  it has to go and fetch. */
export type WorkspaceFacts = {
  address: string;
  title: string;
  branch: string;
  base: string;
  changed: number;
  added: number;
  removed: number;
  lastAt: number;
  cost: Money | null;
  /** Where the conversation itself is: going, stopped on a question, or over
   *  for now. */
  run: 'running' | 'asking' | 'settled';
  /** Its branch is already in the base line. */
  landed: boolean;
  /** The folder has been given back; the branch is still there. */
  away: boolean;
  holdsWork: boolean;
};

export const workspaceWords = {
  heading: 'Branches',
  nothing: 'No conversation has a copy of this project yet.',
  /** What each state is called where somebody reads it. */
  states: {
    working: 'Working',
    'needs you': 'Needs you',
    'ready to review': 'Ready to review',
    landed: 'Landed',
    'put away': 'Put away',
  } as Record<CardState, string>,
  review: 'Review',
  land: 'Land',
  /** The main folder switches to this branch. Its inverse is below it. */
  bringForward: 'Switch folder to this branch',
  sendBack: 'Send back to its copy',
  putAway: 'Remove the copy',
  open: 'Open the conversation',
  /** On a card whose copy holds writing no branch is carrying yet. Said
   *  because putting it away is the one press that would lose it. */
  holds: 'Uncommitted changes',
  nothingChanged: 'Nothing changed yet.',
  awayDetail: 'On its branch',
  from: (base: string): string => `from ${base}`,
  tally: (added: number, removed: number): string => `+${String(added)} −${String(removed)}`,
  files: (count: number): string => `${String(count)} ${count === 1 ? 'file' : 'files'}`,
} as const;

/* -------------------------------------------------------------------------- */
/* Which of the five                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Which state one copy is in.
 *
 * A question outranks a folder: a conversation stopped waiting for an answer
 * still wants one whether or not its copy is spread out on disk, and drawing
 * that as "put away" hides the only card in the list that a person can act on.
 *
 * Settled with nothing changed is `working`, not `ready to review` — a review
 * of no files is a door with nothing behind it.
 */
export function stateOf(one: WorkspaceFacts): CardState {
  if (one.landed) return 'landed';
  if (one.run === 'asking') return 'needs you';
  if (one.run === 'running') return 'working';
  if (one.away) return 'put away';
  return one.changed > 0 ? 'ready to review' : 'working';
}

/** What wants a person comes first; what is over comes last. */
const ORDER: readonly CardState[] = [
  'needs you',
  'ready to review',
  'working',
  'put away',
  'landed',
];

/** Every copy as a card, in the order they are drawn: by what each one wants
 *  from a person, then the one that moved most recently. */
export function cardsFrom(facts: readonly WorkspaceFacts[]): readonly Workspace[] {
  return facts
    .map((one) => ({
      address: one.address,
      title: one.title,
      branch: one.branch,
      base: one.base,
      changed: one.changed,
      added: one.added,
      removed: one.removed,
      lastAt: one.lastAt,
      cost: one.cost,
      state: stateOf(one),
      holdsWork: one.holdsWork,
    }))
    .sort((one, other) => {
      const band = ORDER.indexOf(one.state) - ORDER.indexOf(other.state);
      return band !== 0 ? band : other.lastAt - one.lastAt;
    });
}

/** How many cards are asking for a person right now. The number on the tab. */
export function needingYou(cards: readonly Workspace[]): number {
  return cards.filter((one) => one.state === 'needs you' || one.state === 'ready to review').length;
}

/** Whether this card's work can be landed. Nothing changed is nothing to land,
 *  and something already landed cannot be landed twice. */
export function canLand(card: Workspace): boolean {
  return card.state !== 'landed' && card.changed > 0;
}

/* -------------------------------------------------------------------------- */
/* Words                                                                       */
/* -------------------------------------------------------------------------- */

/** Money as somebody reads it, and nothing at all when the currency is not one
 *  we can name. A card is never the place a bad code throws. */
function spent(cost: Money | null): string | null {
  if (cost === null || cost.minor === 0) return null;
  try {
    return formatMoney(cost);
  } catch {
    return null;
  }
}

/**
 * The two lines on the card.
 *
 * The head is what the conversation is called, falling back to the branch —
 * an untitled conversation still has a name somebody can act on. The sub is
 * the state, then how much changed and against what, then what it cost.
 */
export function saysCard(one: Workspace): { head: string; sub: string } {
  const head = one.title.trim() === '' ? one.branch : one.title.trim();
  const parts: string[] = [workspaceWords.states[one.state]];

  if (one.changed === 0) parts.push(workspaceWords.nothingChanged);
  else {
    parts.push(
      `${workspaceWords.files(one.changed)} ${workspaceWords.tally(one.added, one.removed)} ${workspaceWords.from(one.base)}`,
    );
  }

  const cost = spent(one.cost);
  if (cost !== null) parts.push(cost);
  if (one.holdsWork && one.state !== 'landed') parts.push(workspaceWords.holds);

  return { head, sub: parts.join(' · ') };
}
