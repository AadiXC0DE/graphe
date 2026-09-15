/** Where each conversation's runtime is, and what a restart makes of it.
 *
 * The claim the phase rests on is that these are one fact rather than two
 * opinions: the state the shell drives and the note left on disk are read
 * through the same table, so a conversation cannot be reported as running by
 * one caller and idle by another, and a process that died stops being reported
 * as still working.
 *
 * Nothing here starts a runtime. What is asserted is the vocabulary moving, the
 * note that survives, and that a note is answered by being read rather than by
 * being started again.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  inFlight,
  movedByWork,
  reportedState,
  Sessions,
  type DurableFacts,
} from '../src/domain/conversations';
import { runOwner } from '../src/domain/events';
import { asConversationId, newConversationId, newRunId } from '../src/domain/identity';
import {
  interruptedWords,
  readRunNotes,
  runNotesFile,
  tookRunNoteAway,
  wroteRunNote,
} from '../electron/services/run-record';

const made: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-runs-'));
  made.push(dir);
  return dir;
}

afterAll(async () => {
  for (const dir of made) await rm(dir, { recursive: true, force: true });
});

const AT = 1_700_000_000_000;

describe('the state of a conversation, driven', () => {
  it('moves through the states the shell moves it through, and is read back', () => {
    const states = new Sessions();
    const one = newConversationId();

    // Nothing has opened it. Unloaded is a real answer, not a missing one.
    expect(states.stateOf(one)).toBe('unloaded');

    expect(states.move(one, 'opening', AT)).toBe('opening');
    expect(states.move(one, 'idle', AT + 1)).toBe('idle');
    expect(states.move(one, 'running', AT + 2)).toBe('running');
    // A message waiting behind another chat in the same folder.
    expect(states.move(one, 'queued', AT + 3)).toBe('queued');
    expect(states.move(one, 'running', AT + 4)).toBe('running');
    expect(states.move(one, 'stopping', AT + 5)).toBe('stopping');
    expect(states.move(one, 'idle', AT + 6)).toBe('idle');

    expect(states.stateOf(one)).toBe('idle');
    expect(states.factsOf(one)?.status).toBe('idle');
  });

  it('refuses a move the table does not allow, and says where it really is', () => {
    const states = new Sessions();
    const one = newConversationId();
    states.move(one, 'opening', AT);
    // Two opens of one conversation would be two writers for one transcript.
    expect(states.move(one, 'opening', AT + 1)).toBe('opening');
    // And an attempt that ended comes back only by being opened again.
    states.move(one, 'failed', AT + 2);
    expect(states.move(one, 'running', AT + 3)).toBe('failed');
    expect(states.move(one, 'opening', AT + 4)).toBe('opening');
  });

  it('follows the runtime rather than the hope: a dropped run is interrupted', () => {
    const states = new Sessions();
    const one = newConversationId();
    states.move(one, 'opening', AT);
    states.move(one, 'idle', AT + 1);
    states.move(one, 'running', AT + 2);
    // What `putDown` does for a runtime dropped with something in flight: the
    // note says an attempt never finished, which is what happened, and the
    // state it is in is one the table allows.
    expect(states.move(one, 'interrupted', AT + 3)).toBe('interrupted');
    expect(states.stateOf(one)).toBe('interrupted');
  });

  it('tells a conversation in flight from one that is quiet', () => {
    // The two decisions the shell takes with this — may this be put down, and
    // does closing the view have anything to end — are the same question.
    expect(inFlight('opening')).toBe(true);
    expect(inFlight('queued')).toBe(true);
    expect(inFlight('running')).toBe(true);
    expect(inFlight('stopping')).toBe(true);
    expect(inFlight('idle')).toBe(false);
    expect(inFlight('unloaded')).toBe(false);
    expect(inFlight('failed')).toBe(false);
    expect(inFlight('interrupted')).toBe(false);
  });
});

/** One note, as the session service writes it while a run is going. */
function facts(conversation: string, status: DurableFacts['status'], at = AT): DurableFacts {
  return {
    conversationId: asConversationId(conversation),
    workspaceId: null,
    status,
    ownerId: runOwner(newRunId()),
    runtimeEpoch: null,
    writtenAt: at,
  };
}

