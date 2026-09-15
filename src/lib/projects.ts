/** One desk per project, and nothing shared between them.
 *
 * BACKLOG B2: switching projects must swap the conversation, the spend and the
 * versions together. Not "mostly" — a thread that keeps one sentence from the
 * folder you were in ten seconds ago is worse than one that keeps none, because
 * you cannot tell which sentence it was.
 *
 * So the window keeps a desk per folder: everything it knows about that project,
 * in one object, replaced whole. Switching is choosing which one is in front.
 * Nothing is merged, nothing is carried over, and there is no window-level
 * conversation for anything to fall back to.
 *
 * ## The conversation in front is not special
 *
 * A desk holds every conversation open in its project as one complete record
 * (`src/state/conversations.ts`), and `address` says which of them is on screen.
 * Bringing another forward moves that pointer: nothing is copied from one shape
 * into the other, so no field can be dropped by the copy — which is how a chat
 * used to lose its draft, its box or its mode on the way to the front. What is
 * derived from the remarks rather than held (the research log, what is going on)
 * is computed on demand for the same reason: one copy of the truth.
 *
 * ## Why plain functions over a class
 *
 * All of this is React state. Every function here takes the whole store and
 * returns a new one, so a switch is a single `setState` and there is no moment
 * where the thread on screen belongs to one project and the meter to another.
 * It also means the isolation claim is testable with no browser in sight, which
 * is the only reason to believe it.
 *
 * ## Events are routed, not assumed
 *
 * `receive` folds an event into the conversation the shell says it came from,
 * not into whichever one happens to be in front. A reply that was still
 * arriving when somebody switched chats belongs to the chat it started in, and
 * it goes there — see `AgentNotice` in ipc.ts.
 */

import type { Attachment } from '../components/Attachments';
import type { TaskObservation } from '../cost/estimate';
import type { AgentNotice, Overview, PutBack, SavedVersion } from './ipc';
import { applySpend, type SpendView } from './spend';
import { applyEvent, type Turn } from './thread';
import { readsAFile, TASK_LABEL, WEB_SEARCH_LABEL } from './describe';
import {
  busyAfter,
  settled,
  NOTHING_SAID,
  type Conversation,
  type Conversations,
} from '../state/conversations';

export type { Conversation, Conversations, Reference } from '../state/conversations';

/** One helper working alongside the conversation, as the screen sees it. */
export type Helper = {
  id: string;
  task: string;
  /** Everything it has said so far, whole. The rail shows a few words of it
   *  and the sheet shows all of it. */
  saying: string | null;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
};

/** One line of the research log: a web search the agent made for this project.
 *  Derived from the thread, not kept a second time — see `researchLog`. */
export type ResearchEntry = {
  id: string;
  /** What it searched for, as it said it. */
  query: string;
  state: 'running' | 'done' | 'failed';
};

/** What is happening this second: the step in flight, and any helpers still
 *  working. Derived from the thread, like the research log. */
export type NowView = {
  /** The step the agent is on, in the words the thread uses for it. */
  step: { label: string; detail?: string } | null;
  /** Every helper this conversation sent off, oldest first — the ones still
   *  working and the ones that came back. */
  helpers: readonly Helper[];
  /** How many files this conversation has opened. Rarely interesting on its
   *  own; it is what makes a bill make sense. */
  filesRead: number;
};

