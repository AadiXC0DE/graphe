/** Failures from underneath, said in words.
 *
 * The adapter promises never to show a stack trace, and it keeps that promise
 * for everything it raises itself. What it cannot do is rewrite what the engine
 * hands it: when Pi has no credentials it fails with
 *
 *     No API key found for the selected model.
 *     Use /login to log into a provider via OAuth or API key. See:
 *       /Users/…/node_modules/@earendil-works/pi-coding-agent/docs/providers.md
 *
 * and the adapter passes that through verbatim, because from where it stands the
 * text is already a sentence and rewriting other people's error messages is not
 * its job. It is ours. That paragraph names a package, a flag, a protocol and
 * two file paths, and it is the single most likely thing a first-time user will
 * ever see — most people opening this have not connected anything yet.
 *
 * So everything on its way to the window comes through here first. Recognised
 * failures get our words. Anything unrecognised is used as-is only if it already
 * reads like something a person wrote; otherwise it is replaced, and the raw
 * text goes to `details`, which lives behind "Show technical details" and is the
 * one place jargon is allowed.
 */

import type { Trouble } from '../src/lib/ipc';

type Known = {
  when: RegExp;
  what: string;
  because: string;
  /** What the window should do instead of showing the card. `'connect'` means
   *  "there is no account connected" — the single most likely first-run
   *  failure — and the window opens the connect screen rather than a card
   *  that dead-ends in "Got it". */
  marker?: 'connect';
};

/** Ordered: the first match wins, so the more specific patterns come first. */
const KNOWN: readonly Known[] = [
  {
    /* Ahead of the "no account" rule, because Pi's no-model message also
       carries the "/login" help paragraph — so that rule swallowed this one and
       told people to connect an account the connect screen showed as already
       connected. An account and a model are two different things to be missing. */
    when: /no model selected|no model (is )?(available|configured)|select a model/i,
    what: 'I do not know what to think with yet.',
    because:
      'An account is connected, but no model has been picked from it. Choose one and ask me again.',
    marker: 'connect',
  },
  {
    when: /no api key|api[_ -]?key|not logged in|unauthor|forbidden|\b401\b|\b403\b|\/login\b|credential|sign(ed)? in/i,
    what: 'I am not ready to work yet.',
    because:
      'No account has been connected on this computer, so there is nothing for me to think with. Connect one and ask me again.',
    marker: 'connect',
  },
  {
    when: /insufficient|out of credit|billing|payment|quota exceeded|balance/i,
    what: 'I have run out of what I need to keep going.',
    because:
      'The account this is connected to has nothing left to spend. Top it up and ask me again.',
  },
  {
    when: /rate limit|\b429\b|too many requests|overloaded|capacity/i,
    what: 'I have been asked to slow down.',
    because: 'Too much is being asked of the service I think with. Give it a minute and try again.',
  },
  {
    when: /enotfound|econnrefused|econnreset|etimedout|fetch failed|network|offline|dns|socket hang up|getaddrinfo/i,
    what: 'I could not get online.',
    because:
      'I could not reach the service I think with. Check this computer is connected and ask me again.',
  },
  {
    when: /\b5\d\d\b|internal server error|bad gateway|service unavailable/i,
    what: 'The service I think with is having trouble.',
    because: 'It is not something you did. Give it a minute and ask me again.',
  },
  {
    /* Ahead of the context rule: a provider refusing a picture often says
       "image ... not supported" alongside a size or token word, and the two
       read nothing alike to the person who just attached one. Most of these
       are caught before a turn is spent, from the model catalogue; this is for
       the models whose catalogue entry says nothing about pictures. */
    when: /(image|vision|multimodal)[^.]{0,40}(not supported|unsupported|not allowed|cannot|invalid)|(does not|doesn't) support (image|vision)|no support for image/i,
    what: 'This model cannot read pictures.',
    because:
      'The picture went with your message and the model turned it away. Take it out and ask again, or pick a model that reads pictures — the model is named beside the box.',
  },
  {
    when: /context (length|window)|too (long|large)|token limit|maximum context/i,
    what: 'This conversation has got too long for me to hold.',
    because: 'Start a new one and tell me where we had got to, and I will pick it up from there.',
  },
];

const NOTHING_TO_SAY = 'Something went wrong on my side, and I have stopped where I was.';
const GENERIC_WHAT = 'I stopped part way through.';

/** Things that give away a message written for a developer. Any one of them and
 *  the text does not go in front of anybody. */
const TELLS = [
  /\bat [\w.<>[\]]+ \(/, // a stack frame
  /(^|\s)\/[\w./-]{12,}/, // an absolute path
  /node_modules/,
  /\b[A-Z]{3,}_[A-Z_]{3,}\b/, // SCREAMING_CASE constants
  /\b(undefined|null) is not a|cannot read propert|TypeError|ReferenceError|SyntaxError/i,
  /\{|\}|=>|;\s*$/,
];

/** Would a person recognise this as something a person wrote? */
export function readsLikeAPerson(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === '' || trimmed.length > 220) return false;
  if (trimmed.split('\n').length > 2) return false;
  return !TELLS.some((tell) => tell.test(trimmed));
}

/** One sentence for the feed, when all we have room for is the sentence. */
export function plainMessage(raw: string): string {
  const known = KNOWN.find((entry) => entry.when.test(raw));
  if (known !== undefined) return known.because;
  return readsLikeAPerson(raw) ? raw.trim() : NOTHING_TO_SAY;
}

/**
 * A card, but only for a failure we recognise.
 *
 * Worth having separately from `plainTrouble` because some failures arrive
 * wrapped: the adapter catches whatever Pi threw and re-raises it as "I am not
 * set up to work yet", with the real reason on `cause`. The caller there has a
 * better default than we do, so it wants to know whether we recognised anything
 * rather than being handed a generic sentence it cannot tell apart from a real
 * match.
 */
export function knownTrouble(raw: string, details?: string): Trouble | null {
  const known = KNOWN.find((entry) => entry.when.test(raw));
  if (known === undefined) return null;
  const trouble: Trouble = {
    what: known.what,
    because: known.because,
    actionLabel: 'Got it',
    ...(known.marker === undefined ? {} : { marker: known.marker }),
  };
  return details === undefined || details.trim() === '' ? trouble : { ...trouble, details };
}

/** The whole card, raw text tucked out of sight. */
export function plainTrouble(raw: string, details?: string): Trouble {
  const known = KNOWN.find((entry) => entry.when.test(raw));
  const trouble: Trouble = {
    what: known?.what ?? GENERIC_WHAT,
    because: known?.because ?? (readsLikeAPerson(raw) ? raw.trim() : NOTHING_TO_SAY),
    actionLabel: 'Got it',
    ...(known?.marker === undefined ? {} : { marker: known.marker }),
  };
  const beneath = details ?? raw;
  return beneath.trim() === '' ? trouble : { ...trouble, details: beneath };
}
