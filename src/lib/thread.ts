/** The conversation, as data.
 *
 * Lifted out of `App.tsx` when projects became switchable. The window now holds
 * one of these per open project rather than one for the window (BACKLOG B2), and
 * "nothing leaks between projects" is a claim that ought to be provable without
 * a browser — so the fold that builds a thread lives here, next to the store
 * that keeps one per folder, and both are ordinary functions over ordinary data.
 *
 * Nothing in this file draws anything. `App.tsx` still owns every pixel.
 */

import type { ActivityState } from '../components/ActivityLine';
import type { MessageAuthor } from '../components/Message';
import type { AgentEvent, ImageCard, ReviewVerdict } from '../agent/types';
import type { Answers, Question } from '../agent/asking';
import type { Prompt } from '../cost/phrasing';
import { PLAN_WORDS } from '../agent/plan';
import { ADVISOR_ANSWERED, ADVISOR_LABEL, describeCall, isNoteKeeping } from './describe';
import { realWords } from './showme';
import type { Decision, Trouble } from './ipc';

/** A picture somebody put in the box, as the conversation shows it back. */
/** One thing sent with a message. A picture is drawn; a document is a row with
 *  its name, because that is what a PDF looks like to somebody who wants it
 *  back. `src` opens it either way. */
export type SentPicture = { name: string; src: string; kind?: 'image' | 'document' };

/**
 * One thing in the conversation, whoever caused it.
 *
 * A single ordered list rather than a message list with side channels, because
 * the order is the meaning: "I am about to change your header" only makes sense
 * above the change, and "you said no" only makes sense below the question.
 * Splitting activity out into its own pane would lose that, and it is the whole
 * reason the feed reads as one conversation instead of a log next to a chat.
 */
export type Turn =
  | {
      kind: 'said';
      id: string;
      from: MessageAuthor;
      text: string;
      streaming: boolean;
      /** Pictures attached to this message, held as the object URLs the
       *  composer already made. An object URL keeps the file it points at alive
       *  until it is revoked, and this one must not be — the turn is what shows
       *  it. No ceiling like `MOST_PICTURES` because it is the same URL the
       *  panel's own reference list is already holding: nothing new is kept. */
      pictures?: readonly SentPicture[];
    }
  | {
      kind: 'did';
      id: string;
      callId: string;
      state: ActivityState;
      /** When it began, epoch ms. A helper's card counts up from this; without
       *  it every helper on the board claimed to have started this second. */
      at?: number;
      label: string;
      detail?: string;
      /** What the step has said for itself while running — a helper's findings
       *  as they arrive. Kept apart from `detail`, which is what it was asked:
       *  overwriting one with the other loses the question the moment the first
       *  answer arrives, and a helper with no question beside it is a card
       *  nobody can read. */
      progress?: string;
      /** The real command, path or operation behind this step. Recorded on
       *  every turn and shown only when "Show me" is on — see the note on
       *  `real` below. */
      real?: string;
      /** A picture the step took. Drawn under the line, because a step that
       *  says it took a picture and shows nothing is a step nobody can check. */
      shown?: ImageCard;
    }
  | {
      kind: 'asked';
      id: string;
      callId: string;
      question: string;
      detail?: string;
      consequence?: string;
      real?: string;
      /** Null while the question is still open. */
      answered: Decision | null;
    }
  /**
   * "This is a bigger job — about ₹35 and roughly four minutes."
   *
   * COST-DESIGN §2, and the one confirmation in the product that is not about
   * safety. It holds the message somebody typed until they answer, which is why
   * the text lives on the turn: the sentence must not be lost by the window
   * while it waits, and it must not be sent by accident either.
   *
   * Only ever created above the user's own threshold. Every other request goes
   * straight through without a word — a confirmation on every small change is
   * noise, and noise gets dismissed without reading.
   */
  | {
      kind: 'estimate';
      id: string;
      /** What they asked for, held until they say go ahead. */
      text: string;
      /** Every word of it from src/cost/phrasing.ts. Nothing is written here. */
      prompt: Prompt;
      /** Null while the question is still open. */
      answered: 'went-ahead' | 'smaller' | null;
    }
  /**
   * "We've covered a lot in here. I'll tidy up my notes so things stay quick."
   *
   * One line in the conversation, in the place it happened, said once. It is a
   * `did`-shaped thing rather than a message because it is something happening
   * with a beginning and an end — the spinner is honest, and it stops.
   */
  /**
   * "Here's what I'd do." The steps, and the two answers.
   *
   * Shaped like `estimate` because it does the same job: it holds what somebody
   * asked for until they say go ahead. The difference is what it is protecting
   * them from — not the cost, but forty files changed before anybody agreed.
   */
  | {
      kind: 'plan';
      id: string;
      /** Their own words, held until they answer. */
      text: string;
      steps: readonly string[];
      caveats: readonly string[];
      /** What it would need to know before this list is right. Usually none —
       *  a plan built on a guess is worse than two sharp questions. */
      questions: readonly string[];
      /** Null while the question is still open. */
      answered: 'went-ahead' | 'changing' | null;
    }
  | { kind: 'tidying'; id: string; state: ActivityState }
  /**
   * A handful of things it would rather not guess, put before the work starts.
   *
   * `answers` is empty until somebody picks. `answered` is what closes the
   * card: it can be closed by being answered, by being waved through, or by
   * the turn ending under it, and the card has to be able to say which.
   */
  | {
      kind: 'asked-first';
      id: string;
      questions: readonly Question[];
      answers: Answers;
      answered: 'answered' | 'waved-through' | 'withdrawn' | null;
    }
  /** Waiting out a service that could not answer. `seconds` is how long this
   *  wait is, so the line can say it rather than spin. */
  | { kind: 'holding'; id: string; state: ActivityState; seconds: number }
  | { kind: 'trouble'; id: string; trouble: Trouble }
  /** "I checked the change: here is the verdict." Draws the review card. */
  | {
      kind: 'review';
      id: string;
      verdict: ReviewVerdict;
      /** Whether the fix is already on its way; the card asks once. */
      asked: boolean;
    };

