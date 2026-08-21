/** Several pieces of work at once, arranged so the results are what you compare.
 *
 * Everyone else draws work in flight as a list of names and spinners, which is a
 * picture of the machine. This is the shape of a contact sheet: what is going,
 * what is waiting its turn, what is finished and ready to look at — newest of
 * each first, because the one that just landed is the one being asked about.
 *
 * Pure, and `now` is always an argument. No clock in here, so a board drawn a
 * minute later never disagrees with the one a test drew.
 */

/** `needs-you` is a run that hit a question only a person can answer and stopped
 *  there. It is not going and it is not over — it is holding, which is a
 *  different thing to say and a different thing to draw. */
export type WorkState = 'waiting' | 'running' | 'needs-you' | 'done' | 'failed';

/** How many copies of a project run side by side. Four fills a sheet and leaves
 *  the machine usable; every extra one is another whole copy on disk. */
export const AT_A_TIME = 4;

/** The least the board needs to know about one piece of work. */
export type OnBoard = {
  id: string;
  /** One sentence: what this piece of work is doing. */
  doing: string;
  state: WorkState;
  /** When it was asked for, epoch ms. */
  at: number;
  /** A picture of its result, once there is one. */
  picture?: string | null;
};

export type BandKey = 'needs-you' | 'running' | 'waiting' | 'finished';

export type Band<T> = {
  key: BandKey;
  /** "Going", "Waiting", "Finished". */
  label: string;
  /** Newest first. */
  items: readonly T[];
};

/** Every sentence this module can put in front of somebody, in one place so the
 *  vocabulary can be swept. */
export const boardWords = {
  keep: 'Use this one',
  drop: 'Throw it away',
  stop: 'Stop this one',
  look: 'Look closer',
  nothing: 'Nothing going yet.',
  waiting: 'Waiting its turn',
  going: 'Going',
  ready: 'Ready to look at',
  broke: 'Didn’t work',
  needsYou: 'Waiting for your answer',
  /** On a card that is one of several goes at the same thing. Keeping one of
   *  these is a choice between them, not a choice about it. */
  oneOf: (at: number, of: number): string => `Way ${String(at)} of ${String(of)}`,
  /** Where "Use this one" would have been, on a go with nothing to hand over
   *  yet. What it is up to is said just above it, so this says only why there
   *  is no offer. Null once there is one. */
  notYet: (state: WorkState): string | null => {
    if (canKeep(state)) return null;
    if (state === 'failed') return 'Nothing to take from this one.';
    return 'Nothing to take until it finishes.';
  },
  /** The same fact at length, for somebody who asked for it anyway. */
  notYetBecause: (doing: string, state: WorkState): string => {
    if (state === 'failed') {
      return `“${doing}” didn’t work, so there is nothing to bring into your project.`;
    }
    if (state === 'needs-you') {
      return `“${doing}” stopped to ask you something. Answer it, and it will carry on.`;
    }
    const where = state === 'waiting' ? 'has not started yet' : 'is still going';
    return `“${doing}” ${where}. It will be there to take when it finishes.`;
  },
  /** Said on the card that takes the decision, so nobody presses it expecting
   *  the others to still be there. */
  insteadOfOthers: (of: number): string =>
    `Using this one throws away the other ${of === 2 ? 'way' : `${String(of - 1)} ways`}.`,
  /** Offered only while something is going: it is heard between one step and
   *  the next, so on a finished piece there is nothing left to hear it. */
  /** On a card that is one of several goes: the one press that answers
   *  "which of these do I take?" without opening three folders. */
  against: 'Side by side',
  /** On a piece held back until another finishes. The wait can be set when the
   *  work is asked for; until now it could never be changed afterwards, so a
   *  piece waiting on something abandoned waited forever. */
  stopWaiting: 'Don’t wait for that',
  say: 'Say something',
  sayPlaceholder: 'Try a different approach…',
  send: 'Send',
  sending: 'Sending…',
  sent: 'It will hear that between steps.',
} as const;

/**
 * Which cards carry the one press that compares a group of goes.
 *
 * One per group, not one per card: the comparison is about the several goes
 * together, and repeating it on each of them crowds the row of decisions
 * underneath into a wrap. The first still on the board carries it, so throwing
 * one away never takes the comparison with it.
 */
