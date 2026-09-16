/** A saved conversation, read back as the events the window draws — and as the
 *  moments it can be taken back to.
 *
 * Pi's session entries translated into the same AgentEvents the live stream
 * uses, so the window can fold them through `applyEvent`. Same rules as
 * `events.ts`: no Pi imports, defensive field reads only.
 *
 * A record comes back as whole as the transcript allows. A step keeps what it
 * printed, the picture it took and a named reference to everything a line has
 * no room for; a call whose result never came is `interrupted` rather than
 * failed or still running; where the conversation was tidied, and the branch it
 * came back from, are said where they happened; and a message an add-on put in
 * the record keeps the extension that wrote it and whether it asked to be seen.
 *
 * One live-only moment is still dropped: an `error` on the assistant's own
 * message, which would replay as a dismissable trouble card for a failure
 * nobody can do anything about now.
 *
 * Graphe's own words are taken back off the messages it sent on somebody's
 * behalf — the end-of-sitting prompt, the notes it pins above a first question,
 * and every round it sends to carry a checklist or a goal on. They went out as
 * ordinary user messages and are on disk as such, so without this a reopened
 * conversation shows the app talking to itself as though a person had typed it.
 * An add-on's turn is marked by Pi itself and is left out the same way.
 *
 * Known loss: a call the Guard blocked was written down as an ordinary failed
 * result carrying the sentence the model was told, so it comes back as a step
 * that failed rather than one somebody said no to. Telling those apart needs
 * the refusal marked where it is written, which is the adapter's to do.
 */

import type { AgentEvent, ImageCard, KeptThing, StepEnding, ToolCall } from '../types';
import { sentOnTheirBehalf } from '../../work/continuation';

type Fields = Readonly<Record<string, unknown>>;

function fieldsOf(value: unknown): Fields | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  return value as Fields;
}

