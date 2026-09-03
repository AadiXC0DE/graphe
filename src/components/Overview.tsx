import { type ReactElement, useEffect, useMemo, useRef, useState } from 'react';
import Away from './Away';
import Waiting from './Waiting';
import CostMeter from './CostMeter';
import { SAYS as DESIGN, type DesignPart } from './DesignView';
import History from './History';
import Lines from './Lines';
import Landing, { type Outcome } from './Landing';
import type { Verdict } from '../design/gate';
import Swatches from './Swatches';
import type {
  Artifact,
  Away as AwayState,
  Decision,
  EveryKind,
  Fetched,
  GitSnapshot,
  InStep as InStepState,
  Landing as LandingState,
  PutBack,
  RepoOverview,
  SavedVersion,
  Money,
  SpendLimit,
  StyleToken,
  Swatch,
} from '../lib/ipc';
import type { DesignReading } from '../design/reading';
import type { NowView, Reference, ResearchEntry } from '../lib/projects';
import type { SpendView } from '../lib/spend';
import { elapsedWords } from '../work/goal';
import './Overview.css';

/** Words for the folder that holds several projects. Named for what somebody
 *  sees — the projects, and where each stands — not for how they are found. */
const SEVERAL = {
  heading: 'The projects',
  changed: 'changed',
  save: 'Commit',
  /** The strip above the timeline, when there is more than one timeline. */
  whose: 'Whose history',
} as const;

/** The commit band. One press, one operation, named as itself — the second half
 *  of the button says where the commit lands, which is the thing a label cannot
 *  carry and the thing a developer wants before pressing it. */
const COMMITTING = {
  heading: 'Commit',
  waiting: (count: number): string =>
    count === 1 ? 'One change is not committed yet.' : `${count} changes are not committed yet.`,
  onto: (branch: string): string => `to ${branch}`,
  what: (branch: string | null): string =>
    branch === null
      ? 'Stage every change in this project and commit it.'
      : `Stage every change in this project and commit it to ${branch}.`,
} as const;

/** Origin, and the two things this panel does against it. Both named as
 *  themselves: a fetch moves nothing, a fast-forward moves the branch and is
 *  only ever offered where it can lose nothing. Anything else — a divergence,
 *  a dirty tree — is said and left for the person to decide. */
const ORIGIN = {
  heading: 'Origin',
  fetch: 'Fetch',
  fetching: 'Fetching…',
  forward: 'Fast-forward',
  forwarding: 'Fast-forwarding…',
} as const;

/** The one band that answers "where is this project, and what is uncommitted".
 *  Three bands answered it before, stacked, and a person had to read all three
 *  to learn one thing. */
/** The goal band. A status word rather than a colour, because a person reading
 *  a panel out loud has to be able to say where the job is. */
const GOAL = {
  heading: 'Goal',
  states: { active: 'Working', paused: 'Paused', done: 'Complete' } as const,
  /** Steps, time and rounds on one line. Nothing here is a percentage: a list
   *  of five with three ticked is 3/5 and never 60%. */
  line: (done: number, total: number, elapsed: string, rounds: number): string =>
    [
      total === 0 ? null : `${String(done)}/${String(total)}`,
      elapsed === '' ? null : elapsed,
      rounds === 0 ? null : `${String(rounds)} ${rounds === 1 ? 'round' : 'rounds'}`,
    ]
      .filter((one) => one !== null)
      .join(' · '),
} as const;

/** Where the Looked up band's own state is kept. */
const LOOKED_UP = 'graphe:panel:lookedup';

const GIT = {
  heading: 'Git',
  changes: 'Changes',
  nothing: 'Nothing uncommitted',
  files: (count: number): string => `${String(count)} ${count === 1 ? 'file' : 'files'}`,
  /** What changed, in lines, beside how many files it is across. Nothing at
   *  all where only untracked files are waiting: those have no diff to count,
   *  and a `+0 −0` beside three new files would read as a bug. */
  lines: (added: number, removed: number): string | null =>
    added === 0 && removed === 0 ? null : `+${String(added)} −${String(removed)}`,
  open: 'Read what changed',
} as const;

function commits(count: number): string {
  return count === 1 ? '1 commit' : `${String(count)} commits`;
}