export function speaksForGroup(
  pieces: readonly { id: string; oneOf?: { named: string } | null }[],
): ReadonlySet<string> {
  const first = new Map<string, string>();
  for (const piece of pieces) {
    const named = piece.oneOf?.named;
    if (named === undefined || named === null) continue;
    if (!first.has(named)) first.set(named, piece.id);
  }
  return new Set(first.values());
}

/**
 * Which go each one is, and out of how many, wherever a go is named.
 *
 * One numbering for the card and the comparison alike: a go that is "Way 2 of
 * 3" on the board has to be "Way 2 of 3" in the sheet, whatever has started.
 * Work that is not one of several is not in the map — there is nothing to
 * number, and a lone survivor of a group is no longer a choice.
 */
export function waysNumbering(
  pieces: readonly { id: string; ways?: string | null }[],
): ReadonlyMap<string, { at: number; of: number; named: string }> {
  const groups = new Map<string, string[]>();
  for (const piece of pieces) {
    const named = piece.ways;
    if (named === undefined || named === null) continue;
    groups.set(named, [...(groups.get(named) ?? []), piece.id]);
  }

  const numbering = new Map<string, { at: number; of: number; named: string }>();
  for (const [named, ids] of groups) {
    if (ids.length < 2) continue;
    ids.forEach((id, at) => numbering.set(id, { at: at + 1, of: ids.length, named }));
  }
  return numbering;
}

/** Whether one piece has a result to take. Only something finished has: the
 *  rest have a folder somebody can watch and nothing to hand over. */
export function canKeep(state: WorkState): boolean {
  return state === 'done';
}

/** The whole answer when somebody asks for one that cannot be taken, and null
 *  when it can. Said as its own thing rather than as "it changed nothing" —
 *  that is a different fact, about a piece that has actually finished. */
export function saysCannotKeep(
  doing: string,
  state: WorkState,
): { what: string; because: string; actionLabel: string } | null {
  if (canKeep(state)) return null;
  return {
    what: 'There is nothing to take from this one yet.',
    because: boardWords.notYetBecause(doing, state),
    actionLabel: 'Got it',
  };
}

/**
 * Whether a piece can still hear a sentence from a person.
 *
 * Something in flight can, because it is heard between one step and the next.
 * So can one stopped on a question — that is a turn held open mid-step, and it
 * is where a sentence lands most reliably of all, so leaving it out hid the
 * control exactly where it works best. Anything finished has nothing left to
 * hear it, and offering it there would be a press that quietly does nothing.
 */
export function canHearYou(state: WorkState): boolean {
  return state === 'running' || state === 'needs-you';
}

/** What wants a person comes first, then what is happening, then what has not
 *  started, then what is over. */
const BAND_ORDER: readonly BandKey[] = ['needs-you', 'running', 'waiting', 'finished'];

const BAND_LABELS: Record<BandKey, string> = {
  'needs-you': 'Needs you',
  running: 'Going',
  waiting: 'Waiting',
  finished: 'Finished',
};

const NUMBERS = [
  'no',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
];

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/* ---------------------------------------------------------------- ordering */

/** Which band a piece of work belongs in. Failed sits with finished: it is over,
 *  and what it managed is still there to look at. */
export function bandOf(state: WorkState): BandKey {
  if (state === 'needs-you') return 'needs-you';
  if (state === 'running') return 'running';
  if (state === 'waiting') return 'waiting';
  return 'finished';
}

/** The whole board in the order it is drawn. */
export function orderWork<T extends OnBoard>(pieces: readonly T[]): readonly T[] {
  return [...pieces].sort((one, other) => {
    const band = BAND_ORDER.indexOf(bandOf(one.state)) - BAND_ORDER.indexOf(bandOf(other.state));
    return band !== 0 ? band : other.at - one.at;
  });
}

/** The same order, in bands. Empty bands are left out rather than drawn as a
 *  heading with nothing under it. */
export function groupWork<T extends OnBoard>(pieces: readonly T[]): readonly Band<T>[] {
  const ordered = orderWork(pieces);
  const bands: Band<T>[] = [];
  for (const key of BAND_ORDER) {
    const items = ordered.filter((one) => bandOf(one.state) === key);
    if (items.length > 0) bands.push({ key, label: BAND_LABELS[key], items });
  }
  return bands;
}

