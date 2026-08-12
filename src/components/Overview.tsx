import { useMemo, useState } from 'react';
import Away from './Away';
import CostMeter from './CostMeter';
import { SAYS as DESIGN, type DesignPart } from './DesignView';
import Helpers from './Helpers';
import History from './History';
import Landing, { type Outcome } from './Landing';
import Swatches from './Swatches';
import type {
  Artifact,
  Away as AwayState,
  ChangedFile,
  Decision,
  EveryKind,
  GitSnapshot,
  InStep as InStepState,
  Landing as LandingState,
  PutBack,
  SavedVersion,
  StyleToken,
  Swatch,
} from '../lib/ipc';
import type { DesignReading } from '../design/reading';
import type { NowView, Reference, ResearchEntry } from '../lib/projects';
import type { SpendView } from '../lib/spend';
import './Overview.css';

/** Everything the panel draws, in one object. It was eight props and the next
 *  band would have made it twelve. */
export type OverviewView = {
  now: NowView;
  git: GitSnapshot | null;
  research: readonly ResearchEntry[];
  references: readonly Reference[];
  versions: readonly SavedVersion[];
  /** What each version looked like, by id. Absent ids have no picture. */
  pictures: Readonly<Record<string, string>>;
  /** The versions this project's owner chose to keep at the top. */
  kept: readonly string[];
  putBack: PutBack | null;
  spent: SpendView | null;
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
  /** Which of the two things that can send anywhere is going, if either is. */
  going: 'developer' | 'online' | null;
  /** What came of the last one that went. */
  landed: Outcome;
  /** What was just decided about work that was waiting, and how to undo it. */
  decided: { letIn: boolean; undoTo: string } | null;
  /** What is happening whether or not this window is open. Null until the shell
   *  has answered. */
  away: AwayState | null;
  /** Now, epoch ms, so the board draws the same twice. */
  clock: number;
};

