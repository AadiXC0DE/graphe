/** The runs that were still going when the app stopped.
 *
 * A run cut off in the middle is not a run that finished, and the one thing a
 * launch must not do is report the difference as nothing. So the durable facts
 * of a run are written down as they change and taken away when it ends, which
 * leaves the file holding exactly the runs a restart has to answer for. Reading
 * it is the whole of "what was interrupted"; nothing here starts anything again,
 * because the turn somebody was paying for is over and reissuing it would spend
 * their money on work nobody is waiting for any more.
 *
 * The record is the same `DurableFacts` the session service holds, plus the
 * project it was working in, so a launch reads back the facts rather than a
 * second, thinner account of them.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  inFlight,
  SESSION_STATES,
  type DurableFacts,
  type SessionState,
} from '../../src/domain/conversations';
import { runOwner } from '../../src/domain/events';
import { asConversationId, asRunId, asRuntimeEpoch, asWorkspaceId } from '../../src/domain/identity';
import { writeAtomically } from '../../src/lib/atomic';
import { agoInSentence } from '../../src/lib/when';

/** One run, as the launch after it reads it back. */
export type RunNote = DurableFacts & { readonly project: string };

/** Under the profile, beside the transcripts and the preferences. */
export function runNotesFile(userData: string): string {
  return join(userData, 'runs-in-flight.json');
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value !== '' ? value : null;
}

function noteOf(value: unknown): RunNote | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const conversation = text(row['conversationId']);
  const project = text(row['project']);
  const status = row['status'];
  const writtenAt = row['writtenAt'];
  if (conversation === null || project === null) return null;
  if (typeof status !== 'string' || !SESSION_STATES.includes(status as SessionState)) return null;
  if (typeof writtenAt !== 'number' || !Number.isFinite(writtenAt)) return null;
  const workspaceId = text(row['workspaceId']);
  const ownerId = text(row['ownerId']);
  const runtimeEpoch = row['runtimeEpoch'];
  return {
    conversationId: asConversationId(conversation),
    workspaceId: workspaceId === null ? null : asWorkspaceId(workspaceId),
    status: status as SessionState,
    // A run note is only ever a run's, so the id read back is read as one.
    ownerId: ownerId === null ? null : runOwner(asRunId(ownerId)),
    runtimeEpoch: typeof runtimeEpoch === 'number' ? asRuntimeEpoch(runtimeEpoch) : null,
    writtenAt,
    project,
  };
}

/** Every run that was still going when the app last stopped. A file that will
 *  not parse is no runs rather than a launch that throws: the worst this can
 *  cost is one sentence nobody is told. */
export function readRunNotes(userData: string): readonly RunNote[] {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(runNotesFile(userData), 'utf8')) as unknown;
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const found: RunNote[] = [];
  for (const one of raw) {
    const note = noteOf(one);
    if (note !== null) found.push(note);
  }
  return found;
}

/* Writes are chained rather than run side by side. Two notes for one
   conversation arrive in the same breath — a run starting, then the next one
   starting — and each reads the file before it writes it, so a removal landing
   between them would put back the run that had already ended. The chain never
   rejects: a profile that will not take a note is a note nobody is told about,
   not a run that stops because of it. */
let writing: Promise<void> = Promise.resolve();

/**
 * Write one conversation's note down, or take it away.
 *
 * A state that is not in flight is a removal: a clean stop, a failure and a
 * finished turn all leave nothing behind, and the next launch has nothing to
 * say about them.
 *
 * Returns when the file has been written, for a caller that needs to know — a
 * test, or the end of a launch. Nothing has to wait on it.
 */
export function wroteRunNote(
  userData: string,
  facts: DurableFacts,
  project: string,
): Promise<void> {
  const conversation = facts.conversationId;
  const keep: RunNote | null = inFlight(facts.status) ? { ...facts, project } : null;
  writing = writing
    .then(async () => {
      const others = readRunNotes(userData).filter((one) => one.conversationId !== conversation);
      const all = keep === null ? others : [...others, keep];
      await writeAtomically(runNotesFile(userData), `${JSON.stringify(all, null, 2)}\n`);
    })
    .catch(() => undefined);
  return writing;
}

/** Take one conversation's note away, because nothing of its is in flight any
 *  more. Used where a launch has answered the note it found. */
export function tookRunNoteAway(userData: string, conversation: string): Promise<void> {
  writing = writing
    .then(async () => {
      const others = readRunNotes(userData).filter((one) => one.conversationId !== conversation);
      await writeAtomically(runNotesFile(userData), `${JSON.stringify(others, null, 2)}\n`);
    })
    .catch(() => undefined);
  return writing;
}

/**
 * What is said about a run the app did not finish.
 *
 * It says what happened and what to do instead of what it cannot do: nothing
 * was picked up, the words it never finished are gone, and the next move is
 * somebody saying what they want now.
 */
export function interruptedWords(note: RunNote, at = Date.now()): string {
  return `This conversation was in the middle of a run when Graphe stopped, ${agoInSentence(note.writtenAt, at)}. Nothing was picked up where it left off, and nothing is running now: say what you want next.`;
}