/* ------------------------------------------------------------ cap and queue */

export function howManyGoing(pieces: readonly OnBoard[]): number {
  return pieces.filter((one) => one.state === 'running').length;
}

/** How many are holding a copy of the project open. One stopped for a person is
 *  still holding one — it has not finished, it is waiting to be told what to do
 *  — so it counts against the cap even though it is not going. */
export function howManyInFlight(pieces: readonly OnBoard[]): number {
  return pieces.filter((one) => one.state === 'running' || one.state === 'needs-you').length;
}

/** How many more could start right now. */
export function roomLeft(pieces: readonly OnBoard[], most: number = AT_A_TIME): number {
  return Math.max(0, most - howManyInFlight(pieces));
}

export function isFull(pieces: readonly OnBoard[], most: number = AT_A_TIME): boolean {
  return roomLeft(pieces, most) === 0;
}

/** Which waiting pieces get to start now.
 *
 *  Oldest first — the queue is first come, first served, which is the opposite
 *  of the order the board draws them in. */
export function nextUp<T extends OnBoard>(
  pieces: readonly T[],
  most: number = AT_A_TIME,
): readonly T[] {
  const room = roomLeft(pieces, most);
  if (room === 0) return [];
  return [...pieces]
    .filter((one) => one.state === 'waiting')
    .sort((one, other) => one.at - other.at)
    .slice(0, room);
}

/* ------------------------------------------------------------------- words */

/** "three" up to twelve, then the number itself. Shared, so a board and a set
 *  of work going in never count the same things in two different voices. */
export function countWord(count: number): string {
  return NUMBERS[count] ?? String(count);
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

/** The one line above the sheet: "Three going, one waiting." */
export function saysBoard(pieces: readonly OnBoard[]): string {
  if (pieces.length === 0) return boardWords.nothing;

  const many = (state: WorkState) => pieces.filter((one) => one.state === state).length;
  const parts: string[] = [];
  const needsYou = many('needs-you');
  const going = many('running');
  const waiting = many('waiting');
  const done = many('done');
  const broke = many('failed');

  if (needsYou > 0) parts.push(`${countWord(needsYou)} waiting on you`);
  if (going > 0) parts.push(`${countWord(going)} going`);
  if (waiting > 0) parts.push(`${countWord(waiting)} waiting`);
  if (done > 0) parts.push(`${countWord(done)} finished`);
  if (broke > 0) parts.push(`${countWord(broke)} didn’t work`);

  return `${capitalise(parts.join(', '))}.`;
}

/** What one card says about itself. */
export function saysState(state: WorkState): string {
  if (state === 'needs-you') return boardWords.needsYou;
  if (state === 'running') return boardWords.going;
  if (state === 'waiting') return boardWords.waiting;
  if (state === 'failed') return boardWords.broke;
  return boardWords.ready;
}

/** Letting one go means two different things depending on whether it has
 *  finished, and the button should say which. */
export function saysDrop(state: WorkState): string {
  return state === 'running' || state === 'waiting' || state === 'needs-you'
    ? boardWords.stop
    : boardWords.drop;
}

/** Why something is waiting rather than going, said once under the summary. */
export function saysFull(most: number = AT_A_TIME): string {
  return `${capitalise(countWord(most))} at a time is as many as I can do properly. The rest start as soon as one finishes.`;
}

/** How long ago, roughly. Rounded, because "4 minutes ago" is the answer and
 *  "3 minutes 51 seconds ago" is a stopwatch. */
export function saysWhen(at: number, now: number): string {
  const since = now - at;
  if (since < MINUTE) return 'just now';
  if (since < 2 * MINUTE) return 'a minute ago';
  if (since < HOUR) return `${String(Math.floor(since / MINUTE))} minutes ago`;
  if (since < 2 * HOUR) return 'an hour ago';
  if (since < DAY) return `${String(Math.floor(since / HOUR))} hours ago`;
  if (since < 2 * DAY) return 'yesterday';
  return `${String(Math.floor(since / DAY))} days ago`;
}