/** Where a branch stands against origin, in the words git uses for it. */
export function saysStanding(found: Fetched): string {
  const upstream = found.upstream ?? 'origin';
  switch (found.state) {
    case 'no-remote':
      return 'No remote named origin. This project is only here.';
    case 'detached':
      return 'Detached HEAD, so there is no branch to fetch onto.';
    case 'no-upstream':
      return `${found.branch ?? 'This branch'} tracks nothing on origin.`;
    case 'ahead':
      return `${commits(found.ahead)} ahead of ${upstream}, none behind.`;
    case 'behind':
      return `${commits(found.behind)} behind ${upstream}.`;
    case 'diverged':
      return `Diverged from ${upstream}: ${commits(found.ahead)} ahead, ${String(found.behind)} behind. A merge or a rebase is yours to make.`;
    case 'up-to-date':
      return `Up to date with ${upstream}.`;
  }
}

/** What the band says after a press. A fast-forward reports what it took in;
 *  everything else reports where the branch stands, and why nothing moved. */
export function saysFound(found: Fetched): string {
  if (found.moved > 0) {
    return `Fast-forwarded ${found.branch ?? 'HEAD'} to ${found.upstream ?? 'origin'}, ${commits(found.moved)} in.`;
  }
  const standing = saysStanding(found);
  return found.state === 'behind' && found.dirty
    ? `${standing} Uncommitted changes here, so nothing has moved.`
    : standing;
}

/** True when the branch can be moved forward without losing anything. */
function canFastForward(found: Fetched | undefined): boolean {
  return found !== undefined && found.state === 'behind' && !found.dirty;
}

/** Where a project stood at the last status read — what the band says before
 *  anybody has fetched. `no-remote` is not among the answers: a status cannot
 *  tell a missing origin from a branch that tracks nothing. */
function standingOf(git: GitSnapshot): Fetched {
  const current = git.branches.find((one) => one.current);
  const upstream = current?.upstream ?? null;
  const ahead = current?.ahead ?? git.ahead;
  const behind = current?.behind ?? git.behind;
  const state: Fetched['state'] =
    git.branch === '(detached)'
      ? 'detached'
      : upstream === null
        ? 'no-upstream'
        : behind > 0 && ahead > 0
          ? 'diverged'
          : behind > 0
            ? 'behind'
            : ahead > 0
              ? 'ahead'
              : 'up-to-date';
  return { branch: git.branch, upstream, ahead, behind, dirty: git.dirty, moved: 0, state };
}

/** Where a project stands, beyond the line of work its own control already
 *  names. Empty when there is nothing to say — a project in step says it by
 *  saying nothing, and a row with a word on the end of it reads as a warning. */
export function repoState(git: RepoOverview['git']): string {
  const parts: string[] = [];
  if (git.ahead > 0) parts.push(`${String(git.ahead)} ahead`);
  if (git.behind > 0) parts.push(`${String(git.behind)} behind`);
  if (git.dirty) parts.push(SEVERAL.changed);
  return parts.join(' · ');
}

/** Everything the panel draws, in one object. It was eight props and the next
 *  band would have made it twelve. */
export type OverviewView = {
  now: NowView;
  git: GitSnapshot | null;
  /**
   * The goal this conversation is working toward, when one is set.
   *
   * Four numbers were on four screens: what the objective is, how far the list
   * has got, how long it has been going and what it has cost. One line.
   */
  goal?: {
    objective: string;
    status: 'active' | 'paused' | 'done';
    done: number;
    total: number;
    elapsed: number;
    rounds: number;
  } | null;
  /** The projects this folder holds, when it is a folder holding several
   *  rather than one project itself. Empty the ordinary day. */
  repos: readonly RepoOverview[];
  /** Each of those projects' own timeline, by folder name. */
  repoVersions: Readonly<Record<string, readonly SavedVersion[]>>;
  research: readonly ResearchEntry[];
  references: readonly Reference[];
  versions: readonly SavedVersion[];
  /** What each version looked like, by id. Absent ids have no picture. */
  pictures: Readonly<Record<string, string>>;
  /** The versions this project's owner chose to keep at the top. */
  kept: readonly string[];
  putBack: PutBack | null;
  spent: SpendView | null;
  /** The account in use is paid for by its own plan, so the figure beside it is
   *  a count rather than a bill. */
  onAPlan: boolean;
  /** The ceiling somebody set, or null when they have not set one. */
  ceiling: SpendLimit | null;
  busy: boolean;
  showMe: boolean;
  /** Things the last turn made that are worth looking at. */
  artifacts: readonly Artifact[];
  swatches: readonly Swatch[];
  /** This project's own tokens, and where they live. */
  styles: { file: string; tokens: readonly StyleToken[]; text: string } | null;
  /** What the stylesheet says about itself, read once and shared with the
   *  design view rather than worked out twice. */
  reading: DesignReading;
  /** The Figma file this project is kept in step with, and what has moved on in
   *  it. Null until the shell has answered. */
  inStep: InStepState | null;
  /** What can be done with the work now it exists. Null until the shell has
   *  answered, so the band does not flash on the way in. */
  landing: LandingState | null;
  /** How far the waiting work has moved from the pictures agreed to, or null
   *  when nothing was compared. */
  gate: Verdict | null;
  /** Which line is in force, by id. */
  howMuch: string;
  /** Which of the two things that can send anywhere is going, if either is. */
  going: 'developer' | 'online' | null;
  /** What came of the last one that went. */
  landed: Outcome;
  /** What was just decided about work that was waiting, and how to undo it. */
  decided: { letIn: boolean; undoTo: string } | null;
  /** What is happening whether or not this window is open. Null until the shell
   *  has answered. */
  away: AwayState | null;
  /** The other folders with work of their own, so the board can show all of it
   *  at once. Empty on the ordinary day. */
  elsewhere: readonly { where: string; project: string; away: AwayState }[];
  /** What the folder in front is called. */
  project: string;
  /** Now, epoch ms, so the board draws the same twice. */
  clock: number;
};