type Props = {
  view: OverviewView;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  /** Keep a version at the top of the rail, or stop keeping it. */
  onKeep: (versionId: string, keep: boolean) => void;
  onDismissPutBack: () => void;
  onShowSplit: () => void;
  /** Open one changed file where the person actually edits things. */
  onOpenFile: (path: string) => void;
  /** Keep where the project stands right now, so it can be come back to. */
  onSave: () => void;
  /** Open everything about how the project looks, at one of its bands. */
  onOpenDesign: (part: DesignPart) => void;
  /** Open the whole history, drawn as lines. */
  onOpenGraph: () => void;
  /** Write a page of what changed, for somebody who is not you. */
  onShare: () => void;
  /** Check work in a copy before it reaches the files, or stop. */
  onHoldBack: (on: boolean) => void;
  /** Let the work that is waiting in, or set it aside. */
  onDecide: (letIn: boolean) => void;
  /** Write the work up and put it where a developer picks it up. */
  onHandOver: () => void;
  /** Put the finished project on the internet. */
  onPutOnline: () => void;
  /** Open an address in the person's own browser. */
  onOpenLink: (address: string) => void;

  /* ---------------------------------------------- while you are not looking */

  /** Get on with something whether or not this window stays open. */
  onKeepGoing: (text: string) => void;
  /** Take one of those results into the project. */
  onKeepAway: (id: string) => void;
  /** Stop one, or let its result go. */
  onDropAway: (id: string) => void;
  /** Answer the question one of them stopped on. */
  onAnswerAway: (id: string, callId: string, decision: Decision) => void;
  onAddRepeat: (
    doing: string,
    every: EveryKind,
    at: { hour: number; minute: number },
    on?: number,
  ) => void;
  onSwitchRepeat: (id: string, on: boolean) => void;
  onForgetRepeat: (id: string) => void;
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

/** The last part of a path is what people call the file. The rest is filing. */
function leaf(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  return parts[parts.length - 1] ?? path;
}

/** Where it lives, for the second line. Empty at the top of the project. */
function folder(path: string): string {
  const parts = path.split('/').filter((part) => part !== '');
  return parts.slice(0, -1).join('/');
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
  onOpenFile,
  onSave,
  onOpenDesign,
  onOpenGraph,
  onShare,
  onHoldBack,
  onDecide,
  onHandOver,
  onPutOnline,
  onOpenLink,
  onKeepGoing,
  onKeepAway,
  onDropAway,
  onAnswerAway,
  onAddRepeat,
  onSwitchRepeat,
  onForgetRepeat,
}: Props) {
  const { now, git, research, references, versions, pictures, kept, putBack, spent, busy, showMe } =
    view;
  const { artifacts, swatches } = view;

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
  const files: readonly ChangedFile[] = git?.files ?? [];
  const shownFiles = files.slice(0, WINDOW);
  const moreFiles = (git === null ? 0 : git.unstaged + git.staged + git.untracked) - shownFiles.length;

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
      {busy && (now.step !== null || now.helpers.length > 0) ? (
        <section className="overview__block overview__block--now">
          <h2 className="overview__title">Now</h2>
          {now.step === null ? null : (
            <p className="overview__step">
              <span className="overview__pulse" aria-hidden="true" />
              <span className="overview__steptext">
                <span className="overview__steplabel">{now.step.label}</span>
                {now.step.detail === undefined ? null : (
                  <span className="overview__stepdetail">{now.step.detail}</span>
                )}
              </span>
            </p>
          )}
        </section>
      ) : null}

      {/* Every helper, what it was asked and what it has said. Nobody else
          shows this, and it is the most interesting thing in a long sitting. */}
      {now.helpers.length === 0 ? null : (
        <section className="overview__block">
          <Helpers helpers={now.helpers} />
        </section>
      )}

      <section className="overview__block">
        <h2 className="overview__title">Changes</h2>
        {git === null ? (
          <p className="overview__quiet">
            Nothing is being kept for this folder yet. The first time I change
            something, I will start saving moments you can come back to.
          </p>
        ) : shownFiles.length === 0 ? (
          <p className="overview__quiet">Everything here is saved.</p>
        ) : (
          <>
            <ul className="overview__files">
              {shownFiles.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    className="overview__file"
                    onClick={() => onOpenFile(file.path)}
                    title={`Open ${file.path}`}
                  >
                    <span className="overview__filetext">
                      <span className="overview__filename">{leaf(file.path)}</span>
                      {folder(file.path) === '' ? null : (
                        <span className="overview__filewhere">{folder(file.path)}</span>
                      )}
                    </span>
                    {file.kind === 'new' ? <span className="overview__filenew">new</span> : null}
                  </button>
                </li>
              ))}
            </ul>
            {moreFiles > 0 ? <p className="overview__more">{`and ${moreFiles} more`}</p> : null}
            {/* The one thing worth doing about unsaved work, named after what
                it makes: another row in the timeline below. */}
            <button type="button" className="overview__do" onClick={onSave} disabled={busy}>
              Save a version now
            </button>
          </>
        )}
      </section>

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
          <ul className="overview__refs">
            {artifacts.map((one) => (
              <li key={one.path} className="overview__ref">
                <span className="overview__reficon" aria-hidden="true" />
                <span className="overview__reftext">
                  <span className="overview__refname">{one.name}</span>
                  <span className="overview__refnote">{one.note}</span>
                </span>
              </li>
            ))}
          </ul>
          {swatches.length === 0 ? null : <Swatches swatches={swatches} />}
        </section>
      )}

      <section className="overview__block">
        <Away
          away={view.away}
          now={view.clock}
          busy={busy}
          onKeepGoing={onKeepGoing}
          onKeep={onKeepAway}
          onDrop={onDropAway}
          onAnswer={onAnswerAway}
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
        <History
          versions={versions}
          pictures={pictures}
          kept={kept}
          putBack={putBack}
          onPutBack={onPutBack}
          onName={onName}
          onKeep={onKeep}
          onDismissPutBack={onDismissPutBack}
          onOpenGraph={onOpenGraph}
          busy={busy}
          showMe={showMe}
          git={git}
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
          onHoldBack={onHoldBack}
          onDecide={onDecide}
          onUndo={onPutBack}
          onHandOver={onHandOver}
          onPutOnline={onPutOnline}
          onShare={onShare}
          onOpenLink={onOpenLink}
        />
      </div>

      {spent === null ? null : <CostMeter spent={spent.total} corner onDetails={onShowSplit} />}
    </aside>
  );
}
