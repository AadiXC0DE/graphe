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
 * `receive` folds an event into the desk the shell says it came from, not into
 * whichever desk happens to be in front. A reply that was still arriving when
 * somebody switched folders belongs to the folder it started in, and it goes
 * there — see `AgentNotice` in ipc.ts.
 */

import type { Attachment } from '../components/Attachments';
import type { Recording } from '../diff/flow';
import type { Task, TaskObservation } from '../cost/estimate';
import type { AgentNotice, Overview, PutBack, SavedVersion } from './ipc';
import { applySpend, type SpendView } from './spend';
import { applyEvent, type Turn } from './thread';
import { readsAFile, TASK_LABEL, WEB_SEARCH_LABEL } from './describe';

/** One thing the agent was given to work from — a screenshot it was sent, or a
 *  design file its link named. Recorded in the overview the moment it is sent,
 *  because the overview's job is the story of the work, and a picture that
 *  shaped the work belongs in it whether the thread still mentions it or not. */
export type Reference = {
  id: string;
  kind: 'image' | 'figma';
  name: string;
  note: string;
  /** An object URL, for images only. Live for as long as this session. */
  preview?: string;
};

/** One line of the research log: a web search the agent made for this project.
 *  Derived from the thread, not kept a second time — see `researchLog`. */
export type ResearchEntry = {
  id: string;
  /** What it searched for, as it said it. */
  query: string;
  state: 'running' | 'done' | 'failed';
};

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
  /** The conversation, in order. */
  turns: readonly Turn[];
  /** What this sitting has cost. Null until there is a first number — the meter
   *  appears when it has something to say and then stays. */
  spent: SpendView | null;
  /** What has been brought in and not yet said. */
  attachments: readonly Attachment[];
  /** What has been brought in *and said* — the story of the work. */
  references: readonly Reference[];
  /** The git state of the project, as the shell last reported it. Null until
   *  the overview has been asked for. */
  overview: Overview | null;
  /** The timeline, newest first. Empty until the shell has been asked. */
  versions: readonly SavedVersion[];
  /** Each project's own timeline, by its folder name, when this folder holds
   *  several projects rather than being one. Empty every ordinary day. */
  repoVersions: Readonly<Record<string, readonly SavedVersion[]>>;
  /** Each project's own stylesheet, by folder name. A folder holding several
   *  projects has no stylesheet of its own, so the design view reads one of
   *  these instead of finding nothing. */
  repoStyles: Readonly<Record<string, Overview['styles']>>;
  /** The offer to undo the last "put back", while it is still on offer. */
  putBack: PutBack | null;

  /**
   * What jobs like this have actually cost in this project (COST-DESIGN §2).
   *
   * Per desk, because the estimate should be about *this* project. A portfolio
   * of four pages and a client site with a shop in it do not cost the same to
   * work on, and an average across both is a number that describes neither.
   */
  jobs: readonly TaskObservation[];
  /** The job in flight, and when it started, so what it came to can be
   *  measured when it settles. Null when nothing is running. */
  doing: { task: Task; startedAt: number } | null;
  /**
   * Which conversation is on screen, as the shell addresses it. Null before the
   * shell has said — everything still works, it just cannot be addressed.
   */
  address: string | null;
  /**
   * The project's other open conversations, by address.
   *
   * `turns` above is whichever one is in front; these are the rest, kept whole
   * so switching is swapping and nothing is refetched. A reply that arrives for
   * one of them lands in it rather than in whatever happens to be on screen.
   */
  parked: Readonly<Record<string, Parked>>;
  /**
   * Every conversation open here, in the order they were opened.
   *
   * Kept apart from `parked` because that is a bag: switching moves one out of
   * it and another in, and a row of tabs built from it would reorder under the
   * hand every time somebody pressed one.
   */
  order: readonly string[];
  /**
   * How much of this sitting's running total has already been attributed to a
   * finished job.
   *
   * The shell's ledger reports the whole sitting each time it settles, so each
   * job is charged the difference. Without this the second job of an afternoon
   * would be recorded as costing everything spent since lunch, and every
   * estimate after it would be nonsense.
   */
  counted: number;
};

/** A conversation this project has open but is not showing.
 *
 * Only what belongs to a conversation rather than to the project: what was said
 * in it. The versions, the spend and the pictures are the project's, and are
 * shared.
 */
export type Parked = {
  turns: readonly Turn[];
  /** Job measurement belongs to the conversation whose session will settle. */
  doing?: { task: Task; startedAt: number } | null;
  counted?: number;
};

/** A run of states somebody recorded on the page, and the project it was
 *  recorded in. */
export type Recorded = {
  recording: Recording;
  project: string;
};

/**
 * What is worth keeping from a run that has just stopped.
 *
 * Null for a run that saw nothing. Pressing record, doing nothing and pressing
 * stop is not evidence, and a row in the conversation saying so is furniture.
 * Null too when there is no project to hang it on, so one project's states are
 * never left over the next one's conversation.
 */
export function recordedIn(project: string | null, run: Recording | null): Recorded | null {
  if (project === null || run === null || run.frames.length === 0) return null;
  return { recording: run, project };
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

/** The box with the line put back into it. Whatever was already typed there
 *  stays, and stays first: it is a sentence somebody is in the middle of, not
 *  an empty slot to drop the line into. */
export function intoTheBox(draft: string, words: readonly string[]): string {
  if (words.length === 0) return draft;
  const back = words.join('\n\n');
  return draft.trim() === '' ? back : `${draft}\n\n${back}`;
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
    turns: [],
    spent: null,
    attachments: [],
    references: [],
    overview: null,
    versions: [],
    repoVersions: {},
    repoStyles: {},
    putBack: null,
    jobs: [],
    doing: null,
    address: null,
    parked: {},
    order: [],
    counted: 0,
  };
}