/** Everything the window knows about one project. */
export type Desk = {
  path: string;
  /** What the person calls it. Shown in the quiet strip at the top. */
  name: string;
  /**
   * Every conversation open here, whole, by address.
   *
   * Address `''` is the conversation a project opens on, before the shell has
   * named it. Each record is complete, so switching is moving `address` rather
   * than copying a subset of fields from one place to another.
   */
  conversations: Conversations;
  /**
   * Which conversation is on screen, as the shell addresses it. Null before the
   * shell has said — everything still works, it just cannot be addressed.
   */
  address: string | null;
  /**
   * Every conversation open here, in the order they were opened.
   *
   * A row of tabs built from the map would reorder under the hand every time
   * somebody pressed one, so where they sit is kept apart from what they hold.
   */
  order: readonly string[];
  /** What this sitting has cost. Null until there is a first number — the meter
   *  appears when it has something to say and then stays. */
  spent: SpendView | null;
  /** The git state of the project, as the shell last reported it. Null until
   *  the overview has been asked for. */
  overview: Overview | null;
  /** The timeline, newest first. Empty until the shell has been asked. */
  versions: readonly SavedVersion[];
  /** Each project's own timeline, by its folder name, when this folder holds
   *  several projects rather than being one. Empty every ordinary day. */
  repoVersions: Readonly<Record<string, readonly SavedVersion[]>>;
  /** The offer to undo the last "put back", while it is still on offer. */
  putBack: PutBack | null;
  /**
   * What jobs like this have actually cost in this project (COST-DESIGN §2).
   *
   * Per desk, because the estimate should be about *this* project. A portfolio
   * of four pages and a client site with a shop in it do not cost the same to
   * work on, and an average across both is a number that describes neither. A
   * conversation's own running total is the difference it has not yet been
   * charged for — see `Conversation.counted`.
   */
  jobs: readonly TaskObservation[];
};

/** Which conversation a write belongs to. Every one of them is addressed this
 *  way, so a change that lands after somebody moved on still goes where it was
 *  meant to. */
export type Owned = { project: string; address: string | null };

/**
 * The conversation on screen — the one the desk's own fields used to be.
 *
 * A desk's `address` is what the shell calls the conversation in front, and the
 * empty string is its spelling of a conversation nobody has named yet. Every
 * screen that draws "this chat" asks for it here rather than spelling the key
 * itself, so a desk in either state reads the same way.
 */
export function inFront(desk: Desk | null | undefined): Conversation {
  if (desk === null || desk === undefined) return NOTHING_SAID;
  return desk.conversations[desk.address ?? ''] ?? NOTHING_SAID;
}

/**
 * One conversation as this project holds it: the one named, or an empty one the
 * project has not had.
 *
 * The conversation in front is a record like any other, so this is a lookup
 * rather than a reconstruction. A null address and the empty string are the
 * same conversation — the one nobody has named yet — and asking for it while
 * some other chat is on screen is asking about a chat this project has not got.
 */
export function conversationIn(desk: Desk | null | undefined, address: string | null): Conversation {
  if (desk === null || desk === undefined) return NOTHING_SAID;
  if (address === null && (desk.address ?? '') !== '') return NOTHING_SAID;
  return desk.conversations[address ?? desk.address ?? ''] ?? NOTHING_SAID;
}

/**
 * Change the conversation named, wherever it is in the row.
 *
 * A conversation this project does not have changes nothing — an answer
 * arriving for a chat that has been closed is not a reason to open it again.
 */
export function changeThread(desks: Desks, owner: Owned, change: (one: Conversation) => Conversation): Desks {
  return changeDesk(desks, owner.project, (desk) => {
    // An unnamed conversation that is not the one in front is one this project
    // has not started yet, and a write for it has nowhere to go.
    if (owner.address === null && desk.address !== null) return desk;
    const key = owner.address ?? '';
    const was = desk.conversations[key];
    if (was === undefined) return desk;
    const next = change(was);
    if (next === was) return desk;
    return { ...desk, conversations: { ...desk.conversations, [key]: next } };
  });
}

/**
 * Change the conversation on screen of whichever project is in front.
 *
 * The commonest write in the window: something arrived for the chat somebody is
 * looking at — a turn, a failure, a job starting. The record is made if this
 * project has not had it, because the empty screen shown before a session is
 * named *is* that conversation, and a sentence said in it belongs somewhere.
 */
export function changeTheFront(desks: Desks, change: (one: Conversation) => Conversation): Desks {
  return changeCurrent(desks, (desk) => {
    const key = desk.address ?? '';
    const was = desk.conversations[key] ?? NOTHING_SAID;
    const next = change(was);
    if (next === was) return desk;
    return { ...desk, conversations: { ...desk.conversations, [key]: next } };
  });
}

/**
 * Which conversation a notice was spoken in: the one it names, or — when it
 * names none — the conversation in front of the project it is about, which is
 * where `receive` puts that notice's words. Null for a notice with no project
 * at all, which belongs to nobody.
 *
 * A run carries on in the background while somebody reads another chat, so a
 * card written on the strength of a notice goes where the notice's words went,
 * never into whatever happens to be in front.
 */
