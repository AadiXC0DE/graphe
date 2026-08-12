/** Saying it out loud, and what happens to the words afterwards.
 *
 * Designers describe a visual change far better out loud than in writing — "no,
 * warmer, and give the whole thing more air" is one breath and four minutes of
 * typing. Everything here is the deciding half of that: whether this computer
 * can listen at all, how what it hears folds into a sentence somebody has
 * already half-written, and what it says when it cannot. No DOM, so all of it
 * can be read on its own.
 *
 * The listening itself is the browser's, done on the machine in front of the
 * person. Nothing here reaches anywhere of ours, and nothing is ever sent on
 * somebody's behalf: heard words land in the box as ordinary editable text and
 * wait to be read.
 */

/* -------------------------------------------------------------------------- */
/* Whether this computer can listen                                            */
/* -------------------------------------------------------------------------- */

/** The shape of the listener the browser hands back. Ours, deliberately: the
 *  DOM's own names for this move between versions, and none of the rest of the
 *  app should learn them. */
export type Listening = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: Said) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

/** What comes back each time more has been made out. Array-like, both levels. */
export type Said = {
  results: ArrayLike<ArrayLike<{ transcript?: string }> & { isFinal?: boolean }>;
};

export type Ears = new () => Listening;

/**
 * The listener this computer has, or nothing.
 *
 * Honest on purpose: where there is nothing here, the control does not appear.
 * A button that is visible and does nothing is worse than no button, because
 * the second one is a limit and the first one is a broken promise.
 *
 * Takes whatever the browser calls a window, under either of the two names this
 * has ever been kept under.
 */
export function earsIn(scope: unknown): Ears | null {
  if (scope === null || typeof scope !== 'object') return null;
  const holder = scope as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown };
  const found = holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
  return typeof found === 'function' ? (found as Ears) : null;
}

export function canSay(scope: unknown): boolean {
  return earsIn(scope) !== null;
}

/* -------------------------------------------------------------------------- */
/* What was heard                                                              */
/* -------------------------------------------------------------------------- */

export type Heard = { transcript: string; final: boolean };

/** The pieces of one event, settled and still-changing kept apart. */
export function readSaid(event: Said | null | undefined): readonly Heard[] {
  const results = event?.results;
  const length = typeof results?.length === 'number' ? results.length : 0;
  const heard: Heard[] = [];
  for (let i = 0; i < length; i += 1) {
    const one = results?.[i];
    const transcript = one?.[0]?.transcript;
    heard.push({
      transcript: typeof transcript === 'string' ? transcript : '',
      final: one?.isFinal === true,
    });
  }
  return heard;
}

/** One string out of the pieces: what is settled, then what is still being
 *  worked out. Both go in the box — waiting for a sentence to settle before
 *  showing any of it looks like nothing is happening. */
export function gather(heard: readonly Heard[] | null | undefined): string {
  if (!Array.isArray(heard)) return '';
  const settled: string[] = [];
  const saying: string[] = [];
  for (const one of heard) {
    if (one === null || typeof one !== 'object') continue;
    const words = typeof one.transcript === 'string' ? one.transcript : '';
    if (words.trim() === '') continue;
    (one.final === true ? settled : saying).push(words);
  }
  return tidy([...settled, ...saying].join(' '));
}

function tidy(words: string): string {
  return words.replace(/\s+/g, ' ').trim();
}

/* -------------------------------------------------------------------------- */
/* Where the words go                                                          */
/* -------------------------------------------------------------------------- */

/** The sentence as it stands, split at the cursor. Held from the moment
 *  listening starts, so that what is heard keeps landing in the same place
 *  rather than crawling along behind itself. */
export type Around = { before: string; after: string };

export function around(text: string, start?: number, end?: number): Around {
  const whole = typeof text === 'string' ? text : '';
  const from = clamp(start, whole.length);
  const to = Math.max(from, clamp(end ?? start, whole.length));
  return { before: whole.slice(0, from), after: whole.slice(to) };
}

function clamp(at: number | undefined, length: number): number {
  if (typeof at !== 'number' || !Number.isFinite(at)) return length;
  return Math.min(Math.max(0, Math.floor(at)), length);
}

const ENDS_A_SENTENCE = /[.!?]["')\]]?\s*$/;
const NEEDS_NO_SPACE = /^[\s.,;:!?)\]]/;

/**
 * The heard words, put into a sentence somebody is in the middle of.
 *
 * Two small courtesies, both of them the difference between dictation and
 * transcript: a space appears where a person would have typed one, and the
 * first word is capitalised when it is starting a sentence rather than
 * continuing one. The cursor comes back with the text, sitting after what was
 * just said, so typing carries straight on from it.
 */
export function fold(place: Around, heard: string): { text: string; caret: number } {
  const before = typeof place?.before === 'string' ? place.before : '';
  const after = typeof place?.after === 'string' ? place.after : '';
  const words = tidy(typeof heard === 'string' ? heard : '');

  if (words === '') return { text: before + after, caret: before.length };

  const opening = before.trim() === '' || ENDS_A_SENTENCE.test(before);
  const said = opening ? words.charAt(0).toUpperCase() + words.slice(1) : words;
  const lead = before !== '' && !/\s$/.test(before) ? ' ' : '';
  const tail = after !== '' && !NEEDS_NO_SPACE.test(after) ? ' ' : '';
  const caret = before.length + lead.length + said.length;

  return { text: before + lead + said + tail + after, caret };
}

/* -------------------------------------------------------------------------- */
/* The words it says                                                           */
/* -------------------------------------------------------------------------- */

export const SAYING = {
  start: 'Say it out loud',
  stop: 'Stop listening',
  /** Beside the box, for as long as it is on. */
  listening: 'Listening — the words appear as you go',
  silence: 'I did not catch anything. A little closer to the microphone usually does it.',
  refused:
    'I am not allowed to listen yet. Letting Graphe use the microphone in your computer settings will fix that.',
  noEars: 'I could not find a microphone to listen with.',
  trouble: 'Listening is not working on this computer. Typing it will get there just the same.',
} as const;

/** What to say when listening stops badly, and whether the control has any
 *  business still being on screen afterwards. Something that will not work
 *  again this run is taken away rather than left to fail twice. */
export function wordsFor(error: string | null | undefined): {
  because: string | null;
  keepOffering: boolean;
} {
  switch (error) {
    // We stopped it ourselves. Nothing happened worth a sentence.
    case 'aborted':
      return { because: null, keepOffering: true };
    case 'no-speech':
      return { because: SAYING.silence, keepOffering: true };
    case 'not-allowed':
      return { because: SAYING.refused, keepOffering: true };
    case 'audio-capture':
      return { because: SAYING.noEars, keepOffering: true };
    case 'network':
    case 'service-not-allowed':
      return { because: SAYING.trouble, keepOffering: false };
    default:
      return { because: SAYING.trouble, keepOffering: true };
  }
}
