import CostMeter from './CostMeter';
import Versions from './Versions';
import type { PutBack, SavedVersion } from '../lib/ipc';
import type { Reference, ResearchEntry } from '../lib/projects';
import type { SpendView } from '../lib/spend';
import './Overview.css';

type Props = {
  /** The git state of the project in front, or null when it has no git. */
  git: { branch: string | null; dirty: boolean; unstaged: number; staged: number; untracked: number; ahead: number; behind: number } | null;
  /** The web searches this conversation has made, in order. */
  research: readonly ResearchEntry[];
  /** The things the agent was sent to work from. */
  references: readonly Reference[];
  versions: readonly SavedVersion[];
  putBack: PutBack | null;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  onDismissPutBack: () => void;
  busy?: boolean;
  showMe?: boolean;
  spent: SpendView | null;
  onShowSplit: () => void;
};

/** How many research lines the overview holds before saying "and more". The log
 *  is a summary of what the work looked like, not an archive; the thread is the
 *  archive. */
const RESEARCH_WINDOW = 6;

/**
 * The overview: the story of the work, folded against the right edge.
 *
 * It arrives the first time there is anything to tell — git state, a search,
 * a reference, a second version — and then it stays (the progressive-disclosure
 * rule from notes/strategy/UI-DESIGN.md, applied the same way the version rail
 * always applied it). Everything in it is a reading of things that happened
 * elsewhere:
 *
 *  - **Git** is what the shell reported when the folder opened and when a
 *    sitting settled. Written the way a designer would say it — *saved* and
 *    *not saved* — because "clean" and "dirty" are the vocabulary of a machine
 *    that never made anything.
 *  - **Research** is derived from the thread rather than logged a second time:
 *    the web searches this project has made, in the words they were asked in.
 *    Silence is the success state — a search that worked leaves no marker.
 *  - **References** are the pictures and design files that were sent along
 *    with a message. Recorded the moment they are sent, because they shaped
 *    the work whether or not the conversation still mentions them.
 *  - **Timeline** is the version rail, mounted here instead of on its own —
 *    one panel on the right, one story.
 *  - The **cost meter** docks into the foot of the panel, the same way it
 *    docked into the foot of the rail.
 *
 * Nothing here animates on arrival except the panel's own first fade — it is
 * furniture, and furniture that moves every time you look at it is furniture
 * in the way.
 */
export default function Overview({
  git,
  research,
  references,
  versions,
  putBack,
  onPutBack,
  onName,
  onDismissPutBack,
  busy,
  showMe,
  spent,
  onShowSplit,
}: Props) {
  const shownResearch = research.slice(-RESEARCH_WINDOW);
  const more = research.length - shownResearch.length;

  const changed = git === null ? 0 : git.unstaged + git.staged;
  const gitSub: string[] = [];
  if (git !== null) {
    if (git.staged > 0) gitSub.push(`${git.staged} staged`);
    if (git.ahead > 0 || git.behind > 0) {
      gitSub.push(
        git.ahead > 0 && git.behind > 0
          ? `${git.ahead} ahead, ${git.behind} behind`
          : git.ahead > 0
            ? `${git.ahead} ahead of the remote`
            : `${git.behind} behind the remote`,
      );
    }
  }

  return (
    <aside className="overview" aria-label="Project overview">
      <section className="overview__block">
        <h2 className="overview__title">Git</h2>
        {git == null ? (
          <p className="overview__git-empty">
            This folder is not in git yet, so there is nothing to put back
            before the work begins.
          </p>
        ) : (
          <div className="overview__git">
            <p className="overview__gitline">
              <span className="overview__branch">
                {git.branch === null ? 'no commits yet' : git.branch}
              </span>
              <span className="overview__gitstate">
                {git.dirty
                  ? changed === 0 && git.untracked > 0
                    ? `${git.untracked} new ${git.untracked === 1 ? 'file' : 'files'}`
                    : `${changed} ${changed === 1 ? 'file' : 'files'} changed${git.untracked > 0 ? `, ${git.untracked} new` : ''}`
                  : 'everything saved'}
              </span>
            </p>
            {gitSub.length === 0 ? null : (
              <p className="overview__gitsub">{gitSub.join(' · ')}</p>
            )}
          </div>
        )}
      </section>

      {shownResearch.length === 0 ? null : (
        <section className="overview__block">
          <h2 className="overview__title">Research</h2>
          <ul className="overview__research">
            {shownResearch.map((entry) => (
              <li key={entry.id} className="overview__researchrow">
                <p className="overview__query">
                  &ldquo;{entry.query}&rdquo;
                </p>
                {entry.state === 'failed' ? (
                  <p className="overview__researchnote">stopped</p>
                ) : null}
              </li>
            ))}
          </ul>
          {more > 0 ? (
            <p className="overview__more">{`and ${more} earlier`}</p>
          ) : null}
        </section>
      )}

      {references.length === 0 ? null : (
        <section className="overview__block">
          <h2 className="overview__title">References</h2>
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

      {spent === null ? null : <CostMeter spent={spent.total} corner onDetails={onShowSplit} />}
    </aside>
  );
}