/** The turn that holds a message back until somebody has seen what it will
 *  cost. Named because the window passes one around. */
export type EstimateTurn = Extract<Turn, { kind: 'estimate' }>;

let counter = 0;

/** Unique for the life of the window, and deliberately not per project: two
 *  threads whose turns share ids would be two threads React cannot tell apart
 *  the moment somebody switches between them. */
export function newId(): string {
  counter += 1;
  return `turn-${counter}`;
}

export function said(from: MessageAuthor, text: string, pictures?: readonly SentPicture[]): Turn {
  return {
    kind: 'said',
    id: newId(),
    from,
    text,
    streaming: false,
    ...(pictures === undefined || pictures.length === 0 ? {} : { pictures }),
  };
}

export function estimated(text: string, prompt: Prompt): Turn {
  return { kind: 'estimate', id: newId(), text, prompt, answered: null };
}

/** Whether the conversation is waiting on a person rather than on the agent.
 *  Anything held back until somebody answers is the next thing to happen, so
 *  a message waiting in line waits for it too. */
export function askingYou(turns: readonly Turn[]): boolean {
  const last = turns[turns.length - 1];
  if (last === undefined) return false;
  switch (last.kind) {
    case 'asked':
    case 'estimate':
    case 'plan':
      return last.answered === null;
    // The turn really is parked on this one: the agent asked before starting
    // and is waiting. Without it here, a message typed underneath goes out as
    // though nothing were pending.
    case 'asked-first':
      return last.answered === null;
    default:
      return false;
  }
}

/**
 * The most pictures a conversation keeps.
 *
 * Each is a few hundred kilobytes held in the window's own memory and copied
 * again every time the conversation is redrawn, so a long run of screenshots
 * would grow without a ceiling. The older ones are not what anybody scrolls
 * back for — the line above each still says what it was.
 */
export const MOST_PICTURES = 6;