describe('a run written down before it starts', () => {
  it('is a record while it is going, and gone the moment it ends', async () => {
    const profile = await scratch();
    const transcript = join(profile, 'sessions', 'chat.jsonl');

    await wroteRunNote(profile, facts(transcript, 'running'), '/work/atlas');
    const kept = readRunNotes(profile);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.conversationId).toBe(transcript);
    expect(kept[0]?.project).toBe('/work/atlas');
    expect(kept[0]?.status).toBe('running');
    expect(kept[0]?.writtenAt).toBe(AT);

    // A clean stop: the run is not in flight any more, so the note goes.
    await wroteRunNote(profile, facts(transcript, 'idle', AT + 5), '/work/atlas');
    expect(readRunNotes(profile)).toEqual([]);
  });

  it('leaves one conversation alone when another writes its own', async () => {
    const profile = await scratch();
    await wroteRunNote(profile, facts('a.jsonl', 'running'), '/work/atlas');
    await wroteRunNote(profile, facts('b.jsonl', 'opening', AT + 1), '/work/atlas');
    await wroteRunNote(profile, facts('a.jsonl', 'idle', AT + 2), '/work/atlas');
    expect(readRunNotes(profile).map((one) => one.conversationId)).toEqual(['b.jsonl']);
  });

  it('reads a file that will not parse as no runs, rather than throwing', async () => {
    const profile = await scratch();
    await writeFile(runNotesFile(profile), 'half a file', 'utf8');
    expect(readRunNotes(profile)).toEqual([]);
  });
});

describe('the launch after a run was cut off', () => {
  it('reports it as interrupted, says so, and does not start it again', async () => {
    const profile = await scratch();
    const transcript = join(profile, 'sessions', 'chat.jsonl');
    // Written the way a run leaves it: still in flight, because the process
    // that was running it never got to the end of it.
    await wroteRunNote(
      profile,
      { ...facts(transcript, 'running') },
      '/work/atlas',
    );

    /* What the next launch does, in the order `readWhatWasRunning` does it. A
       launch that has reattached nothing passes `alive: false`. */
    const states = new Sessions();
    const notes = readRunNotes(profile);
    expect(notes).toHaveLength(1);
    const note = notes[0]!;

    states.remembered(note);
    expect(states.factsOf(note.conversationId)?.status).toBe('running');
    const back = states.recovered(note.conversationId);
    expect(back.state).toBe('interrupted');
    expect(states.stateOf(note.conversationId)).toBe('interrupted');

    // It is said, and what it says is that nothing is running now.
    const said = interruptedWords(note, AT + 60_000);
    expect(said).toContain('in the middle of a run when Graphe stopped');
    expect(said).toContain('Nothing was picked up where it left off');
    // A minute later, in the words a person uses for it.
    expect(said).toContain('a minute ago');

    // Nothing was reissued: the recovery produced the state it is in and
    // nothing else, and the note is taken away so the next launch has nothing
    // to say about it. A run started again would be `opening` or `running`,
    // with a note still on disk.
    await tookRunNoteAway(profile, note.conversationId);
    expect(readRunNotes(profile)).toEqual([]);
    expect(states.stateOf(note.conversationId)).toBe('interrupted');
  });

  it('keeps what had already ended rather than calling it interrupted', () => {
    const states = new Sessions();
    const finished = newConversationId();
    states.move(finished, 'idle', AT);
    states.move(finished, 'archived', AT + 1);
    // A note left by an attempt that had already ended means the restart
    // interrupted nothing, so it comes back as what it was.
    states.remembered({
      conversationId: finished,
      workspaceId: null,
      status: 'archived',
      ownerId: null,
      runtimeEpoch: null,
      writtenAt: AT + 1,
    });
    expect(states.recovered(finished).state).toBe('archived');
    // A conversation nothing was ever written down about is left alone too.
    expect(states.recovered(newConversationId()).state).toBe('unloaded');
  });

  it('hands the whole note back, project and all, once per conversation', async () => {
    const profile = await scratch();
    await wroteRunNote(profile, facts('/chats/one.jsonl', 'queued'), '/work/atlas');
    await wroteRunNote(profile, facts('/chats/two.jsonl', 'stopping', AT + 1), '/work/bee');

    const notes = readRunNotes(profile);
    expect(notes.map((one) => [one.conversationId, one.project])).toEqual([
      ['/chats/one.jsonl', '/work/atlas'],
      ['/chats/two.jsonl', '/work/bee'],
    ]);
    // Both were in flight, so both are marked as such in the moves the launch
    // would make of them.
    expect(notes.map((one) => inFlight(one.status))).toEqual([true, true]);
    expect(notes[1]?.writtenAt).toBe(AT + 1);
    // The file is written as text a person could read, under the profile.
    expect(runNotesFile(profile)).toContain(profile);
    expect(JSON.parse(await readFile(runNotesFile(profile), 'utf8'))).toHaveLength(2);
  });
});

