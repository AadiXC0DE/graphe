/** What is taking up the room, and how much of that we actually know.
 *
 * The model reports one number: how much of the conversation it is still
 * holding. It does not report a breakdown, and there is no way to ask for one.
 *
 * That one number is not a pure count either. It is the usage the model
 * reported on its last reply, plus a rough size for everything that has
 * happened since — and before the first reply it is rough all the way through.
 * So the line this file draws is between two grades of estimate, not between a
 * count and a guess:
 *
 *  - the total is grounded in the model's own reckoning up to its last reply,
 *    and every sentence that shows it says where the grounding stops;
 *  - the split is ours alone, read off the text on screen, and is called an
 *    estimate wherever it appears;
 *  - when the total is not known — right after a tidy — we say we do not know
 *    rather than showing zeros, which would read as an empty conversation.
 *
 * Nothing here draws anything.
 */

import type { Turn } from './thread';

/** One slice of the conversation, by where its text came from. */
export type Share = {
  kind: 'you' | 'graphe' | 'work' | 'trouble';
  label: string;
  /** 0–1 of the conversation, by our estimate. */
  part: number;
  /** Estimated size, in the same made-up unit `sizeOf` counts in. */
  roughly: number;
};

/**
 * Characters per unit.
 *
 * A crude divisor on purpose. The real count depends on the model's own way of
 * cutting text up, which differs between models, treats a path and a paragraph
 * differently, and is not exposed to us at all — so any number this produces is
 * a proportion worth looking at and never a measurement worth quoting. Four is
 * the usual rule of thumb for English prose; code and paths run denser, which
 * is one more reason the interface calls the result an estimate.
 */
const PER_UNIT = 4;

function sizeOf(...texts: readonly (string | undefined)[]): number {
  let total = 0;
  for (const text of texts) if (text !== undefined) total += text.length;
  return Math.round(total / PER_UNIT);
}

/** Every word this ever puts in front of anybody. */
export const ROOM_WORDS = {
  heading: 'What is filling it',
  you: 'What you said',
  graphe: 'What Graphe said',
  work: 'Work it did',
  trouble: 'Things that went wrong',
  /** Said under the bar, every time the bar is shown. */
  estimated:
    'The split is our own reading of the conversation on screen, not a count. The figure above is the closer of the two.',
  /** No total to report: the conversation has just been shortened. */
  notKnown: 'Not known just now — the conversation was shortened, and nothing has been counted since.',
  /** Nothing said yet, but the figure above is not zero — what the model is
   *  already holding is its instructions and the tools it can reach. Saying
   *  "nothing in here" beside a real number reads as a contradiction. */
  empty: 'Nothing said yet — what it is holding is its instructions and the tools it can reach.',
  /** Tail of the total sentence, saying how far the model's own reckoning
   *  reaches. It reports its usage when it replies; everything after that
   *  reply is sized by us until it replies again, so calling the whole figure
   *  counted would be a claim the number cannot carry. */
  counted: 'counted to its last reply, reckoned since',
} as const;

const LABELS: Record<Share['kind'], string> = {
  you: ROOM_WORDS.you,
  graphe: ROOM_WORDS.graphe,
  work: ROOM_WORDS.work,
  trouble: ROOM_WORDS.trouble,
};

/** Ties break here, so the same thread always draws in the same order. */
const ORDER: readonly Share['kind'][] = ['you', 'graphe', 'work', 'trouble'];

/**
 * Bucket the thread by where the text came from.
 *
 * Turns that hold somebody's own message until they answer — an estimate, a
 * plan — count that message as theirs, because it is their words sitting in the
 * conversation either way.
 */
export function sharesOf(turns: readonly Turn[]): readonly Share[] {
  const sized: Record<Share['kind'], number> = { you: 0, graphe: 0, work: 0, trouble: 0 };

  for (const turn of turns) {
    switch (turn.kind) {
      case 'said':
        sized[turn.from === 'you' ? 'you' : 'graphe'] += sizeOf(turn.text);
        break;
      case 'did':
        sized.work += sizeOf(turn.label, turn.detail, turn.progress, turn.real);
        break;
      case 'asked':
        sized.work += sizeOf(turn.question, turn.detail, turn.consequence, turn.real);
        break;
      case 'estimate':
        sized.you += sizeOf(turn.text);
        break;
      case 'plan':
        sized.you += sizeOf(turn.text);
        sized.graphe += sizeOf(...turn.steps, ...turn.caveats);
        break;
      case 'review':
        sized.graphe += sizeOf(
          turn.verdict.summary,
          ...turn.verdict.findings.map((finding) => finding.issue),
        );
        break;
      case 'trouble':
        sized.trouble += sizeOf(turn.trouble.what, turn.trouble.because, turn.trouble.details);
        break;
      case 'tidying':
        break;
    }
  }

  const whole = ORDER.reduce((sum, kind) => sum + sized[kind], 0);
  if (whole === 0) return [];

  return ORDER.filter((kind) => sized[kind] > 0)
    .map((kind) => ({ kind, label: LABELS[kind], part: sized[kind] / whole, roughly: sized[kind] }))
    .sort((a, b) => b.roughly - a.roughly || ORDER.indexOf(a.kind) - ORDER.indexOf(b.kind));
}

/** A whole number of thousands, matching the ring beside this. */
function thousands(count: number): string {
  return count >= 1000 ? `${Math.round(count / 1000).toLocaleString()}k` : String(count);
}

/** The one sentence about the total, which is the only figure anybody counted. */
export function saysRoom(tokens: number | null, contextWindow: number): string {
  if (tokens === null || contextWindow <= 0) return ROOM_WORDS.notKnown;
  const part = Math.round(Math.min(1, tokens / contextWindow) * 100);
  return `${thousands(tokens)} of ${thousands(contextWindow)} used · ${part}% · ${ROOM_WORDS.counted}`;
}
