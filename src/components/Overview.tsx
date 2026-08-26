import { type ReactElement, useMemo, useState } from 'react';
import Away from './Away';
import CostMeter from './CostMeter';
import { SAYS as DESIGN, type DesignPart } from './DesignView';
import History from './History';
import Lines from './Lines';
import { LINE_WORDS } from '../lib/lines';
import Landing, { type Outcome } from './Landing';
import type { Verdict } from '../design/gate';
import Swatches from './Swatches';
import type {
  Artifact,
  Away as AwayState,
  Decision,
  EveryKind,
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
import './Overview.css';

/** Words for the folder that holds several projects. Named for what somebody
 *  sees — the projects, and where each stands — not for how they are found. */
const SEVERAL = {
  heading: 'The projects',
  changed: 'changed',
  save: 'Save',
  see: 'See it',
  /** The strip above the timeline, when there is more than one timeline. */
  whose: 'Whose history',
} as const;

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
  /** Open the whole history, drawn as lines. */
  onOpenGraph: () => void;
  /** Move the project onto another of its lines of work. */
  onSwitchBranch: (name: string, repo?: string) => void;
  /** Start a new line of work and move the project onto it. */
  onCreateBranch: (name: string, repo?: string) => void;
  /** Put one of the projects here in front of you, running. */
  onSeeProject?: (repo: string) => void;
  /** Write a page of what changed, for somebody who is not you. */
  onShare: () => void;

  /** Let the work that is waiting in, or set it aside. */
  onDecide: (letIn: boolean) => void;
  /** Move the line the work has to cross before it is stopped. */
  onHowMuch: (id: string) => void;
  /** Write the work up and put it where a developer picks it up. */
  onHandOver: () => void;
  /** Open an address in the person's own browser. */
  onOpenLink: (address: string) => void;
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
  { id: 'styles', note: 'Colour, type, spacing — move any of them' },
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
  onSeeProject,
  onShare,

  onDecide,
  onHowMuch,
  onHandOver,
  onOpenLink,
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

  /* Which band of the panel is in front. Bands used to stack into one column
     that only got longer; now each has a home and nothing is buried. */
  const [tab, setTab] = useState<TabId>('work');

  /* A dot on the tab, not a number: the count matters once you are looking, and
     before that it is only worth knowing there is something. */
  const look = useMemo(() => countable(view), [view]);
  const trouble = look.drift + look.legible + look.figma;
  /* The same dot on Work, for the one thing on this panel that cannot move
     without a person: something that carried on and then stopped to ask. */
  const asking = (view.away?.pieces ?? []).some((one) => one.question !== null);

  const shownResearch = research.slice(-WINDOW);
  const moreResearch = research.length - shownResearch.length;
  const changedCount = git === null ? 0 : git.unstaged + git.staged + git.untracked;

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
            {view.repos.map((one) => (
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
                        onClick={() => onSave(one.name)}
                        disabled={busy}
                      >
                        {SEVERAL.save}
                      </button>
                    ) : null}
                    {onSeeProject === undefined ? null : (
                      <button
                        type="button"
                        className="projects__act"
                        onClick={() => onSeeProject(one.name)}
                        disabled={busy}
                      >
                        {SEVERAL.see}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {git === null || several ? null : (
        <section className="overview__block">
          <h2 className="overview__title">
            {LINE_WORDS.heading}
            <span className="overview__plainly">{LINE_WORDS.plainly}</span>
          </h2>
          <Lines
            branches={git.branches}
            fallback={git.branch}
            busy={busy}
            onSwitch={onSwitchBranch}
            onCreate={onCreateBranch}
          />
        </section>
      )}

      {git !== null && changedCount > 0 ? (
        <section className="overview__block">
          <h2 className="overview__title">Save / commit</h2>
          <p className="overview__summary">
            {changedCount === 1
              ? 'One change is waiting to be saved.'
              : `${changedCount} changes are waiting to be saved.`}
          </p>
          <div className="overview__actions">
            <button type="button" className="overview__do" onClick={() => onSave()} disabled={busy}>
              Commit
              <span className="overview__plainsay">Save it now</span>
            </button>
          </div>
        </section>
      ) : null}

      <section className="overview__block">
        <h2 className="overview__title">Looked up</h2>
        {shownResearch.length === 0 ? (
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
        {now.filesRead > 0 ? (
          <p className="overview__read">
            {`${now.filesRead} ${now.filesRead === 1 ? 'file' : 'files'} of yours opened`}
          </p>
        ) : null}
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
                aria-pressed={one.name === whose.name}
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
          onOpenGraph={onOpenGraph}
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
          onUndo={onPutBack}
          onHandOver={onHandOver}
          onShare={onShare}
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
