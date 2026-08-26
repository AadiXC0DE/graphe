/** The description a design lead can actually approve.
 *
 * Every request to merge somebody's work, everywhere, opens with a wall of diff
 * — the one artefact the person who designed the thing cannot read. Ours opens
 * with the pictures and the sentence we already wrote beside them, and the diff
 * stays where it belongs: one tab over, for whoever wants it.
 *
 * Pure. Same work in, same description out — no folder is read here and nothing
 * is spawned, so what gets sent can be tested character by character.
 */

import { evaluate } from '../agent/guard/policy';

/** Where the two pictures of one change can be reached from, once the work is
 *  somewhere a description can point at. Null when there is no picture. */
export type Pictures = { before: string | null; after: string | null };

/** One change, as the description tells it. */
export type Piece = {
  /** One line, past tense: "Made the header sticky". */
  title: string;
  /** The plain sentence beside the pictures. */
  says: string;
  /** Where on the page it landed, when the picture had something to add. */
  where: string | null;
  pictures: Pictures;
};

export type Handover = {
  project: string;
  /** What the whole piece of work is called. */
  title: string;
  pieces: readonly Piece[];
};

/** Every sentence this feature can put in front of somebody. One place, so it
 *  can be read whole and swept. */
export const handoverWords = {
  /** The control itself. */
  label: 'Open a pull request',
  hint: 'Branches off your work, pushes it, and opens a PR with the summary and the screenshots in the body.',
  /** Said before anything leaves. */
  aboutTo:
    'This is the only part of Graphe that pushes anything off this computer. Your commits, the screenshots and the description below go to the remote this project already has.',
  working: 'Pushing and opening the pull request…',
  sent: 'Pull request opened.',
  /** The push landed; the body did not. Said exactly, rather than as either
   *  "it worked" or "it did not". */
  sentWithoutWriteUp:
    'The branch is pushed and the pull request is open. I could not write the description into it, so that part is still only here.',
  nothingToHandOver:
    'Nothing to open a pull request with yet. Ask me for a change first.',
  couldNotSend: 'I could not push, so nothing has left this computer.',
  /** The picture problem, said honestly rather than shipped broken. Only said
   *  when there are pictures to say it about. */
  picturesTravel:
    'The pictures go along with the work, so they show up in the write-up rather than being links to somewhere they might not stay.',
} as const;

/** The plain sentence somebody gets instead of their key being sent anywhere. */
const REFUSAL =
  'One of your private keys is written into this. I have sent nothing, so it is still only on your computer. Take the key out and ask again.';

/* -------------------------------------------------------------------------- */
/* Naming the work                                                             */
/* -------------------------------------------------------------------------- */

import { CONVENTIONAL_TYPES, conventionalType } from '../lib/conventional';

/** Long enough to recognise, short enough to read in a list. */
const MOST = 48;

/** The names that mean "the project itself". Work never lands on one of these,
 *  and this list is why. */
const THE_PROJECT_ITSELF = new Set(['main', 'master', 'trunk', 'develop', 'default']);

const MARKS = /[\u0300-\u036f]/g;
/** Anything that would make a line of somebody's own words behave as markup. */
// eslint-disable-next-line no-control-regex -- control characters are exactly what this strips
const CONTROL = /[\u0000-\u001f\u007f]/g;

function slug(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(MARKS, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MOST)
    .replace(/-+$/g, '');
}

/** A short, sortable tail so two goes at the same change never land on one
 *  name. Base 36 of the moment, which is six characters and still increases. */
function tail(at: number): string {
  return Math.max(0, Math.floor(at / 1000)).toString(36);
}

/**
 * What to call this piece of work where the team will see it.
 *
 * Always prefixed and always suffixed, which is what makes the two promises
 * below cheap to keep: it can never be the name of the project itself, and it
 * can never be a name somebody else is already using.
 */
export function nameForWork(title: string, at: number): string {
  const type = conventionalType(title);
  const middle = slug(title);
  return `${type}/${middle === '' ? 'work' : middle}-${tail(at)}`;
}