/** Drop the bytes from all but the newest few, leaving every line intact. */
function capPictures(turns: Turn[]): void {
  const at: number[] = [];
  for (let index = 0; index < turns.length; index += 1) {
    const turn = turns[index];
    if (turn?.kind === 'did' && turn.shown !== undefined) at.push(index);
  }
  if (at.length <= MOST_PICTURES) return;
  for (const index of at.slice(0, at.length - MOST_PICTURES)) {
    const turn = turns[index];
    if (turn?.kind !== 'did') continue;
    const { shown: _dropped, ...rest } = turn;
    turns[index] = rest;
  }
}

/** Close off the most recent activity for a call. False when there was nothing
 *  to close, which is how `blocked` tells the difference between "stopped
 *  something that had started" and "stopped it before it started" — the Guard
 *  does the latter, and there is no line to update. */
function closeInto(
  turns: Turn[],
  callId: string,
  state: ActivityState,
  detail?: string,
  shown?: ImageCard,
): boolean {
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (turn === undefined) continue;
    if (turn.kind !== 'did' || turn.callId !== callId || turn.state !== 'running') continue;
    // The advisor's reply is what it said, not what it was asked, so it goes
    // where a helper's findings go and the question stays on the turn beside
    // it. The line then says the second model answered rather than only that
    // it was asked, which is the half somebody would otherwise never see.
    const answered = state === 'done' && detail !== undefined && turn.label === ADVISOR_LABEL;
    turns[index] = {
      ...turn,
      state,
      ...(answered
        ? { label: ADVISOR_ANSWERED, progress: detail }
        : { detail: detail ?? turn.detail }),
      ...(shown === undefined ? {} : { shown }),
    };
    if (shown !== undefined) capPictures(turns);
    return true;
  }
  return false;
}

/**
 * Add a problem, unless it is the one already on screen.
 *
 * `prompt` can report the same failure twice: the adapter relays it as an
 * `error` event on the way out, and the call itself then comes back as a
 * failure. Both are correct and neither is redundant to the code — but two
 * identical cards stacked on top of each other reads as two things having gone
 * wrong, which is exactly the impression the error copy is written to avoid.
 */
function troubleInto(turns: Turn[], trouble: Trouble): boolean {
  const from = Math.max(0, turns.length - 3);
  for (let index = turns.length - 1; index >= from; index -= 1) {
    const turn = turns[index];
    if (turn === undefined || turn.kind !== 'trouble') continue;
    if (turn.trouble.because !== trouble.because) continue;
    // Same failure. The two tellings of it can differ in one way that matters:
    // only one carries the raw text for whoever wants to read it. Keep that one.
    if (turn.trouble.details !== undefined || trouble.details === undefined) return false;
    turns[index] = { ...turn, trouble };
    return true;
  }
  turns.push({ kind: 'trouble', id: newId(), trouble });
  return true;
}

export function withTrouble(turns: readonly Turn[], trouble: Trouble): readonly Turn[] {
  const next = [...turns];
  return troubleInto(next, trouble) ? next : turns;
}

export const STOPPED_PART_WAY = 'I stopped part way through.';

/** What a step that was still running says once the run it belonged to was
 *  ended rather than finished. */
export const STEP_WAS_STOPPED = 'stopped';

/** The looking-around pass has no tool call behind it, so it borrows one id.
 *  Nothing else may use it. */
const LOOKING = 'graphe:looking';

/** Hold what somebody asked for while they read the plan for it. */
export function planned(
  text: string,
  proposal: { steps: readonly string[]; caveats: readonly string[]; questions?: readonly string[] },
): Turn {
  return {
    kind: 'plan',
    id: newId(),
    text,
    steps: proposal.steps,
    caveats: proposal.caveats,
    questions: proposal.questions ?? [],
    answered: null,
  };
}

/**
 * Fold one event into a thread that is being built, in place.
 *
 * Returns whether anything changed. Rehydrating a long conversation folds
 * thousands of events, and a fresh copy of the whole thread per event is the
 * seconds it takes to open one; `applyEvent` copies once and calls this, so
 * both paths fold by exactly the same rules.
 *
 * A turn is never edited where it lies — the slot is replaced. The window keeps
 * older arrays of these around (a parked conversation, the last render), and a
 * turn changed underneath one of them would change a thread nobody touched.
 */