describe('a question on screen, and Pi tidying up', () => {
  it('moves a running conversation to waiting-input, and back when it is answered', () => {
    // A question interrupts a run that is going: anything else and the event is
    // somebody else's, which is what null means.
    expect(movedByWork('running', 'asked', true)).toBe('waiting-input');
    expect(movedByWork('idle', 'asked', true)).toBeNull();
    expect(movedByWork('queued', 'asked', true)).toBeNull();

    // Answered by the run picking up again, or by the run ending under it. The
    // second is the one that used to have nowhere to go.
    expect(movedByWork('waiting-input', 'unasked', true)).toBe('running');
    expect(movedByWork('waiting-input', 'unasked', false)).toBe('idle');
    expect(movedByWork('running', 'unasked', true)).toBeNull();
  });

  it('moves a conversation to compacting for Pi own tidying, and back', () => {
    expect(movedByWork('running', 'tidying', true)).toBe('compacting');
    // The early tidy runs between turns, so idle is where it starts from too.
    expect(movedByWork('idle', 'tidying', false)).toBe('compacting');
    expect(movedByWork('waiting-input', 'tidying', true)).toBeNull();
    expect(movedByWork('compacting', 'tidied', true)).toBe('running');
    expect(movedByWork('compacting', 'tidied', false)).toBe('idle');
    expect(movedByWork('running', 'tidied', true)).toBeNull();
  });

  it('walks the whole way through the shell, and leaves nothing stuck waiting', () => {
    const states = new Sessions();
    const one = newConversationId();
    const at = (steps: number): number => AT + steps;

    states.move(one, 'opening', at(0));
    states.move(one, 'idle', at(1));
    states.move(one, 'running', at(2));

    // The permission question, and what the shell does with it: the move the
    // event names, refused or not by the same table as everything else.
    states.move(one, movedByWork(states.stateOf(one), 'asked', true)!, at(3));
    expect(states.stateOf(one)).toBe('waiting-input');

    // Answered, and the run picks up again underneath the card.
    states.move(one, movedByWork(states.stateOf(one), 'unasked', true)!, at(4));
    expect(states.stateOf(one)).toBe('running');

    // Pi's own tidying, and the end of it.
    states.move(one, movedByWork(states.stateOf(one), 'tidying', true)!, at(5));
    expect(states.stateOf(one)).toBe('compacting');
    states.move(one, movedByWork(states.stateOf(one), 'tidied', false)!, at(6));
    expect(states.stateOf(one)).toBe('idle');

    // The note is a run's, and every one of these was in flight while it was
    // going, so a launch that finds the last of them calls it interrupted.
    expect(states.factsOf(one)?.status).toBe('idle');
    expect(inFlight('waiting-input')).toBe(true);
    expect(inFlight('compacting')).toBe(true);
  });

  it('refuses a move the table does not allow rather than inventing a wait', () => {
    const states = new Sessions();
    const one = newConversationId();
    states.move(one, 'opening', AT);
    states.move(one, 'idle', AT + 1);
    // Nothing is running, so there is nothing for a question to interrupt —
    // and the domain is what says so, not the caller.
    expect(movedByWork('idle', 'asked', true)).toBeNull();
    expect(states.stateOf(one)).toBe('idle');
    // And the wait a question does create can end with the run.
    states.move(one, 'running', AT + 3);
    states.move(one, 'waiting-input', AT + 4);
    expect(states.move(one, 'idle', AT + 5)).toBe('idle');
  });
});

describe('a conversation somebody put away', () => {
  it('is reported archived for as long as the flag says so', () => {
    // Put away, and nothing running: archived, whatever the runtime last said.
    expect(reportedState('unloaded', true)).toBe('archived');
    expect(reportedState('idle', true)).toBe('archived');
    // A run really going is reported as going, whoever put it away: archive
    // hides a row from the list, it does not stop work.
    expect(reportedState('running', true)).toBe('running');
    expect(reportedState('waiting-input', true)).toBe('waiting-input');
    // And the flag is not invented: nothing archived, nothing archived.
    for (const state of ['idle', 'unloaded', 'failed', 'interrupted'] as const) {
      expect(reportedState(state, false)).toBe(state);
    }
  });

  it('comes back archived after a restart, because nothing was running in it', () => {
    // The flag is durable and the runtime is not, so the state a restart reads
    // back is the one the registry keeps, not one a dead process left.
    expect(reportedState('archived', true)).toBe('archived');
    expect(inFlight('archived')).toBe(false);
  });
});