type Props = {
  view: OverviewView;
  /** Every one of these takes the project it is about, by folder name, when
   *  this folder holds several. Left out means the folder itself, which is
   *  what it always meant. */
  onPutBack: (versionId: string, repo?: string) => void;
  onName: (versionId: string, name: string, repo?: string) => void;
  /** Keep a version at the top of the rail, or stop keeping it. */
  onKeep: (versionId: string, keep: boolean) => void;
  onDismissPutBack: () => void;
  onShowSplit: () => void;
  /** Set the ceiling, raise it, or take it away with null. */
  onLimit: (ceiling: Money | null) => void;
  /** Save where the project stands right now, so it can be come back to. This
   is the commit: the one thing the hand can do with the changed set as a whole. */
  onSave: (repo?: string) => void;
  /** Open everything about how the project looks, at one of its bands. */
  onOpenDesign: (part: DesignPart) => void;
  /** Open the whole history, drawn as lines, for one of the projects here. */
  onOpenGraph: (repo?: string) => void;
  /** Move the project onto another of its lines of work. */
  onSwitchBranch: (name: string, repo?: string) => void;
  /** Start a new line of work and move the project onto it. */
  onCreateBranch: (name: string, repo?: string) => void;
  /** Fetch from origin and answer where that leaves the branch. Null when the
   *  shell refused and has already said why. */
  onFetch?: (repo?: string) => Promise<Fetched | null>;
  /** Fast-forward that branch onto its upstream. */
  onFastForward?: (repo?: string) => Promise<Fetched | null>;
  /** Write a page of what changed, for somebody who is not you. */
  onShare: (repo?: string) => void;
  /** Said whenever the panel changes which project it is showing. */
  onWhose?: (name: string | null) => void;

  /** Let the work that is waiting in, or set it aside. */
  onDecide: (letIn: boolean) => void;
  /** Move the line the work has to cross before it is stopped. */
  onHowMuch: (id: string) => void;
  /** Write the work up and put it where a developer picks it up. */
  onHandOver: (repo?: string) => void;
  /** Open an address in the person's own browser. */
  onOpenLink: (address: string) => void;
  /** Read what changed, as a diff. The band names the count and this is the
   *  press behind it; left off, the count is drawn and cannot be opened. */
  onOpenChanges?: () => void;
  /** Open the Review screen, at an entry when one is named. */
  onOpenReview?: (id?: string) => void;
  /** Open one of the files the last turn made, in the person's editor. */
  onOpenFile: (file: string) => void;

  /* ---------------------------------------------- while you are not looking */

  /** Get on with something whether or not this window stays open. */
  onKeepGoing: (text: string) => void;
  /** Ask for work that waits until another piece has finished. */
  onStartAfter: (text: string, after: string) => void;
  /** Take one of those results into the project. */
  onKeepAway: (id: string) => void;
  /** Stop one, or let its result go. */
  onDropAway: (id: string) => void;
  /** Answer the question one of them stopped on. */
  onAnswerAway: (id: string, callId: string, decision: Decision) => void;
  /** Say something to a piece that is still going, without stopping it. */
  onSayToAway?: (id: string, text: string, where?: string) => Promise<boolean>;
  /** Hold the several goes at one job up against each other. */
  onCompareWays?: (named: string, where?: string) => void;
  /** Let a waiting piece off its wait. */
  onStopWaiting?: (id: string, where?: string) => void;
  /** Take several finished pieces in, in the order they need. */
  onTakeAll?: (ids: readonly string[], where?: string) => void;
  onAddRepeat: (
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
  ) => void;
  onSwitchRepeat: (id: string, on: boolean) => void;
  onForgetRepeat: (id: string) => void;
};