/**
 * Is this a name we are allowed to write to?
 *
 * The one thing this feature must never do is touch what everybody else is
 * working from, so the check is a whitelist of shape rather than a blacklist of
 * names: ours starts with our prefix, and nothing that means "the project
 * itself" can wear that prefix.
 */
export function safeToWriteTo(name: string, theProjectItself: string | null): boolean {
  // Ours is always one known type, one slash, one slug — never a path, never a
  // walk upwards, never somebody else's name.
  const shape = /^([a-z]+)\/([a-z0-9][a-z0-9-]*)$/.exec(name);
  if (shape === null) return false;
  if (!(CONVENTIONAL_TYPES as readonly string[]).includes(shape[1] ?? '')) return false;
  const rest = shape[2] ?? '';
  if (rest.includes('..')) return false;
  if (THE_PROJECT_ITSELF.has(rest)) return false;
  if (theProjectItself !== null && name === theProjectItself) return false;
  return true;
}

/** Where a picture carried along with the work can be read from afterwards.
 *  Only ever built from parts we were handed, and only ever over a locked
 *  connection. */
export function whereAPictureLives(
  home: string,
  name: string,
  file: string,
): string | null {
  if (!/^[\w.-]+\/[\w.-]+$/.test(home)) return null;
  if (!safeToWriteTo(name, null)) return null;
  if (!/^[\w./-]+$/.test(file) || file.includes('..')) return null;
  return `https://raw.githubusercontent.com/${home}/${name}/${file}`;
}

/* -------------------------------------------------------------------------- */
/* The write-up                                                                */
/* -------------------------------------------------------------------------- */

/** One line of somebody's own words, safe to drop into a write-up: no line
 *  breaks to escape a list, no leading character that turns it into a heading. */