export function applyEventInto(turns: Turn[], event: AgentEvent): boolean {
  switch (event.type) {
    case 'message-delta': {
      const at = turns.length - 1;
      const last = turns[at];
      if (last !== undefined && last.kind === 'said' && last.from === 'graphe' && last.streaming) {
        turns[at] = { ...last, text: last.text + event.text };
        return true;
      }
      turns.push({ kind: 'said', id: newId(), from: 'graphe', text: event.text, streaming: true });
      return true;
    }

    case 'message-end': {
      let changed = false;
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn?.kind !== 'said' || !turn.streaming) continue;
        turns[index] = { ...turn, streaming: false };
        changed = true;
      }
      return changed;
    }

    case 'tool-start': {
      // Notes kept between sittings are the app's own bookkeeping. Nothing in
      // the project moved, so the conversation says nothing about it.
      if (isNoteKeeping(event.call.name)) return false;
      const described = describeCall(event.call);
      turns.push({
        kind: 'did',
        id: newId(),
        callId: event.call.id,
        state: 'running',
        at: Date.now(),
        label: described.label,
        detail: described.detail,
        // Recorded whether or not "Show me" is on, so that turning it on
        // explains the conversation you already had rather than only the one
        // you are about to have. A history that starts when you ask for it is
        // no use for working out what just happened.
        real: realWords(event.call),
      });
      return true;
    }

    /* Waiting between steps because somebody asked it to. Nothing is added to
       the conversation: the run has not ended and nothing has happened, so a
       line saying so would be a line about the button they just pressed. */
    case 'waiting-for-you':
      return false;

    case 'tool-progress': {
      let changed = false;
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn?.kind !== 'did' || turn.callId !== event.id || turn.state !== 'running') continue;
        turns[index] = { ...turn, progress: event.text };
        changed = true;
      }
      return changed;
    }

    case 'tool-end':
      return closeInto(turns, event.id, event.ok ? 'done' : 'failed', event.detail, event.shown);

    case 'blocked': {
      if (closeInto(turns, event.call.id, 'failed', event.reason)) return true;
      if (isNoteKeeping(event.call.name)) return false;
      turns.push({
        kind: 'did',
        id: newId(),
        callId: event.call.id,
        state: 'failed',
        label: describeCall(event.call).label,
        detail: event.reason,
        real: realWords(event.call),
      });
      return true;
    }

    case 'needs-confirmation':
      turns.push({
        kind: 'asked',
        id: newId(),
        callId: event.call.id,
        question: event.verdict.question,
        detail: event.verdict.detail,
        consequence: event.verdict.consequence,
        real: realWords(event.call),
        answered: null,
      });
      return true;

    /* A question nobody can answer any more. It is marked refused rather than
       removed: it happened, the person saw it, and a card that vanishes leaves
       them wondering whether it went through. */
    case 'questions-withdrawn': {
      const gone = new Set(event.callIds);
      let changed = false;
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn?.kind !== 'asked' || turn.answered !== null || !gone.has(turn.callId)) continue;
        turns[index] = { ...turn, answered: 'no' };
        changed = true;
      }
      return changed;
    }

    /* Held by the window beside the composer, not folded into the thread: a
       message waiting its turn is not something that has happened yet. */
    case 'queued':
      return false;

    /* The agent has begun on one of the queued messages. The waiting line
       beside the composer hears this directly — it must not depend on Pi's
       own bookkeeping removal, which is exact-text and can silently no-op. */
    case 'message-started':
      return false;

    /* A reply that failed part way through has still ended. The shell sends
       `error` *instead of* `message-end` when the failure arrives on the
       assistant's own message, so closing the reply here is the only thing that
       closes it: left open, it stayed marked as still streaming forever, which
       read as "something is running" and put out the quiet mark for the rest of
       the sitting. */
    case 'error': {
      // Everything that was still going is over. A failure can arrive mid
      // sentence, mid tool call or mid tidy, and each of those reads as
      // "something is running" to the quiet mark — so closing only the
      // sentence left the other two latched on for the rest of the sitting.
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn === undefined) continue;
        if (turn.kind === 'said' && turn.streaming) turns[index] = { ...turn, streaming: false };
        else if (turn.kind === 'did' && turn.state === 'running') {
          turns[index] = { ...turn, state: 'failed' };
        } else if (turn.kind === 'tidying' && turn.state === 'running') {
          turns[index] = { ...turn, state: 'failed' };
        } else if (turn.kind === 'holding' && turn.state === 'running') {
          turns[index] = { ...turn, state: 'failed' };
        } else if (turn.kind === 'asked-first' && turn.answered === null) {
          turns[index] = { ...turn, answered: 'withdrawn' };
        }
      }
      troubleInto(turns, {
        what: STOPPED_PART_WAY,
        because: event.message,
        actionLabel: 'Got it',
      });
      return true;
    }

    // The person's own words, replayed when a saved conversation comes back
    // (BACKLOG B1.1). During a live sitting the window writes these itself and
    // the shell never sends them; here they arrive as ordinary events, so a
    // rehydrated thread folds the same way a live one does.
    case 'user-said':
      turns.push(said('you', event.text));
      return true;

    // Looking around before touching anything, said once and closed off by
    // whatever the pass came back with.
    case 'planning': {
      if (turns.some((turn) => turn.kind === 'did' && turn.callId === LOOKING)) return false;
      turns.push({
        kind: 'did',
        id: newId(),
        callId: LOOKING,
        state: 'running',
        label: PLAN_WORDS.working,
      });
      return true;
    }

    /* Nothing readable came back is still something to answer. The card says so
       and offers the one press that asks again — without it plan mode ends in
       prose with no way forward. */
    case 'planned': {
      const closed = closeInto(turns, LOOKING, 'done');
      // Unless the pass was stopped or broke, which has already said why. A
      // card blaming the reply for that would be a second, wrong explanation.
      const last = turns[turns.length - 1];
      if (event.steps.length === 0 && last?.kind === 'trouble') return closed;
      turns.push({
        kind: 'plan',
        id: newId(),
        text: '',
        steps: event.steps,
        caveats: event.caveats,
        questions: event.questions,
        answered: null,
      });
      return true;
    }

    case 'tidying': {
      // Once. Pi can retry its own summarisation, and each attempt announces
      // itself; three copies of "we've covered a lot in here" would be an app
      // fretting rather than an app tidying.
      if (turns.some((turn) => turn.kind === 'tidying' && turn.state === 'running')) return false;
      turns.push({ kind: 'tidying', id: newId(), state: 'running' });
      return true;
    }

    case 'asked-first':
      turns.push({
        kind: 'asked-first',
        id: event.id,
        questions: event.questions,
        answers: {},
        answered: null,
      });
      return true;

    case 'asking-withdrawn': {
      const gone = new Set(event.ids);
      let changed = false;
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn?.kind !== 'asked-first' || turn.answered !== null || !gone.has(turn.id)) continue;
        turns[index] = { ...turn, answered: 'withdrawn' };
        changed = true;
      }
      return changed;
    }

    case 'holding': {
      // Once per wait, and never stacked: four waits in a row are four lines,
      // but a second announcement of the same one is an app fretting.
      if (turns.some((turn) => turn.kind === 'holding' && turn.state === 'running')) return false;
      turns.push({ kind: 'holding', id: newId(), state: 'running', seconds: event.seconds });
      return true;
    }

    case 'held': {
      const index = turns.findLastIndex(
        (turn) => turn.kind === 'holding' && turn.state === 'running',
      );
      const was = index === -1 ? undefined : turns[index];
      if (was?.kind !== 'holding') return false;
      turns[index] = { ...was, state: event.ok ? 'done' : 'failed' };
      return true;
    }

    case 'reviewed':
      turns.push({ kind: 'review', id: newId(), verdict: event.verdict, asked: false });
      return true;

    case 'tidied': {
      const index = turns.findLastIndex(
        (turn) => turn.kind === 'tidying' && turn.state === 'running',
      );
      const was = index === -1 ? undefined : turns[index];
      if (was?.kind !== 'tidying') return false;
      // A compaction can discover there is not enough settled conversation yet.
      // Do not leave behind a claim that notes were shortened when they were
      // not: the completed line says plainly that the conversation stayed put.
      turns[index] = { kind: 'tidying', id: was.id, state: event.ok ? 'done' : 'failed' };
      return true;
    }

    // Money says nothing in the thread. It is furniture in the corner, and the
    // split behind it is shown only when somebody asks for it — a running
    // commentary on cost is the anxiety this design exists to avoid. `running`
    // is furniture too, in its own band above the composer: a server outlives
    // the sentence that started it, so filing it under that sentence would put
    // it out of reach the moment the conversation moved on.
    case 'spend':
    case 'spend-summary':
    case 'model-reading':
    case 'running':
    case 'busy':
    case 'extension-turn':
    case 'prompt-size':
      return false;

    /* Something about the app rather than about this conversation. Said in the
       thread as a line, never as trouble: a ceiling reached is not a turn that
       failed, and painting the conversation red for it is the app blaming the
       work for its own housekeeping. */
    case 'notice':
      turns.push(
        said('graphe', event.because === undefined ? event.what : `${event.what} ${event.because}`),
      );
      return true;

    /* Everything has stopped, so anything still waiting on a person is waiting
       for an answer that can no longer reach anybody. The window works out that
       it is busy from the last turn being unanswered, so a card left open here
       kept the composer a spinner and left Stop with nothing to stop — for the
       rest of the sitting, and again every time the conversation was reopened,
       because the card comes back with the history. Closed here rather than
       only where it is abandoned: this is the window's own reckoning, and it
       has to hold even when the shell cannot say anything. */
    case 'settled': {
      /* A plan or an estimate left open is not stranded — it is waiting on
         somebody, which is what it is for. These are: a question nothing can
         answer now, a wait that cannot outlive the turn it was in, and a reply
         still marked as arriving. That last one matters after Stop: deltas
         already in flight can land once the window has optimistically marked
         everything stopped, opening a fresh streaming turn that no message-end
         will ever reach. Settled is the reckoning that closes it, or Stop's
         own quiet mark stays out for the rest of the sitting. */
      /* A run that was ended rather than one that ended leaves steps mid-flight.
         Only `finished` leaves them alone: a stop, a failure or an add-on that
         refused everything has steps that will never report, and the window
         reads a step still running as "this is still working" — which is how
         Stop left the composer showing Queue/Interrupt for the rest of the
         sitting. */
      const ended = event.how !== undefined && event.how !== 'finished';
      const stranded =
        ended ||
        turns.some(
          (turn) =>
            ((turn.kind === 'asked' || turn.kind === 'asked-first') && turn.answered === null) ||
            (turn.kind === 'holding' && turn.state === 'running') ||
            (turn.kind === 'said' && turn.from === 'graphe' && turn.streaming),
        );
      if (!stranded) return false;
      // Whatever was being asked, the turn it belonged to is over and nothing
      // it says can reach anything. A form still drawn reads as answerable and
      // comes back with the history.
      for (let index = 0; index < turns.length; index += 1) {
        const turn = turns[index];
        if (turn === undefined) continue;
        if (turn.kind === 'asked' && turn.answered === null) {
          turns[index] = { ...turn, answered: 'no' };
        } else if (turn.kind === 'asked-first' && turn.answered === null) {
          turns[index] = { ...turn, answered: 'withdrawn' };
        } else if (turn.kind === 'holding' && turn.state === 'running') {
          turns[index] = { ...turn, state: ended ? 'failed' : 'done' };
        } else if (turn.kind === 'said' && turn.from === 'graphe' && turn.streaming) {
          turns[index] = { ...turn, streaming: false };
        } else if (ended && turn.kind === 'did' && turn.state === 'running') {
          turns[index] = { ...turn, state: 'failed', detail: STEP_WAS_STOPPED };
        } else if (ended && turn.kind === 'tidying' && turn.state === 'running') {
          turns[index] = { ...turn, state: 'failed' };
        }
      }
      return true;
    }
  }
}

export function applyEvent(turns: readonly Turn[], event: AgentEvent): readonly Turn[] {
  const next = [...turns];
  return applyEventInto(next, event) ? next : turns;
}