/** What each thing the turn made is, as a small drawing. The icon is the only
 *  thing that tells a palette from a page of copy before reading the name. */
const MADE_ICONS: Readonly<Record<Artifact['kind'], ReactElement>> = {
  image: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="2" y="3" width="12" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <circle cx="5.5" cy="6.5" r="1.1" fill="currentColor" />
      <path d="M2 11.5l3.5-3 2.5 2 3-2.5 3 2.7" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ),
  vector: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 12L12 4m0 0l.5-2.5L14 2l-2 .5L12 4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6.5 13.5c2 .5 4 .5 6 .5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  palette: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <circle cx="5" cy="5" r="1.2" fill="currentColor" />
      <circle cx="11" cy="5" r="1.2" fill="currentColor" />
      <circle cx="8" cy="11.5" r="1.2" fill="currentColor" />
      <path d="M8 2.5A5.5 5.5 0 1 0 13.5 8c0-1.5-1-2.5-2.5-2.5H10c-.5 0-1-.5-1-1V4c0-1-.5-1.5-1-1.5z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  ),
  words: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <path d="M4 2.5h5L12 5.5v8H4z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M8.5 2.5V6H12" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
      <path d="M6 9h5M6 11h5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  ),
  data: (
    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" aria-hidden="true">
      <rect x="2.5" y="3" width="11" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
      <path d="M2.5 6.5h11M6.5 6.5v6.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  ),
};

/** How many rows a band holds before it says "and more". The panel is a summary
 *  of what the work looked like; the thread is the archive. */
const WINDOW = 6;

type TabId = 'work' | 'look' | 'history';

/** Three questions, in the order they get asked: what is happening, how does it
 *  look, and what can I go back to. */
const TABS: readonly { id: TabId; name: string }[] = [
  { id: 'work', name: 'Work' },
  { id: 'look', name: 'Look' },
  { id: 'history', name: 'History' },
];

/** The bands of the design view, as rows you can come at them through. Each
 *  says what it holds, because a list of six nouns down a panel is a list
 *  nobody presses. */
const LOOKS: readonly { id: DesignPart; note: string; trouble?: boolean }[] = [
  { id: 'styles', note: 'Colour, type, spacing (move any of them)' },
  { id: 'motion', note: 'How long things take, and how they start and stop' },
  { id: 'drift', note: 'Written by hand, a hair off one of yours', trouble: true },
  { id: 'legible', note: 'Pairings nobody can read', trouble: true },
  { id: 'widths', note: 'The same page at every size' },
  { id: 'figma', note: 'What has moved on in the file you follow', trouble: true },
];

const DESIGN_PARTS = DESIGN.parts;

/** How much is in each band. Null where a number would say nothing — nobody has
 *  asked for the pictures yet, or there is no file being followed. */
type Counts = { styles: number; motion: number; drift: number; legible: number; figma: number };

function countable(view: OverviewView): Counts {
  return {
    styles: view.styles?.tokens.length ?? 0,
    motion: view.reading.motion?.moves.length ?? 0,
    drift: view.reading.drifted.length,
    legible: view.reading.unreadable.length,
    figma: view.inStep?.moved.length ?? 0,
  };
}

function countOf(part: DesignPart, counts: Counts): number | null {
  if (part === 'widths') return null;
  return counts[part];
}

/**
 * The panel on the right: what is going on, what changed, what can be gone back
 * to, and what it cost — in that order, because that is the order the questions
 * are asked in.
 *
 * Everything here is a reading of something that happened elsewhere. Nothing
 * animates on arrival except the panel's own first fade: it is furniture, and
 * furniture that moves every time you look at it is furniture in the way.
 */
