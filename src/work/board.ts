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
  /** Said on the card that takes the decision, so nobody presses it expecting
   *  the others to still be there. */
  insteadOfOthers: (of: number): string =>
    `Using this one throws away the other ${of === 2 ? 'way' : `${String(of - 1)} ways`}.`,
} as const;

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

function word(count: number): string {
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

  if (needsYou > 0) parts.push(`${word(needsYou)} waiting on you`);
  if (going > 0) parts.push(`${word(going)} going`);
  if (waiting > 0) parts.push(`${word(waiting)} waiting`);
  if (done > 0) parts.push(`${word(done)} finished`);
  if (broke > 0) parts.push(`${word(broke)} didn’t work`);

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
  return `${capitalise(word(most))} at a time is as many as I can do properly. The rest start as soon as one finishes.`;
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
