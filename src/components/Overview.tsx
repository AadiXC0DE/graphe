import CostMeter from './CostMeter';
import Helpers from './Helpers';
import Responsive from './Responsive';
import Styles from './Styles';
import Swatches from './Swatches';
import Versions from './Versions';
import type {
  Artifact,
  ChangedFile,
  GitSnapshot,
  Look,
  PutBack,
  SavedVersion,
  StyleToken,
  Swatch,
} from '../lib/ipc';
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
  putBack: PutBack | null;
  spent: SpendView | null;
  busy: boolean;
  showMe: boolean;
  /** The three widths, once somebody has asked. */
  looks: readonly Look[];
  looksSay: string;
  checkingWidths: boolean;
  /** Things the last turn made that are worth looking at. */
  artifacts: readonly Artifact[];
  swatches: readonly Swatch[];
  /** This project's own tokens, and where they live. */
  styles: { file: string; tokens: readonly StyleToken[] } | null;
};

type Props = {
  view: OverviewView;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  onDismissPutBack: () => void;
  onShowSplit: () => void;
  /** Open one changed file where the person actually edits things. */
  onOpenFile: (path: string) => void;
  /** Keep where the project stands right now, so it can be come back to. */
  onSave: () => void;
  /** Photograph the project at three widths. */
  onCheckWidths: () => void;
  /** Write a page of what changed, for somebody who is not you. */
  onShare: () => void;
  /** Change one design token directly. */
  onNudge: (name: string, value: string) => void;
};

/** How many rows a band holds before it says "and more". The panel is a summary
 *  of what the work looked like; the thread is the archive. */
const WINDOW = 6;

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
  onDismissPutBack,
  onShowSplit,
  onOpenFile,
  onSave,
  onCheckWidths,
  onShare,
  onNudge,
}: Props) {
  const { now, git, research, references, versions, putBack, spent, busy, showMe } = view;
  const { looks, looksSay, checkingWidths, artifacts, swatches, styles } = view;

  const shownResearch = research.slice(-WINDOW);
  const moreResearch = research.length - shownResearch.length;
  const files: readonly ChangedFile[] = git?.files ?? [];
  const shownFiles = files.slice(0, WINDOW);
  const moreFiles = (git === null ? 0 : git.unstaged + git.staged + git.untracked) - shownFiles.length;

  return (
    <aside className="overview" aria-label="What is going on">
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

      {styles === null ? null : (
        <section className="overview__block">
          <h2 className="overview__title">Styles</h2>
          <Styles tokens={styles.tokens} file={styles.file} onNudge={onNudge} busy={busy} />
        </section>
      )}

      <section className="overview__block">
        <h2 className="overview__title">On a phone</h2>
        <Responsive looks={looks} says={looksSay} busy={checkingWidths} onCheck={onCheckWidths} />
      </section>

      <div className="overview__timeline">
        <Versions
          versions={versions}
          putBack={putBack}
          onPutBack={onPutBack}
          onName={onName}
          onDismissPutBack={onDismissPutBack}
          busy={busy}
          showMe={showMe}
        />
      </div>

      <div className="overview__foot">
        <button type="button" className="overview__do" onClick={onShare} disabled={busy}>
          Send this to someone
        </button>
      </div>

      {spent === null ? null : <CostMeter spent={spent.total} corner onDetails={onShowSplit} />}
    </aside>
  );
}