/**
 * Bring one of a project's conversations to the front.
 *
 * The one that was in front is parked whole, so coming back to it finds it as
 * it was rather than as a thread that has to be read off disk again.
 */
/** What somebody calls a folder: its last part, never the whole path. Used
 *  where a board is showing work from more than one at a time. */
export function folderCalled(path: string): string {
  const parts = path.split(/[\\/]+/).filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

export function showThread(desks: Desks, project: string, address: string): Desks {
  return changeDesk(desks, project, (desk) => {
    if (desk.address === address) return desk;
    const wanted = desk.parked[address];
    if (wanted === undefined) return desk;
    const { [address]: _taken, ...rest } = desk.parked;
    return {
      ...desk,
      turns: wanted.turns,
      doing: wanted.doing ?? null,
      counted: wanted.counted ?? 0,
      address,
      parked:
        desk.address === null
          ? rest
          : {
              ...rest,
              [desk.address]: {
                turns: desk.turns,
                doing: desk.doing,
                counted: desk.counted,
              },
            },
    };
  });
}

/** Put a conversation down without losing what is in it. Never the one in
 *  front — closing what you are looking at is a different move. */
export function parkThread(desks: Desks, project: string, address: string): Desks {
  return changeDesk(desks, project, (desk) => {
    if (desk.parked[address] === undefined) return desk;
    const { [address]: _gone, ...rest } = desk.parked;
    return { ...desk, parked: rest, order: desk.order.filter((one) => one !== address) };
  });
}

/** Every conversation this project has open, in the order they were opened,
 *  with the one in front marked. */
export function threadsIn(desk: Desk): readonly { address: string; here: boolean }[] {
  const known = new Set([...Object.keys(desk.parked), ...(desk.address === null ? [] : [desk.address])]);
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
 * Take one event from the shell, and put it on the right desk.
 *
 * The conversation and the money are folded in the same call because they are
 * two readings of one event and they must never be a frame apart: a meter that
 * has counted something the thread has not yet mentioned is a meter nobody
 * trusts.
 */
export function receive(desks: Desks, notice: AgentNotice, at: number = Date.now()): Desks {
  const path = notice.project ?? desks.current;
  if (path === null) return desks;
  return changeDesk(desks, path, (desk) => {
    // A reply that was still arriving when somebody switched conversations
    // belongs to the conversation it started in. The spend is the project's
    // either way, so it is counted wherever the words land.
    const said = notice.conversation ?? '';
    if (said !== '' && said !== desk.address) {
      const parked = desk.parked[said];
      if (parked !== undefined) {
        const measured = measure(
          {
            ...desk,
            turns: parked.turns,
            doing: parked.doing ?? null,
            counted: parked.counted ?? 0,
          },
          notice,
          at,
        );
        return {
          ...desk,
          jobs: measured.jobs,
          parked: {
            ...desk.parked,
            [said]: {
              ...parked,
              turns: applyEvent(parked.turns, notice.event),
              doing: measured.doing,
              counted: measured.counted,
            },
          },
          spent: applySpend(desk.spent, notice.event),
        };
      }
      // A delayed event for a conversation this window no longer knows must
      // never fall through into the tab in front. Its project spend remains a
      // project fact, but its words and job state have no honest destination.
      return { ...desk, spent: applySpend(desk.spent, notice.event) };
    }
    return {
      ...desk,
      turns: applyEvent(desk.turns, notice.event),
      spent: applySpend(desk.spent, notice.event),
      ...measure(desk, notice, at),
    };
  });
}

/**
 * File what the last job actually came to, when the shell says the sitting has
 * settled and told us the ledger.
 *
 * The next estimate is built from these, which is the whole of what makes it a
 * measurement rather than a guess (COST-DESIGN §2, and the honest note at the
 * top of `estimate.ts`). Only the difference since the last settle is recorded
 * — see `Desk.counted`.
 */
function measure(
  desk: Desk,
  notice: AgentNotice,
  at: number,
): Pick<Desk, 'jobs' | 'doing' | 'counted'> {
  const unchanged = { jobs: desk.jobs, doing: desk.doing, counted: desk.counted };
  if (notice.event.type !== 'spend-summary') return unchanged;

  const total = notice.event.summary.total;
  const spent = total.minor - desk.counted;
  // Nothing to file: no job in flight, or it cost nothing measurable. A zero is
  // not an observation, and recording one would drag every later estimate down.
  if (desk.doing === null || spent <= 0) {
    return { jobs: desk.jobs, doing: null, counted: Math.max(desk.counted, total.minor) };
  }

  return {
    jobs: [
      ...desk.jobs,
      {
        ...desk.doing.task,
        cost: { minor: spent, currency: total.currency },
        durationMs: Math.max(0, at - desk.doing.startedAt),
        at,
      },
    ],
    doing: null,
    counted: total.minor,
  };
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
  const front = nowDoing(desk.turns, at).helpers;
  const behind = Object.values(desk.parked).flatMap((one) =>
    nowDoing(one.turns, at).helpers.filter((helper) => helper.state === 'running'),
  );
  const seen = new Set(front.map((one) => one.id));
  return [...front, ...behind.filter((one) => !seen.has(one.id))];
}

export function nowDoing(turns: readonly Turn[], at: number = Date.now()): NowView {
  let step: NowView['step'] = null;
  const helpers: NowView['helpers'][number][] = [];
  let filesRead = 0;
  /** Any work is going, whatever the step says — so the band can say "working"
   *  steadily even when the step underneath is only a command that would churn. */
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