export default function Overview({
  view,
  onPutBack,
  onName,
  onKeep,
  onDismissPutBack,
  onShowSplit,
  onLimit,
  onSave,
  onOpenDesign,
  onOpenGraph,
  onSwitchBranch,
  onCreateBranch,
  onFetch,
  onFastForward,
  onShare,
  onWhose,

  onDecide,
  onHowMuch,
  onHandOver,
  onOpenLink,
  onOpenChanges,
  onOpenReview,
  onOpenFile,
  onKeepGoing,
  onStartAfter,
  onKeepAway,
  onDropAway,
  onAnswerAway,
  onSayToAway,
  onCompareWays,
  onStopWaiting,
  onTakeAll,
  onAddRepeat,
  onSwitchRepeat,
  onForgetRepeat,
}: Props) {
  const { now, git, research, references, versions, pictures, kept, putBack, spent, onAPlan, ceiling, busy, showMe } =
    view;
  const { artifacts, swatches } = view;
  /** A folder holding several projects is the one case the rest of this panel
   *  does not apply to: there are no folder-level lines of work to move, no
   *  folder-level save. The banner replaces both bands, and says where each
   *  project stands instead. */
  const several = view.repos.length >= 2;

  /* Whose history the timeline is showing. The first project until somebody
     says otherwise, and it survives a project being renamed out from under it
     by falling back to the first again rather than to nothing. */
  const [pickedRepo, setWhose] = useState<string | null>(null);
  const whose = several
    ? (view.repos.find((one) => one.name === pickedRepo) ?? view.repos[0] ?? null)
    : null;

  /* Told when the repo in front changes, and only then. The window above passes
     a fresh function down on every render, so depending on the function itself
     meant telling it on every commit — and being told asks for the panel again,
     which renders again. That loop ran at the speed of the machine, with a trip
     to the shell on each turn of it. */
  const tellWhose = useRef(onWhose);
  tellWhose.current = onWhose;
  useEffect(() => {
    tellWhose.current?.(whose?.name ?? null);
  }, [whose?.name]);

  /* What the last fetch found, by project folder name — '' for the folder
     itself. Held here rather than in the overview: a fetch is a press somebody
     made, and its answer belongs beside the press until they press again. */
  const [found, setFound] = useState<Readonly<Record<string, Fetched>>>({});
  const [working, setWorking] = useState<string | null>(null);

  /** What the press says: the operation it will run, or that it is running. */
  const originSays = (key: string, forward: boolean): string =>
    working === key
      ? forward
        ? ORIGIN.forwarding
        : ORIGIN.fetching
      : forward
        ? ORIGIN.forward
        : ORIGIN.fetch;

  const askOrigin = (repo: string | undefined, forward: boolean): void => {
    const ask = forward ? onFastForward : onFetch;
    if (ask === undefined || working !== null) return;
    const key = repo ?? '';
    setWorking(key);
    void ask(repo)
      .then((answer) => {
        if (answer !== null) setFound((was) => ({ ...was, [key]: answer }));
      })
      .finally(() => setWorking(null));
  };

  /* Which band of the panel is in front. Bands used to stack into one column
     that only got longer; now each has a home and nothing is buried. */
  const [tab, setTab] = useState<TabId>('work');
  /* Kept per machine: what somebody folded away stays folded. */
  const [lookedUpOpen, setLookedUpOpen] = useState(() => {
    try {
      return localStorage.getItem(LOOKED_UP) === 'open';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(LOOKED_UP, lookedUpOpen ? 'open' : 'shut');
    } catch { /* private mode */ }
  }, [lookedUpOpen]);

  /* A dot on the tab, not a number: the count matters once you are looking, and
     before that it is only worth knowing there is something. */
  const look = useMemo(() => countable(view), [view]);
  const trouble = look.drift + look.legible + look.figma;
  /* The same dot on Work, for the one thing on this panel that cannot move
     without a person: something that carried on and then stopped to ask. */
  const asking = (view.away?.pieces ?? []).some((one) => one.question !== null);

  const shownResearch = research.slice(-WINDOW);
  const moreResearch = research.length - shownResearch.length;
  const changedCount = git === null ? 0 : git.changedPaths;

  return (
    <aside className="overview" aria-label="What is going on">
      <div className="overview__tabs" role="tablist" aria-label="What to look at">
        {TABS.map((one) => (
          <button
            key={one.id}
            type="button"
            role="tab"
            id={`overview-tab-${one.id}`}
            aria-controls={`overview-panel-${one.id}`}
            aria-selected={tab === one.id}
            tabIndex={tab === one.id ? 0 : -1}
            className={`overview__tab ${tab === one.id ? 'overview__tab--here' : ''}`}
            onClick={() => setTab(one.id)}
            onKeyDown={(event) => {
              const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
              if (step === 0) return;
              event.preventDefault();
              const at = TABS.findIndex((other) => other.id === tab);
              const next = TABS[(at + step + TABS.length) % TABS.length];
              if (next !== undefined) setTab(next.id);
            }}
          >
            {one.name}
            {(one.id === 'look' && trouble > 0) || (one.id === 'work' && asking) ? (
              <span className="overview__tabmark" aria-hidden="true" />
            ) : null}
          </button>
        ))}
      </div>

      <div role="tabpanel" id="overview-panel-work" aria-labelledby="overview-tab-work" hidden={tab !== 'work'}>
      {/* Only while something is running. A permanent band that says "nothing"
          is a band that has taught you to stop looking at it. */}
      {/* Helpers used to be a band here. They belong beside the composer: this
          panel is a reading of what has already happened, and a helper is now. */}

      {/* Only while there is something to do with it. An empty "changes" band
          is a list of filenames nobody needed. The files themselves live in the
          project's own place now; what belongs here is the one thing the hand
          can do with them — save the changed set and step it forward — so the
          band is a single commit, said the way git says it and the way people
          say it. */}
      {/* Where the work sits, and the press that moves it. Its own band rather
          than a label inside the save band: it is the thing people reach for,
          and it was reachable before only by opening a different view. */}
      {/* A folder holding several projects shows where each one stands instead:
          there are no folder-level lines of work to move between, and pretending
          otherwise — showing one child's branches under the folder's name — is
          how somebody ends up switching the wrong thing. */}
      {several ? (
        <section className="overview__block">
          <h2 className="overview__title">{SEVERAL.heading}</h2>
          <ul className="projects">
            {view.repos.map((one) => {
              const stands = found[one.name];
              const forward = canFastForward(stands);
              return (
                <li key={one.path} className="projects__one">
                  <div className="projects__head">
                    <span className="projects__name">{one.name}</span>
                    <span className="projects__state">{repoState(one.git)}</span>
                  </div>
                  <div className="projects__row">
                    <Lines
                      branches={one.git.branches}
                      fallback={one.git.branch}
                      busy={busy}
                      onSwitch={(name) => onSwitchBranch(name, one.name)}
                      onCreate={(name) => onCreateBranch(name, one.name)}
                    />
                    <div className="projects__acts">
                      {one.git.dirty ? (
                        <button
                          type="button"
                          className="projects__act"
                          // Two rows of the same two words: the name has to be in
                          // the label, or one press cannot be told from another.
                          aria-label={`${SEVERAL.save} ${one.name}`}
                          onClick={() => onSave(one.name)}
                          disabled={busy}
                        >
                          {SEVERAL.save}
                        </button>
                      ) : null}
                      {onFetch === undefined ? null : (
                        <button
                          type="button"
                          className="projects__act"
                          aria-label={`${forward ? ORIGIN.forward : ORIGIN.fetch} ${one.name}`}
                          aria-busy={working === one.name}
                          onClick={() => askOrigin(one.name, forward)}
                          disabled={busy || working !== null}
                        >
                          {originSays(one.name, forward)}
                        </button>
                      )}
                    </div>
                  </div>
                  {stands === undefined ? null : (
                    <p className="projects__found">{saysFound(stands)}</p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {/* What the job is for, when somebody said. Above the project's own
          state, because it is the thing the state is in service of. */}
      {view.goal == null ? null : (
        <section className="overview__block">
          <h2 className="overview__title">{GOAL.heading}</h2>
          <p className="goalband__what">{view.goal.objective}</p>
          <p className="goalband__how">
            <span className={`goalband__state goalband__state--${view.goal.status}`}>
              {GOAL.states[view.goal.status]}
            </span>
            <span className="goalband__numbers">
              {GOAL.line(
                view.goal.done,
                view.goal.total,
                elapsedWords(view.goal.elapsed),
                view.goal.rounds,
              )}
            </span>
          </p>
        </section>
      )}

      {/* One band, not three. Where the project is, what is uncommitted, and
          the two presses that move either: a person reading three stacked
          bands to learn one thing is the whole of what was wrong here. */}
      {git === null || several ? null : (
        <section className="overview__block">
          <h2 className="overview__title">{GIT.heading}</h2>
          <div className="gitband">
            <Lines
              branches={git.branches}
              fallback={git.branch}
              busy={busy}
              onSwitch={onSwitchBranch}
              onCreate={onCreateBranch}
            />
            {onFetch === undefined ? null : (
              <button
                type="button"
                className="gitband__act"
                aria-busy={working === ''}
                title={canFastForward(found['']) && found['']?.upstream != null
                  ? `${ORIGIN.forward} to ${found[''].upstream}`
                  : ORIGIN.fetch}
                onClick={() => askOrigin(undefined, canFastForward(found['']))}
                disabled={busy || working !== null}
              >
                {originSays('', canFastForward(found['']))}
              </button>
            )}
          </div>

          {/* What changed, as one press that opens the change rather than a
              list of filenames nobody needed. */}
          <div className="gitband__row">
            {changedCount === 0 ? (
              <span className="gitband__quiet">{GIT.nothing}</span>
            ) : (
              <button
                type="button"
                className="gitband__changes"
                onClick={() => onOpenChanges?.()}
                disabled={onOpenChanges === undefined}
                title={GIT.open}
              >
                <span className="gitband__changesname">{GIT.files(changedCount)}</span>
                {GIT.lines(git.added, git.removed) === null ? null : (
                  <span className="gitband__lines">{GIT.lines(git.added, git.removed)}</span>
                )}
              </button>
            )}
            {changedCount === 0 ? null : (
              <button
                type="button"
                className="gitband__commit"
                onClick={() => onSave()}
                disabled={busy}
                title={COMMITTING.what(git.branch)}
              >
                {COMMITTING.heading}
              </button>
            )}
          </div>

          <p className="overview__summary">
            {found[''] === undefined ? saysStanding(standingOf(git)) : saysFound(found[''])}
          </p>
        </section>
      )}

      {/* What has finished and is waiting. One press per row into the Review
          screen, which is the one place work is decided about. */}
      {several ? null : <Waiting onOpen={onOpenReview} clock={view.clock} />}

      {/* A folder holding several projects keeps its own commit press: the band
          above is one project's, and there is no folder-level branch to be on. */}
      {git !== null && several && changedCount > 0 ? (
        <section className="overview__block">
          <h2 className="overview__title">{COMMITTING.heading}</h2>
          <p className="overview__summary">{COMMITTING.waiting(changedCount)}</p>
          <div className="overview__actions">
            <button
              type="button"
              className="overview__do"
              onClick={() => onSave()}
              disabled={busy}
              title={COMMITTING.what(git.branch)}
            >
              {COMMITTING.heading}
              {git.branch === null ? null : (
                <span className="overview__plainsay">{COMMITTING.onto(git.branch)}</span>
              )}
            </button>
          </div>
        </section>
      ) : null}

      <section className="overview__block">
        <button
          type="button"
          className="overview__fold"
          aria-expanded={lookedUpOpen}
          onClick={() => setLookedUpOpen((was) => !was)}
        >
          <h2 className="overview__title">Looked up</h2>
          <span className="overview__foldcount">{String(research.length)}</span>
          <span className="overview__foldmark" aria-hidden="true">{lookedUpOpen ? '⌄' : '›'}</span>
        </button>
        {!lookedUpOpen ? null : shownResearch.length === 0 ? (
          <p className="overview__quiet">Nothing looked up yet.</p>
        ) : (
          <>
            <ul className="overview__research">
              {shownResearch.map((entry) => (
                <li key={entry.id} className="overview__researchrow">
                  <p className="overview__query">&ldquo;{entry.query}&rdquo;</p>
                  {entry.state === 'failed' ? (
                    <p className="overview__researchnote">stopped</p>
                  ) : null}
                </li>
              ))}
            </ul>
            {moreResearch > 0 ? (
              <p className="overview__more">{`and ${moreResearch} earlier`}</p>
            ) : null}
          </>
        )}
        {!lookedUpOpen || now.filesRead === 0 ? null : (
          <p className="overview__read">
            {`${now.filesRead} ${now.filesRead === 1 ? 'file' : 'files'} of yours opened`}
          </p>
        )}
      </section>

      {references.length === 0 ? null : (
        <section className="overview__block">
          <h2 className="overview__title">Working from</h2>
          <ul className="overview__refs">
            {references.map((reference) => (
              <li key={reference.id} className="overview__ref">
                {reference.kind === 'image' && reference.preview !== undefined ? (
                  <img
                    className="overview__thumb"
                    src={reference.preview}
                    alt={`${reference.name}, sent with a message`}
                  />
                ) : (
                  <span className="overview__reficon" aria-hidden="true">
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
                      <path
                        d="M4 2.5h4.5L12 6v7.5H4z"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                      <path
                        d="M8.5 2.5V6H12"
                        stroke="currentColor"
                        strokeWidth="1.4"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </span>
                )}
                <span className="overview__reftext">
                  <span className="overview__refname">{reference.name}</span>
                  <span className="overview__refnote">{reference.note}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* The timeline takes the leftover height rather than stopping short, so a
          tall window fills with the best thing in the panel. */}
      {/* What the last turn made that is worth looking at rather than reading. */}
      {artifacts.length === 0 ? null : (
        <section className="overview__block">
          <h2 className="overview__title">Made</h2>
          <p className="overview__summary">
            {artifacts.length === 1
              ? 'One thing the last turn made. Press it to open the file.'
              : `${artifacts.length} things the last turn made. Press one to open the file.`}
          </p>
          <ul className="overview__refs">
            {artifacts.map((one) => (
              <li key={one.path} className="overview__ref">
                <button
                  type="button"
                  className="overview__made"
                  onClick={() => onOpenFile(one.path)}
                  title={one.path}
                  aria-label={`Open ${one.name} in your editor`}
                >
                  <span className="overview__reficon" aria-hidden="true">
                    {MADE_ICONS[one.kind]}
                  </span>
                  <span className="overview__reftext">
                    <span className="overview__refname">{one.name}</span>
                    <span className="overview__refnote">{one.note}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          {swatches.length === 0 ? null : <Swatches swatches={swatches} />}
        </section>
      )}

      <section className="overview__block">
        <Away
          away={view.away}
          elsewhere={view.elsewhere}
          project={view.project}
          now={view.clock}
          busy={busy}
          onKeepGoing={onKeepGoing}
          onStartAfter={onStartAfter}
          onKeep={onKeepAway}
          onDrop={onDropAway}
          onAnswer={onAnswerAway}
          onSay={onSayToAway}
          onAgainst={onCompareWays}
          onStopWaiting={onStopWaiting}
          onTakeAll={onTakeAll}
          onAddRepeat={onAddRepeat}
          onSwitchRepeat={onSwitchRepeat}
          onForgetRepeat={onForgetRepeat}
        />
      </section>

      </div>

      <div role="tabpanel" id="overview-panel-look" aria-labelledby="overview-tab-look" hidden={tab !== 'look'}>
      {/* A way in rather than the thing itself. All of this used to stack up in
          a 328px column: a palette four squares to a row, and a list of every
          movement in the project underneath it. It opens over the work now,
          with the width to be read. */}
      <section className="overview__block">
        <h2 className="overview__title">How it looks</h2>
        <ul className="overview__ways">
          {LOOKS.map((one) => {
            const found = countOf(one.id, look);
            return (
              <li key={one.id}>
                <button
                  type="button"
                  className="overview__way"
                  onClick={() => onOpenDesign(one.id)}
                >
                  <span className="overview__waytext">
                    <span className="overview__wayname">{DESIGN_PARTS[one.id]}</span>
                    <span className="overview__waynote">{one.note}</span>
                  </span>
                  {found === null || found === 0 ? null : (
                    <span
                      className={`overview__waycount ${one.trouble && found > 0 ? 'overview__waycount--wrong' : ''}`}
                    >
                      {found}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="overview__do" onClick={() => onOpenDesign('styles')}>
          Open it
          <kbd className="overview__key">⌘D</kbd>
        </button>
      </section>
      </div>

      <div role="tabpanel" id="overview-panel-history" aria-labelledby="overview-tab-history" hidden={tab !== 'history'}>
      <div className="overview__timeline">
        {whose === null ? null : (
          <div className="projects__strip" role="group" aria-label={SEVERAL.whose}>
            {view.repos.map((one) => (
              <button
                key={one.path}
                type="button"
                className={`projects__pick ${one.name === whose.name ? 'projects__pick--on' : ''}`}
                // One of them is the one being shown, rather than each being
                // separately on or off.
                aria-current={one.name === whose.name ? 'true' : undefined}
                onClick={() => setWhose(one.name)}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}
        <History
          versions={whose === null ? versions : (view.repoVersions[whose.name] ?? [])}
          pictures={pictures}
          kept={kept}
          putBack={putBack}
          onPutBack={(versionId) => onPutBack(versionId, whose?.name)}
          onName={(versionId, name) => onName(versionId, name, whose?.name)}
          onKeep={onKeep}
          onDismissPutBack={onDismissPutBack}
          onOpenGraph={() => onOpenGraph(whose?.name)}
          onSwitchBranch={(name) => onSwitchBranch(name, whose?.name)}
          onCreateBranch={(name) => onCreateBranch(name, whose?.name)}
          busy={busy}
          showMe={showMe}
          git={whose === null ? git : whose.git}
        />
      </div>

      </div>

      <div className="overview__foot">
        <Landing
          state={view.landing}
          busy={busy}
          showMe={showMe}
          going={view.going}
          outcome={view.landed}
          decided={view.decided}
          gate={view.gate}
          howMuch={view.howMuch}
          onDecide={onDecide}
          onHowMuch={onHowMuch}
          onUndo={(versionId) => onPutBack(versionId, whose?.name)}
          onHandOver={() => onHandOver(whose?.name)}
          onShare={() => onShare(whose?.name)}
          onOpenLink={onOpenLink}
        />
      </div>

      {spent === null ? null : (
        <CostMeter
          spent={spent.total}
          corner="panel"
          onAPlan={onAPlan}
          split={spent.split}
          usage={spent.usage}
          {...(ceiling === null ? {} : { limit: ceiling })}
          onDetails={onShowSplit}
          onLimit={onLimit}
        />
      )}
    </aside>
  );
}