function textAt(source: Fields, key: string): string | null {
  const value = source[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function flagAt(source: Fields, key: string): boolean | null {
  const value = source[key];
  return typeof value === 'boolean' ? value : null;
}

function nestedAt(source: Fields, key: string): Fields | null {
  return fieldsOf(source[key]);
}

function momentAt(source: Fields): number | null {
  const value = source['timestamp'];
  if (typeof value !== 'string') return null;
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

/** When an entry was written, off an entry nobody has checked yet. Null means
 *  the record says nothing about when, which is a missing duration rather than
 *  a duration of zero. */
function stampOf(entry: unknown): number | null {
  const source = fieldsOf(entry);
  return source === null ? null : momentAt(source);
}

/* -------------------------------------------------------------------------- */
/* What a result or a message holds                                            */
/* -------------------------------------------------------------------------- */

/** How much of what a step printed a line in the feed carries. A line is read,
 *  not scrolled: the whole of it stays in the record, and the step names where. */
const MOST_SHOWN = 2_000;

/** Pi's own sentence for a call the abort landed on — `createErrorToolResult`
 *  writes exactly this into the transcript. A wording change upstream degrades
 *  to a plain failure, never to a false success. */
const ABORTED = 'Operation aborted';

/** Said where a conversation comes back from a branch it left. */
const BRANCH_CAME_BACK = 'This conversation came back from another branch.';

/**
 * What an add-on's notice is written down as, in Pi's own record.
 *
 * A notice used to live only as long as the window that drew it: one arriving
 * while nobody was looking, or while a conversation was closed, was simply
 * gone. Pi has an entry that is kept in the transcript and never reaches the
 * model — its `custom` entry, which is where extensions are meant to keep state
 * — so the words go there, whole, and come back as the line they were.
 *
 * The name is in the words rather than in a field, exactly as it is live: Pi's
 * `notify` carries no origin, and the host folds in whichever add-on the call
 * stack named before the sentence reaches anybody.
 */
export const NOTICE_ENTRY = 'graphe-addon-notice';

/** Where the whole of something sits in the record: the entry it was written
 *  in, or whatever names it when the entry has no id of its own. */
function whereOf(entry: Fields | null, whenNoId: string): string {
  const id = entry === null ? null : textAt(entry, 'id');
  return id === null ? whenNoId : `entry:${id}`;
}

/** Everything a result or a message carries: its words, the one picture a line
 *  draws, and a named reference for each thing a line cannot.
 *
 * Pi's own content is text and pictures. A tool an add-on registered hands
 * files back by reference, and a newer Pi may carry a kind this one has never
 * heard of — all of it is named rather than dropped into nothing. */
type Content = { words: string; shown: ImageCard | null; kept: KeptThing[] };

function readContent(content: unknown, where: string): Content {
  const read: Content = { words: '', shown: null, kept: [] };
  const blocks =
    Array.isArray(content) ? content : content === null || content === undefined ? [] : [content];
  let pictures = 0;
  for (const block of blocks) {
    if (typeof block === 'string') {
      read.words = read.words === '' ? block : `${read.words}\n${block}`;
      continue;
    }
    const source = fieldsOf(block);
    if (source === null) continue;
    const kind = textAt(source, 'type');
    if (kind === null || kind === 'text') {
      const text = textAt(source, 'text');
      if (text !== null) read.words = read.words === '' ? text : `${read.words}\n${text}`;
      continue;
    }
    if (kind === 'image') {
      pictures += 1;
      const bytes = textAt(source, 'data');
      if (bytes !== null) {
        read.shown = { bytes, mimeType: textAt(source, 'mimeType') ?? 'image/png' };
      }
      continue;
    }
    const kept = referenceIn(source, kind, where);
    if (kept !== null) read.kept.push(kept);
  }
  // Only the last picture is drawn, the same as the live feed: a step that took
  // several is showing where it ended up. The others are named rather than gone.
  if (pictures > 1) {
    const more = pictures - 1;
    read.kept.unshift({
      what: `${String(more)} more picture${more === 1 ? '' : 's'} it took`,
      where,
    });
  }
  return read;
}

/** A reference to what a line cannot draw. A file handed back keeps its own
 *  uri, which is where the whole of it lives; anything else is named by the
 *  entry it sits in. */
function referenceIn(block: Fields, kind: string, where: string): KeptThing | null {
  const inner = nestedAt(block, 'resource') ?? block;
  const uri = textAt(inner, 'uri');
  if (uri === null) {
    const named = kind.length > 40 ? kind.slice(0, 40) : kind;
    return { what: `content this app does not draw (${named})`, where };
  }
  const name = textAt(inner, 'name');
  const mimeType = textAt(inner, 'mimeType');
  const what =
    name !== null
      ? `a file it handed back: ${name.length > 60 ? name.slice(0, 60) : name}`
      : mimeType === null
        ? 'a file it handed back'
        : `a file it handed back (${mimeType})`;
  return { what, where: uri };
}

/** A line a step wants under itself in the feed. The live stream reads it off
 *  the `tool_execution_end` event; in the record it is written on the result. */
function noteOf(message: Fields): string | null {
  const details = nestedAt(message, 'details');
  const note = details === null ? null : textAt(details, 'note');
  return note === null || note.trim() === '' ? null : note.trim();
}

/** One tool result, read into the step it closes: what the result says, the
 *  picture it took, how it ended, and everything a line has no room for.
 *
 *  A step somebody stopped is written down as an ordinary failed result whose
 *  sentence is Pi's own for an abort, and that sentence is the only thing that
 *  tells it apart from a tool that broke. */
function stepOf(entry: Fields, message: Fields, id: string): AgentEvent {
  const where = whereOf(entry, `call:${id}`);
  const content = readContent(message['content'], where);
  const failed = flagAt(message, 'isError') === true;
  const stopped = failed && content.words.trim() === ABORTED;
  const note = failed ? null : noteOf(message);
  const printed = stopped ? '' : content.words;
  const shown = printed.length > MOST_SHOWN ? printed.slice(0, MOST_SHOWN) : printed;
  if (printed.length > MOST_SHOWN) {
    content.kept.unshift({
      what: `the rest of what it printed (${String(printed.length - MOST_SHOWN)} more characters)`,
      where,
    });
  }
  if (note !== null && printed !== '') {
    content.kept.unshift({ what: `what it printed (${String(printed.length)} characters)`, where });
  }
  // A picture on a failed result is not drawn — the live feed does not draw one
  // either — so it is named here rather than lost with the failure.
  if (failed && content.shown !== null) {
    content.kept.unshift({ what: 'a picture it took', where });
  }
  const detail = note ?? (shown !== '' ? shown : content.kept.map((one) => one.what).join(', '));
  return {
    type: 'tool-end',
    id,
    ok: !failed,
    ...(detail === '' ? {} : { detail }),
    ...(failed || content.shown === null ? {} : { shown: content.shown }),
    ...(failed ? { ending: stopped ? ('stopped' as const) : ('failed' as const) } : {}),
    ...(content.kept.length === 0 ? {} : { kept: content.kept }),
  };
}

/** A message an add-on put in the record, or nothing when it asked to be
 *  invisible — that is what `display` is for, and an extension that hides a
 *  message has a reason. The words are neither the person's nor ours, so the
 *  extension that wrote them travels with them. */
function saidByAddon(
  from: string,
  entry: Fields | null,
  content: unknown,
  display: boolean | null,
): AgentEvent[] {
  if (display === false) return [];
  const read = readContent(content, whereOf(entry, `add-on:${from}`));
  const text = read.words.trim();
  if (text === '' && read.shown === null && read.kept.length === 0) return [];
  return [
    {
      type: 'extension-said',
      from,
      text,
      ...(read.shown === null ? {} : { shown: read.shown }),
      ...(read.kept.length === 0 ? {} : { kept: read.kept }),
    },
  ];
}


/**
 * The prompt sent when a sitting ends, asking for anything worth keeping.
 *
 * Named things rather than impressions: a note saying the work went well helps
 * nobody next time, and a memory full of them is worse than an empty one.
 *
 * It lives beside the replay rather than beside the send, because the two have
 * to agree on it word for word or it comes back as a message somebody read.
 */
export const WORTH_KEEPING = `This sitting is over and nobody is reading this reply, so keep it to the notes.

Look back over what we just did. If you learned anything about this project that would save time next time (how it is built, how it is run, what it expects, a decision and why it went that way, something that caught you out), write each one down with retain, one fact per note, in a sentence that will still make sense months from now.

Write nothing about how this sitting went, nothing you already have a note for, and nothing that reading the code would tell you just as fast. Most sittings are worth one or two notes and many are worth none, which is a fine answer. Say nothing else.`;

/** The line above the notes carried into the first question of a sitting. */
export const NOTES_CARRIED = 'A few notes I keep about this project, most relevant first:';

/**
 * What the person actually typed, out of the message that was sent for them.
 *
 * Three things are Graphe's: the whole end-of-sitting prompt, which nobody
 * wrote and nobody read the reply to; the notes pinned above the first
 * question, which are the app remembering rather than the person speaking; and
 * the rounds the app sends to carry a checklist, a goal or a board piece on,
 * which are the loop talking to itself.
 */
function whatTheyTyped(text: string): string | null {
  const said = text.trim();
  if (said === '' || said === WORTH_KEEPING) return null;
  if (sentOnTheirBehalf(said)) return null;
  if (!said.startsWith(NOTES_CARRIED)) return said;
  const after = said.indexOf('\n\n');
  const typed = after === -1 ? '' : said.slice(after + 2).trim();
  return typed === '' ? null : typed;
}

/** The words of a user message, whether it was stored as one string or as
 *  blocks. A message that is pictures only carries nothing this replay draws —
 *  a person's own pictures come back with the composer that staged them, not
 *  here — so the words are all it has, and a message without them says nothing. */
function userWords(message: Fields): string | null {
  const content = message['content'];
  if (typeof content === 'string') return whatTheyTyped(content);
  const list = Array.isArray(content) ? content : null;
  if (list === null) return null;
  let words = '';
  for (const block of list) {
    const source = fieldsOf(block);
    if (source === null) continue;
    if (textAt(source, 'type') !== 'text') continue;
    const text = textAt(source, 'text');
    if (text !== null) words += words === '' ? text : `\n\n${text}`;
  }
  return words === '' ? null : whatTheyTyped(words);
}

function callOf(block: Fields): ToolCall | null {
  const id = textAt(block, 'id');
  const name = textAt(block, 'name');
  if (id === null || name === null) return null;
  const arguments_ = fieldsOf(block['arguments']);
  return { id, name, input: arguments_ === null ? {} : arguments_ };
}

/** One assistant message, in the order its blocks were written — the order the
 *  live feed had them, so the replayed conversation reads the same way. A call
 *  the Guard never let run is still in the transcript as a call that happened;
 *  Pi recorded the result it was refused, and the replay shows that too. */
function assistantEvents(message: Fields): AgentEvent[] {
  const blocks = message['content'];
  if (!Array.isArray(blocks)) return [];
  const events: AgentEvent[] = [];
  let spoke = false;
  for (const block of blocks) {
    const source = fieldsOf(block);
    if (source === null) continue;
    const kind = textAt(source, 'type');
    if (kind === 'text') {
      const text = textAt(source, 'text');
      if (text === null) continue;
      events.push({ type: 'message-delta', text });
      spoke = true;
    } else if (kind === 'toolCall') {
      const call = callOf(source);
      if (call !== null) events.push({ type: 'tool-start', call });
    }
  }
  if (spoke) events.push({ type: 'message-end' });
  // `errorMessage` is dropped on purpose — see the top of the file.
  return events;
}

/** One session entry, read into the events it stands for. */
function eventsOf(entry: unknown): AgentEvent[] {
  const source = fieldsOf(entry);
  if (source === null) return [];
  const kind = textAt(source, 'type');
  if (kind === 'message') {
    const message = nestedAt(source, 'message');
    if (message === null) return [];
    const role = textAt(message, 'role');
    if (role === 'custom') {
      // A message an add-on put in the record, in the runtime shape Pi hands
      // the model. It is not the person's, so it must not come back as theirs.
      const from = textAt(message, 'customType');
      if (from === null) return [];
      return saidByAddon(from, source, message['content'], flagAt(message, 'display'));
    }
    if (role === 'user') {
      // A user-shaped message with an add-on's name on it is the add-on's own
      // turn: the app answers those for the add-on, so its words are already in
      // the record as the prompt that went out. Drawn here as well they would
      // be the same sentence twice.
      if (textAt(message, 'customType') !== null) return [];
      const words = userWords(message);
      return words === null ? [] : [{ type: 'user-said', text: words }];
    }
    if (role === 'assistant') return assistantEvents(message);
    if (role === 'toolResult') {
      const id = textAt(message, 'toolCallId');
      if (id === null) return [];
      return [stepOf(source, message, id)];
    }
    return [];
  }
  // Where the conversation was tidied, said where it happened: the same pair
  // the live feed drew at the time, and the summary itself is Pi's, for Pi.
  if (kind === 'compaction') return [{ type: 'tidying' }, { type: 'tidied', ok: true }];
  // A branch a conversation came back from. Its summary is words somebody may
  // want to read, so it comes back with them rather than as a marker alone.
  if (kind === 'branch_summary') {
    const summary = textAt(source, 'summary');
    return [
      {
        type: 'notice',
        what: BRANCH_CAME_BACK,
        ...(summary === null ? {} : { because: summary }),
      },
    ];
  }
  // A message an add-on stored in the record, with the extension that wrote it
  // and whether it asked to be shown: Pi's own `custom_message` entry.
  if (kind === 'custom_message') {
    const from = textAt(source, 'customType');
    if (from === null) return [];
    return saidByAddon(from, source, source['content'], flagAt(source, 'display'));
  }
  /* An add-on's notice, written down when it was said. It comes back as the
     same line the window drew at the time rather than as the add-on's own
     message: a notice is the app speaking for somebody who is not here, and
     replaying it as a turn of theirs would put words in their mouth that they
     never sent to the model. Pi's `custom` entry is deliberately outside what
     the model reads, which is what makes it the right place for this. */
  if (kind === 'custom' && textAt(source, 'customType') === NOTICE_ENTRY) {
    const held = nestedAt(source, 'data');
    if (held === null) return [];
    const what = textAt(held, 'what');
    if (what === null) return [];
    const because = textAt(held, 'because');
    return [{ type: 'notice', what, ...(because === null ? {} : { because }) }];
  }
  // The rest — headers, model and thinking level changes, labels — the window
  // never draws.
  return [];
}

/** How the message that asked for these calls ended, when it says. Pi writes
 *  `aborted` when somebody stopped it and `error` when the model failed. */
function howItEnded(message: Fields): StepEnding | null {
  const how = textAt(message, 'stopReason');
  if (how === 'aborted') return 'stopped';
  if (how === 'error' || textAt(message, 'errorMessage') !== null) return 'failed';
  return null;
}

/** What the assistant message in this entry said about how its turn ended. */
function askedIn(entry: unknown): StepEnding | null {
  const source = fieldsOf(entry);
  if (source === null || textAt(source, 'type') !== 'message') return null;
  const message = nestedAt(source, 'message');
  if (message === null || textAt(message, 'role') !== 'assistant') return null;
  return howItEnded(message);
}

/** Translate a saved conversation into the events that would have made it.
 *  Unrecognised entries are skipped rather than allowed to derail it.
 *
 *  Every step is closed before the replay ends: a call written down with no
 *  result would leave `applyEvent` stuck in `running`, and the conversation
 *  would come back on a spinner that never stops. A call whose result never
 *  came is `interrupted` rather than failed — unless the message that asked for
 *  it says somebody stopped it, or that the model failed outright.
 *
 *  How long each step took is the distance between the two entries that carry
 *  it — the message that asked for the call and the message holding its result.
 *  Pi writes a timestamp on every entry and a duration on none, so this is the
 *  record's own account of it rather than a clock reading taken here. */
export function eventsFromEntries(entries: readonly unknown[]): readonly AgentEvent[] {
  const events: AgentEvent[] = [];
  const open = new Map<string, { ending: StepEnding; at: number | null }>();
  for (const entry of entries) {
    const asked = askedIn(entry);
    const when = stampOf(entry);
    for (const event of eventsOf(entry)) {
      if (event.type === 'tool-start') {
        open.set(event.call.id, { ending: asked ?? 'interrupted', at: when });
        events.push(event);
        continue;
      }
      if (event.type === 'tool-end') {
        const began = open.get(event.id)?.at ?? null;
        open.delete(event.id);
        events.push(
          began === null || when === null
            ? event
            : { ...event, ms: Math.max(0, when - began) },
        );
        continue;
      }
      events.push(event);
    }
  }
  for (const [id, { ending }] of open) events.push({ type: 'tool-end', id, ok: false, ending });
  return events;
}

/** One thing the person said, and so one place the conversation can be taken
 *  back to. `at` is null when the record does not say when it happened, which is
 *  a missing caption rather than a reason to lose the moment. */
export type Moment = {
  id: string;
  said: string;
  at: number | null;
  mark: string | null;
};

/** One entry, when it is something the person said: its own id, and the words
 *  they typed. Null for anything else — a message that was pictures only counts
 *  as nothing said, for the same reason it is left out of a replay. */
function saidIn(entry: unknown): { id: string; said: string; at: number | null } | null {
  const source = fieldsOf(entry);
  if (source === null || textAt(source, 'type') !== 'message') return null;
  const id = textAt(source, 'id');
  const message = nestedAt(source, 'message');
  if (id === null || message === null || textAt(message, 'role') !== 'user') return null;
  // A user-shaped message with an add-on's name on it is the add-on's turn.
  if (textAt(message, 'customType') !== null) return null;
  const said = userWords(message);
  return said === null ? null : { id, said, at: momentAt(source) };
}

/** The things the person said, oldest first. `markOf` supplies whatever was
 *  written against a moment. */
export function momentsFromEntries(
  entries: readonly unknown[],
  markOf: (id: string) => string | null = () => null,
): readonly Moment[] {
  const moments: Moment[] = [];
  for (const entry of entries) {
    const here = saidIn(entry);
    if (here === null) continue;
    moments.push({ ...here, mark: markOf(here.id) });
  }
  return moments;
}

/**
 * Where to cut a copy of a conversation so that it holds as it stood just after
 * the nth thing the person said: that message, the answer to it, and nothing
 * after them.
 *
 * Answered as the id of the entry to stop at, which is what Pi's own way of
 * writing a copy of a path wants. Null when there is nowhere to cut — fewer
 * things were said than that, or the one named came first.
 */
export function cutAfter(entries: readonly unknown[], said: number): string | null {
  if (!Number.isInteger(said) || said < 1) return null;
  let seen = 0;
  let previous: string | null = null;
  for (const entry of entries) {
    if (saidIn(entry) !== null) {
      seen += 1;
      // Returning before this entry is passed over, so the copy stops one
      // entry short of the next question rather than including it.
      if (seen === said + 1) return previous;
    }
    const source = fieldsOf(entry);
    const id = source === null ? null : textAt(source, 'id');
    if (id !== null) previous = id;
  }
  // Nothing was said after it, so the copy is the conversation entire.
  return seen === said ? previous : null;
}

/** Which moment a request refers to, checked against the conversation as it
 *  stands. Anything else — a stale id, a moment from a direction already left
 *  behind — is nowhere to go back to, and is answered here rather than by
 *  letting the machinery underneath throw. */
export function momentToReturnTo(moments: readonly Moment[], id: unknown): Moment | null {
  if (typeof id !== 'string' || id === '') return null;
  return moments.find((moment) => moment.id === id) ?? null;
}
