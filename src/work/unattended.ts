/** Work carrying on with nobody watching, and the one rule that makes it safe.
 *
 * A question the Guard asks is a question for a person. Nothing here answers
 * one. `answer` is the only door out of this file, it takes the decision as an
 * argument, and every other method — every event heard, every stop, every close
 * — either leaves a question waiting or turns it down. There is deliberately no
 * timeout, no default and no "carry on if nobody objects": a run that needs
 * somebody stops, and it says so when they come back.
 *
 * That is the whole safety story of working while the window is shut, so it is
 * written as one small class with one guarded exit rather than spread across the
 * shell where it would have to be re-checked every time something moved.
 */

import type { AgentEvent } from '../agent/types';

/** Yes or no, from a person. The same two the Guard accepts, and no third. */
export type Decision = 'yes' | 'no';

/** One question left standing while nobody was there. */
export type Asked = {
  /** Which call it is about. */
  callId: string;
  question: string;
  detail: string | null;
  consequence: string | null;
  /** When it was asked, epoch ms. */
  at: number;
};

/** Every sentence this module can put in front of somebody, in one place so the
 *  vocabulary can be swept. */
export const awayWords = {
  /** The state of a piece of work that stopped for a person. */
  stopped: 'Waiting for your answer',
  /** Under the question itself. */
  why: 'I stopped here rather than deciding for you. Nothing has been changed.',
  yes: 'Yes, go ahead',
  no: 'No, leave it',
  /** When a piece of work was let go with a question still open. */
  turnedDown: 'I stopped rather than deciding for you, and then this was let go.',
  nothing: 'Nothing has been left running.',
  keepGoing: 'Keep going without me',
  keepGoingHint:
    'I carry on with this in a copy of your project, even if you close the window. Whatever it makes is waiting for you, as a picture, when you come back.',
} as const;

const NUMBERS = ['no', 'one', 'two', 'three', 'four', 'five', 'six'];

function word(count: number): string {
  return NUMBERS[count] ?? String(count);
}

function capitalise(sentence: string): string {
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

function plural(count: number, one: string, many: string): string {
  return `${word(count)} ${count === 1 ? one : many}`;
}

/* -------------------------------------------------------------------------- */
/* The questions nobody answered                                               */
/* -------------------------------------------------------------------------- */

/**
 * The questions one unattended run has left standing.
 *
 * Given the run's own way of answering, which it calls from exactly one place.
 * Hand it a spy and the whole rule is checkable: hear anything you like, and the
 * spy stays untouched until a person says a word.
 */
export class Unattended {
  readonly #answer: (callId: string, decision: Decision) => boolean;
  readonly #asked = new Map<string, Asked>();
  /** True once this run has been let go. Nothing waits after that. */
  #over = false;

  constructor(answer: (callId: string, decision: Decision) => boolean) {
    this.#answer = answer;
  }

  /** Questions still standing, oldest first. */
  get waiting(): readonly Asked[] {
    return [...this.#asked.values()];
  }

  get isWaiting(): boolean {
    return this.#asked.size > 0;
  }

  /** The one somebody is being shown, which is always the oldest. */
  get first(): Asked | null {
    return this.waiting[0] ?? null;
  }

  /**
   * One event from the run.
   *
   * A question is written down. A call that then started, or was blocked, is a
   * question that has been settled elsewhere and stops being one here. Nothing
   * in this method reaches `answer` — not for a call whose own input claims to
   * have been approved, not for one the model wrote a reassuring reason on, not
   * ever. What the model says about a call is not an input to this.
   */
  heard(event: AgentEvent, at: number): void {
    if (this.#over) return;
    if (event.type === 'needs-confirmation') {
      this.#asked.set(event.call.id, {
        callId: event.call.id,
        question: event.verdict.question,
        detail: event.verdict.detail ?? null,
        consequence: event.verdict.consequence ?? null,
        at,
      });
      return;
    }
    if (event.type === 'tool-start' || event.type === 'blocked') {
      this.#asked.delete(event.call.id);
    }
  }

  /**
   * A person's answer, and the only way anything here is ever answered.
   *
   * False when there was no such question — an id from a stale window, one
   * already answered, or one belonging to a run that has been let go.
   */
  answer(callId: string, decision: Decision): boolean {
    if (decision !== 'yes' && decision !== 'no') return false;
    if (!this.#asked.has(callId)) return false;
    this.#asked.delete(callId);
    return this.#answer(callId, decision);
  }

  /**
   * The run is over — let go, stopped, or the app closing.
   *
   * Every question still standing is turned down. An unanswered question must
   * never resolve to yes, and "we are shutting down" is not a person saying so.
   */
  stop(): void {
    if (this.#over) return;
    this.#over = true;
    const open = [...this.#asked.keys()];
    this.#asked.clear();
    for (const callId of open) this.#answer(callId, 'no');
  }

  get over(): boolean {
    return this.#over;
  }
}

/* -------------------------------------------------------------------------- */
/* What a person is told when they come back                                   */
/* -------------------------------------------------------------------------- */

/** The least this module needs to know about a piece of work to talk about it. */
export type Finished = {
  doing: string;
  state: 'waiting' | 'running' | 'needs-you' | 'done' | 'failed';
};

/**
 * The one line over everything that happened while they were away.
 *
 * Ordered by what wants doing: something waiting on them first, then what is
 * ready to look at, then what did not work, then what is still going. Null when
 * there is nothing worth saying, so nothing draws a line about nothing.
 */
export function saysWhileAway(pieces: readonly Finished[]): string | null {
  const many = (state: Finished['state']): number =>
    pieces.filter((one) => one.state === state).length;

  const needsYou = many('needs-you');
  const done = many('done');
  const broke = many('failed');
  const going = many('running') + many('waiting');

  const parts: string[] = [];
  if (needsYou > 0) parts.push(`${plural(needsYou, 'thing', 'things')} waiting on you`);
  if (done > 0) parts.push(`${plural(done, 'thing', 'things')} ready to look at`);
  if (broke > 0) parts.push(`${plural(broke, 'thing', 'things')} that didn’t work`);
  if (going > 0) parts.push(`${plural(going, 'thing', 'things')} still going`);
  if (parts.length === 0) return null;

  return `${capitalise(parts.join(', '))}.`;
}

/** What one finished piece of work is called, and what it did, for the notice
 *  that arrives on somebody's screen. Kept short: a notice nobody can read at a
 *  glance is a notice nobody reads. */
export type Notice = { title: string; body: string };

function trimmed(text: string, most: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length <= most ? one : `${one.slice(0, most - 1)}…`;
}

/**
 * The sentence that arrives on screen when a piece of work lands.
 *
 * The project's name on top, because that is what tells somebody which of their
 * afternoons this is about, and one sentence under it saying what happened.
 */
export function saysNotice(project: string, piece: Finished, said?: string | null): Notice {
  const doing = trimmed(piece.doing, 80);
  const title = trimmed(project, 40);
  if (piece.state === 'needs-you') {
    return { title, body: `${doing} — I stopped and I need you for a moment.` };
  }
  if (piece.state === 'failed') {
    return { title, body: `${doing} — it didn’t work. Nothing in your project changed.` };
  }
  const detail = said === undefined || said === null || said.trim() === '' ? null : trimmed(said, 90);
  return { title, body: detail === null ? `${doing} — done, and waiting for you.` : detail };
}