export function spokenIn(
  desks: Desks,
  notice: { project: string | null; conversation?: string | null },
): Owned | null {
  if (notice.project === null) return null;
  return {
    project: notice.project,
    address: notice.conversation ?? desks.byPath[notice.project]?.address ?? null,
  };
}

/**
 * Take out of the box what has just been sent, and nothing else.
 *
 * `accepted` is what was in the box when the send started, taken by identity:
 * the same picture attached again is a new revision and is not this send's to
 * take. Anything added while the send was in flight stays, and so does
 * everything in another conversation's box — a late upload for one chat cannot
 * empty the box of the chat somebody has since switched to.
 */
export function tookTheBox(desks: Desks, owner: Owned, accepted: readonly Attachment[]): Desks {
  if (accepted.length === 0) return desks;
  return changeThread(desks, owner, (one) => {
    const left = one.attachments.filter((each) => !accepted.includes(each));
    return left.length === one.attachments.length ? one : { ...one, attachments: left };
  });
}

/**
 * The sentence of a send that did not go, back in the box it came from.
 *
 * Whatever is in the box now stays, and stays first: somebody may have started
 * the next message while the upload was still going, and that text is not this
 * failure's to throw away. Another conversation's box is not touched at all.
 */
export function putBackTheBox(desks: Desks, owner: Owned, said: string): Desks {
  if (said.trim() === '') return desks;
  return changeThread(desks, owner, (one) => ({
    ...one,
    draft: one.draft.trim() === '' ? said : intoTheBox(one.draft, [said]),
  }));
}

/** One message typed while the last one was still being answered. */
export type Waiting = {
  id: string;
  text: string;
};

/** What came back out of the line, in the order it was queued. Empty when
 *  nothing was waiting — which is not the same as a line that would not come
 *  back, and moves nothing either way. */
export function tookBack(taken: {
  steering: readonly string[];
  followUp: readonly string[];
}): readonly string[] {
  return [...taken.steering, ...taken.followUp].filter((one) => one.trim() !== '');
}

/**
 * The thread with the lines that came back taken out of it.
 *
 * A queued line is shown the moment it is typed, which is right — it is going
 * to be sent. Taking it back puts it in the box again, and leaving the shown
 * copy behind means the same sentence twice: once in the conversation as
 * though it had been said, once in the box waiting to be. Only the trailing
 * ones go, and only the person's own: anything the model has already answered
 * is history, whatever it says.
 */
export function withoutTakenBack(turns: readonly Turn[], words: readonly string[]): readonly Turn[] {
  const left = words.map((one) => one.trim()).filter((one) => one !== '');
  if (left.length === 0) return turns;
  const kept = [...turns];
  for (let at = kept.length - 1; at >= 0 && left.length > 0; at -= 1) {
    const turn = kept[at];
    if (turn === undefined) continue;
    // Anything that is not the person speaking sits between the queued lines
    // and what came before them, and stops the walk: past it is answered work.
    if (turn.kind !== 'said' || turn.from !== 'you') break;
    const found = left.indexOf(turn.text.trim());
    if (found === -1) break;
    left.splice(found, 1);
    kept.splice(at, 1);
  }
  return kept;
}

/** The box with the line put back into it. Whatever was already typed there
 *  stays, and stays first: it is a sentence somebody is in the middle of, not
 *  an empty slot to drop the line into. */
export function intoTheBox(draft: string, words: readonly string[]): string {
  if (words.length === 0) return draft;
  const back = words.join('\n\n');
  return draft.trim() === '' ? back : `${draft}\n\n${back}`;
}

/**
 * What came back out of the line, out of the conversation that asked for it and
 * into its box.
 *
 * Addressed at the press. Taking a line back is a round trip through the shell,
 * and by the time it answers somebody may be reading another chat: the words
 * come off the thread they were shown on, and go into the box they came from,
 * in one write, wherever that conversation now is in the row.
 */
export function tookBackTheLine(desks: Desks, owner: Owned, words: readonly string[]): Desks {
  const back = words.filter((one) => one.trim() !== '');
  if (back.length === 0) return desks;
  return changeThread(desks, owner, (one) => ({
    ...one,
    turns: withoutTakenBack(one.turns, back),
    draft: intoTheBox(one.draft, back),
  }));
}