function plain(text: string): string {
  const one = text.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim();
  return one.replace(/^([#>*+-]|\d+\.)\s*/, '');
}

/** The same, for a cell in a two-column table where a bar would split it. */
function cell(text: string): string {
  return plain(text).replace(/\|/g, '\\|');
}

/** Titles that are the timeline talking about its own housekeeping rather than
 *  naming something somebody asked for. The timeline is a view in the window;
 *  none of its bookkeeping belongs in front of a reviewer. */
const HOUSEKEEPING =
  /^(merge\b|revert\b|bump\b|initial commit\b|wip\b|save point$|saved (what you had|before)\b|made a few changes$|a working version$|went back to\b)/i;

/**
 * Does this title say anything a reviewer needs?
 *
 * The write-up is built from titles that describe a change. Everything else the
 * timeline holds — the moments it saved on its own, the housekeeping that came
 * back from elsewhere — is for the window that shows the timeline, not for a
 * description somebody has to read before approving.
 */
export function worthTelling(title: string): boolean {
  const one = plain(title);
  return one !== '' && !HOUSEKEEPING.test(one);
}

const COUNTS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'] as const;

function counted(many: number): string {
  return COUNTS[many] ?? String(many);
}

function anyPicture(piece: Piece): boolean {
  return piece.pictures.before !== null || piece.pictures.after !== null;
}

function bothPictures(piece: Piece): boolean {
  return piece.pictures.before !== null && piece.pictures.after !== null;
}

/** The one-line answer before anybody scrolls. It promises pictures only when
 *  there are pictures, because the line right under it is the first thing a
 *  reader checks it against. */
export function opening(handover: Handover): string {
  const many = handover.pieces.length;
  if (many === 0) return 'Nothing changed.';

  const shown = handover.pieces.filter(anyPicture).length;
  const paired = handover.pieces.every(bothPictures);
  if (many === 1) {
    if (paired) return 'One change, with a picture of it before and after.';
    return shown === 1 ? 'One change, with a picture of it.' : 'One change.';
  }
  if (paired) return `${counted(many)} changes, each with a picture of it before and after.`;
  if (shown === 0) return `${counted(many)} changes.`;
  return `${counted(many)} changes, ${counted(shown).toLowerCase()} of them with pictures.`;
}

/** The title on the request itself. Never the timeline's own housekeeping —
 *  what the team sees at the top of the list has to name the work. */
export function titleOf(handover: Handover): string {
  const named = plain(handover.title);
  if (named === '' || !worthTelling(named)) return plain(handover.project) || 'Design changes';
  return named;
}

function shownPictures(pictures: Pictures, title: string): string {
  const before = pictures.before;
  const after = pictures.after;
  // Nothing at all rather than a line apologising for it: the opening line
  // already stopped promising a picture that was never taken.
  if (before === null && after === null) return '';
  if (before !== null && after !== null) {
    return [
      '| Before | After |',
      '| --- | --- |',
      `| <img src="${before}" alt="${cell(title)} (before)" width="420"> | <img src="${after}" alt="${cell(title)} (after)" width="420"> |`,
    ].join('\n');
  }
  const only = after ?? before;
  const label = after === null ? 'How it looked before' : 'How it looks now';
  return `<img src="${only ?? ''}" alt="${cell(title)}" width="420">\n\n_${label}._`;
}

/** The sentences a piece adds under its own heading, which may be none. A
 *  description that repeats the heading underneath it reads like a machine
 *  filling a template, so an empty sentence stays empty. */
function saidAbout(piece: Piece): string[] {
  const said: string[] = [];
  const says = plain(piece.says);
  if (says !== '' && says !== plain(piece.title)) said.push(says);
  if (piece.where !== null && piece.where.trim() !== '') said.push(plain(piece.where));
  return said;
}

/** A piece that is only a name. Worth listing; not worth a heading with nothing
 *  underneath it. */
function nameOnly(piece: Piece): boolean {
  return !anyPicture(piece) && saidAbout(piece).length === 0;
}

function sectionFor(piece: Piece): string {
  const lines = [`### ${plain(piece.title)}`];
  for (const said of saidAbout(piece)) lines.push('', said);
  const pictures = shownPictures(piece.pictures, piece.title);
  if (pictures !== '') lines.push('', pictures);
  return lines.join('\n');
}

/**
 * The whole write-up, as one piece of text.
 *
 * Deliberately has no list of files and no diff in it. Both are one tab away
 * for whoever wants them, and putting them here would bury the two things a
 * person approving this actually needs: what it looks like now, and why.
 */
export function describeForReview(handover: Handover): string {
  const blocks: string[] = [
    `## What changed in ${plain(handover.project) || 'this project'}`,
    opening(handover),
  ];

  // Changes we watched happen get their heading and their pictures. Changes we
  // only know the name of get one line each — a heading over an empty section
  // is a template announcing that it had nothing to fill itself with.
  const named = handover.pieces.filter(nameOnly);
  if (named.length > 0) blocks.push(named.map((one) => `- ${plain(one.title)}`).join('\n'));
  for (const piece of handover.pieces) {
    if (!nameOnly(piece)) blocks.push(sectionFor(piece));
  }

  blocks.push('---');
  if (handover.pieces.some(anyPicture)) blocks.push(`_${handoverWords.picturesTravel}_`);
  blocks.push('_Written by Graphe from the work itself, not from the changed lines._');
  return `${blocks.join('\n\n')}\n`;
}

/** Every word the description would put in front of a reader. Pictures are left
 *  out — they are bytes, and only text can carry a key. */
function everyWord(handover: Handover): string {
  const lines = [handover.project, handover.title];
  for (const piece of handover.pieces) lines.push(piece.title, piece.says, piece.where ?? '');
  return lines.join('\n');
}

/**
 * Is this safe to send anywhere?
 *
 * The judgement is the Guard's own — the same one that stops a page leaving
 * with a key in it — so there is one place that decides what a key looks like,
 * not three.
 */
export function safeToHandOver(handover: Handover): { ok: true } | { ok: false; because: string } {
  const verdict = evaluate(
    { id: 'handover', name: 'share', input: { text: everyWord(handover) } },
    { projectRoot: '' },
  );
  return verdict.kind === 'deny' ? { ok: false, because: REFUSAL } : { ok: true };
}