/** Every desk, and which one is in front. */
export type Desks = {
  readonly current: string | null;
  readonly byPath: Readonly<Record<string, Desk>>;
};

export const noDesks: Desks = { current: null, byPath: {} };

function blankDesk(path: string, name: string): Desk {
  return {
    path,
    name,
    conversations: {},
    address: null,
    order: [],
    spent: null,
    overview: null,
    versions: [],
    repoVersions: {},
    putBack: null,
    jobs: [],
  };
}

/** What somebody calls a folder: its last part, never the whole path. Used
 *  where a board is showing work from more than one at a time. */
export function folderCalled(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

/**
 * Bring one of a project's conversations to the front.
 *
 * The conversation coming forward is already whole — it was whole when it was
 * parked — so this moves the pointer and touches nothing else. That is the
 * whole of the fix for the field that used to be dropped by the copy: there is
 * no copy.
 *
 * `arriving` is what the shell handed back for a conversation that was not open
 * here: the turns as it reads them. Left out for a tab switch.
 *
 * The only way a conversation is shown. A shelf row, a tab and a conversation
 * the shell has just started all come through here.
 */
export function showThread(
  desks: Desks,
  project: string,
  address: string | null,
  arriving?: { turns: readonly Turn[] },
): Desks {
  return changeDesk(desks, project, (desk) => {
    if (desk.address === address && arriving === undefined) return desk;
    // A conversation nobody has named has no session yet, so its record is the
    // empty one — there is nothing to lose by its not being there.
    const key = address ?? '';
    const wanted = desk.conversations[key];
    // Not here, not parked and not arriving: a conversation this project has
    // never had, and nothing to show.
    if (key !== '' && wanted === undefined && arriving === undefined) return desk;
    const conversations = { ...desk.conversations };
    // The one coming forward stops being parked. The one leaving the screen is
    // already in the map, unaltered — that is the whole point of the shape.
    delete conversations[key];
    // A conversation the shell has not named and that nobody is looking at any
    // more is not a conversation: it is the empty screen it was made from.
    if (desk.address === null) delete conversations[''];
    const front: Conversation =
      wanted === undefined
        ? { ...NOTHING_SAID, turns: arriving?.turns ?? [] }
        : arriving === undefined
          ? wanted
          : { ...wanted, turns: arriving.turns };
    return {
      ...desk,
      conversations: { ...conversations, [key]: front },
      address,
      // A conversation nobody has opened here goes on the end of the row rather
      // than being left out of it. A tab missing is worse than one out of place.
      order: key === '' || desk.order.includes(key) ? desk.order : [...desk.order, key],
    };
  });
}

/**
 * Move one conversation to another place in the row.
 *
 * The row is spatial memory, so where a tab sits is the person's to decide.
 * `to` is where it lands in the row as it looks now, clamped: a drag that ends
 * off the end of the strip means the end of the strip.
 */
export function moveThread(desks: Desks, project: string, address: string, to: number): Desks {
  return changeDesk(desks, project, (desk) => {
    const from = desk.order.indexOf(address);
    if (from < 0) return desk;
    const wanted = Math.max(0, Math.min(desk.order.length - 1, to));
    if (wanted === from) return desk;
    const order = [...desk.order];
    order.splice(from, 1);
    order.splice(wanted, 0, address);
    return { ...desk, order };
  });
}

/** Put a conversation down without losing what is in it. Never the one in
 *  front — closing what you are looking at is a different move. */
export function parkThread(desks: Desks, project: string, address: string): Desks {
  return changeDesk(desks, project, (desk) => {
    if (address === (desk.address ?? '')) return desk;
    if (desk.conversations[address] === undefined) return desk;
    const { [address]: _gone, ...rest } = desk.conversations;
    return { ...desk, conversations: rest, order: desk.order.filter((one) => one !== address) };
  });
}

/** Every conversation this project has open, in the order they were opened,
 *  with the one in front marked. A conversation the shell has not named is not
 *  a tab: there is nothing on disk behind it yet. */
export function threadsIn(desk: Desk): readonly { address: string; here: boolean }[] {
  const known = new Set(Object.keys(desk.conversations).filter((one) => one !== ''));
  if (desk.address !== null) known.add(desk.address);
  const ordered = desk.order.filter((one) => known.has(one));
  // Anything the order has not caught up with yet goes on the end rather than
  // being left out — a tab missing from the row is worse than one out of place.
  for (const one of known) if (!ordered.includes(one)) ordered.push(one);
  return ordered.map((address) => ({ address, here: address === desk.address }));
}

/** The desk in front, or null when no project is open. */
export function currentDesk(desks: Desks): Desk | null {
  return desks.current === null ? null : (desks.byPath[desks.current] ?? null);
}

/**
 * Bring a project to the front, making a desk for it if it is new.
 *
 * A project that has been open before is resumed exactly as it was left. That is
 * the whole feature: coming back to a folder should feel like coming back to a
 * desk, not like being handed a clean one.
 */
export function openDesk(desks: Desks, project: { path: string; name: string }): Desks {
  const existing = desks.byPath[project.path];
  // Untouched when there is nothing to change. A desk that comes back as a new
  // object every time it is looked at is a desk React redraws every time it is
  // looked at, and it would make "exactly as you left it" merely a resemblance.
  const desk =
    existing === undefined
      ? blankDesk(project.path, project.name)
      : existing.name === project.name
        ? existing
        : { ...existing, name: project.name };
  return {
    current: project.path,
    byPath: { ...desks.byPath, [project.path]: desk },
  };
}

/** Change one desk, leaving every other one exactly as it was. Unknown paths
 *  change nothing — an answer arriving for a project that has been forgotten is
 *  not a reason to invent it again. */
export function changeDesk(desks: Desks, path: string, change: (desk: Desk) => Desk): Desks {
  const desk = desks.byPath[path];
  if (desk === undefined) return desks;
  const changed = change(desk);
  if (changed === desk) return desks;
  return { ...desks, byPath: { ...desks.byPath, [path]: changed } };
}

/** Change whichever desk is in front. Does nothing when none is. */
export function changeCurrent(desks: Desks, change: (desk: Desk) => Desk): Desks {
  return desks.current === null ? desks : changeDesk(desks, desks.current, change);
}

/**
 * Take one event from the shell, and put it on the right conversation.
 *
 * The conversation and the money are folded in the same call because they are
 * two readings of one event and they must never be a frame apart: a meter that
 * has counted something the thread has not yet mentioned is a meter nobody
 * trusts.
 *
 * The spend is the project's either way, so it is counted wherever the words
 * land. A delayed event for a conversation this window no longer knows must
 * never fall through into the tab in front: its project spend remains a project
 * fact, but its words have no honest destination.
 */
export function receive(desks: Desks, notice: AgentNotice, at: number = Date.now()): Desks {
  const path = notice.project ?? desks.current;
  if (path === null) return desks;
  return changeDesk(desks, path, (desk) => {
    // A notice that names no conversation is about the one in front, which is
    // where its words go — so it is that conversation's key, whatever it is.
    const here = desk.address ?? '';
    const on = notice.conversation ?? here;
    const spent = applySpend(desk.spent, notice.event);
    if (on !== here) {
      const there = desk.conversations[on];
      if (there === undefined) return { ...desk, spent };
      const { next, job } = settled(there, notice, at);
      return {
        ...desk,
        conversations: {
          ...desk.conversations,
          [on]: {
            ...next,
            turns: applyEvent(there.turns, notice.event),
            busy: busyAfter(there.busy, notice.event),
          },
        },
        jobs: job === null ? desk.jobs : [...desk.jobs, job],
        spent,
      };
    }
    const was = desk.conversations[here];
    const { next, job } = settled(was ?? NOTHING_SAID, notice, at);
    return {
      ...desk,
      conversations: {
        ...desk.conversations,
        [here]: {
          ...next,
          turns: applyEvent(was?.turns ?? [], notice.event),
          busy: busyAfter(was?.busy ?? false, notice.event),
        },
      },
      jobs: job === null ? desk.jobs : [...desk.jobs, job],
      spent,
    };
  });
}

/** Forget a project entirely — used when its folder has gone. If it was the one
 *  in front, nothing takes its place: the picker is the honest thing to show. */
export function closeDesk(desks: Desks, path: string): Desks {
  if (desks.byPath[path] === undefined) return desks;
  const byPath = { ...desks.byPath };
  delete byPath[path];
  return { current: desks.current === path ? null : desks.current, byPath };
}

/**
 * The research log: every web search this conversation made, in order.
 *
 * Derived from the turns rather than recorded alongside them, because the turns
 * are the one copy of the truth — a second list that has to be kept in step is a
 * second list that will drift. The thread already carries the label and the
 * query for every search (`describe.ts` put them there); this only picks those
 * turns out and presents them as the overview needs them.
 */
/**
 * What is going on right now, read off the thread.
 *
 * Same reasoning as `researchLog`: the turns are the one copy of the truth, and
 * a second list kept in step is a second list that drifts. The last running step
 * is the one being drawn — earlier ones have finished — and a helper counts as
 * out until its own line closes.
 */
/** The mechanical, per-command steps — a shell command, an edit, a read — that
 *  happen dozens of times a turn. They tell the band what is happening this
 *  instant but not what is actually going on, and stepping them into the panel
 *  keeps it flickering. Everything else is worth naming. */
function isMechanical(label: string): boolean {
  return (
    label === 'Running a command' ||
    label === 'Looking at what is in the folder' ||
    label === 'Looking through your files' ||
    label.startsWith('Reading ') ||
    label.startsWith('Changing ') ||
    label.startsWith('Writing ') ||
    label.startsWith('Removing ')
  );
}

/**
 * Every helper still going in this project, whichever conversation asked for it.
 *
 * The rail used to be read off the conversation in front, so opening another tab
 * took it off the screen — and a helper that is still working, with nothing on
 * screen to say so, is a helper that looks stopped. Nobody watching could tell
 * the difference, and the natural next move is to stop it and start again.
 */
export function helpersRunning(desk: Desk, at: number = Date.now()): NowView['helpers'] {
  const here = desk.address ?? '';
  const front = nowDoing(desk.conversations[here]?.turns ?? [], at).helpers;
  const behind = Object.entries(desk.conversations)
    .filter(([address]) => address !== here)
    .flatMap(([, one]) => nowDoing(one.turns, at).helpers.filter((helper) => helper.state === 'running'));
  const seen = new Set(front.map((one) => one.id));
  return [...front, ...behind.filter((one) => !seen.has(one.id))];
}

export function nowDoing(turns: readonly Turn[], at: number = Date.now()): NowView {
  let step: NowView['step'] = null;
  const helpers: NowView['helpers'][number][] = [];
  let filesRead = 0;
  /** Any work is going, whatever the step says — so the band can say "working"
   * steadily even when the step underneath is only a command that would churn. */
  let atWork = false;
  for (const turn of turns) {
    if (turn.kind !== 'did') continue;
    if (readsAFile(turn.label) && turn.state !== 'failed') filesRead += 1;
    // A helper stays on the board once it has come back. What it was asked and
    // what it found are the most interesting things in the whole sitting, and
    // they should not vanish the moment it finishes.
    if (turn.label === TASK_LABEL) {
      helpers.push({
        id: turn.id,
        task: turn.detail ?? '',
        // Whatever it has said, running or finished. It used to be blanked the
        // moment a helper came back, so every finished helper on the board read
        // as one that had found nothing.
        saying: turn.progress ?? null,
        state: turn.state === 'running' ? 'running' : turn.state === 'failed' ? 'failed' : 'done',
        startedAt: turn.at ?? at,
      });
    }
    if (turn.state !== 'running') continue;
    atWork = true;
    // A notable step gets named; the mechanical ones stay quiet so the band
    // reads as one steady sentence rather than a ledger of every command.
    if (step === null && !isMechanical(turn.label)) step = { label: turn.label, detail: turn.detail };
  }
  if (step === null && atWork) step = { label: 'Working on it' };
  return { step, helpers, filesRead };
}

export function researchLog(turns: readonly Turn[]): readonly ResearchEntry[] {
  return turns.flatMap((turn): ResearchEntry[] => {
    if (turn.kind !== 'did' || turn.state === undefined) return [];
    if (turn.label !== WEB_SEARCH_LABEL) return [];
    return [
      {
        id: turn.id,
        query: turn.detail ?? '',
        state: turn.state === 'running' ? 'running' : turn.state === 'failed' ? 'failed' : 'done',
      },
    ];
  });
}
