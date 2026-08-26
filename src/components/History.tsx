import { useState } from 'react';
import Versions from './Versions';
import type { GitSnapshot, GitBranch, PutBack, SavedVersion } from '../lib/ipc';
import './History.css';

type Props = {
  versions: readonly SavedVersion[];
  pictures?: Readonly<Record<string, string>>;
  kept?: readonly string[];
  putBack: PutBack | null;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  onKeep?: (versionId: string, keep: boolean) => void;
  onDismissPutBack: () => void;
  /** Open the whole thing, drawn as lines, over the conversation. */
  onOpenGraph: () => void;
  /** Move the project onto another of its lines of work. */
  onSwitchBranch: (name: string) => void;
  /** Start a new line of work and move the project onto it. */
  onCreateBranch: (name: string) => void;
  busy?: boolean;
  showMe?: boolean;
  git: GitSnapshot | null;
};

export const SAYS = {
  heading: 'History',
  branches: 'Branches',
  newBranch: 'New branch',
  newBranchPlaceholder: 'feature/short-name',
  create: 'Create',
  graph: 'Commit graph',
  graphHint: 'Every commit, what came after what, and where two branches merged.',
} as const;

/** A branch name, as it is really spelled. */
function branchName(branch: GitBranch): string {
  return branch.name;
}

/** The chip that says how a branch relates to where it came from: ahead of the
 *  shared copy, behind it, both, or neither — in which case nothing is said. */
function relation(branch: GitBranch): string | null {
  const parts: string[] = [];
  if (branch.ahead > 0) parts.push(`${branch.ahead} ahead`);
  if (branch.behind > 0) parts.push(`${branch.behind} behind`);
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * Everything the project has been, in the panel.
 *
 * Two readings of one thing. The pictures are here, where they fit: a card is
 * small and the panel is a column of them. The lines — what came after what,
 * which branch, which id — need the width of the work, so they open over it.
 *
 * Above both, for the technical user who asks where their branch is: the lines
 * of work, the one the project is on marked, each with how far it is from the
 * copy it came from, and the way onto another one.
 */
export default function History({
  versions,
  pictures,
  kept,
  putBack,
  onPutBack,
  onName,
  onKeep,
  onDismissPutBack,
  onOpenGraph,
  onSwitchBranch,
  onCreateBranch,
  busy,
  showMe,
  git,
}: Props) {
  const [naming, setNaming] = useState(false);
  const [draft, setDraft] = useState('');

  const branches = git?.branches ?? [];

  const create = () => {
    const name = draft.trim();
    if (name === '') return;
    onCreateBranch(name);
    setDraft('');
    setNaming(false);
  };

  return (
    <div className="history">
      {/* No second "History" here: the tab above the panel already says where
          this is, and a small word repeated in the corner is noise, not a
          heading. The panel opens straight onto its content. */}

      {git === null || branches.length === 0 ? null : (
        <section className="branches" aria-label={SAYS.branches}>
          <h3 className="branches__heading">{SAYS.branches}</h3>

          <ul className="branches__list">
            {branches.map((branch) => (
              <li key={branch.name}>
                {branch.current ? (
                  <div className="branches__row branches__row--current" aria-current="true">
                    <span className="branches__dot" aria-hidden="true" />
                    <span className="branches__name">{branchName(branch)}</span>
                    <span className="branches__meta">
                      {branch.upstream === null
                        ? 'not shared yet'
                        : (relation(branch) ?? 'in step')}
                    </span>
                  </div>
                ) : (
                  <button
                    type="button"
                    className="branches__row branches__row--switch"
                    onClick={() => onSwitchBranch(branch.name)}
                    title={SAYS.graphHint}
                  >
                    <span className="branches__name">{branchName(branch)}</span>
                    <span className="branches__message">
                      {branch.message === '' ? branch.upstream ?? 'no commits yet' : branch.message}
                    </span>
                    {relation(branch) === null ? null : (
                      <span className="branches__meta">{relation(branch)}</span>
                    )}
                  </button>
                )}
              </li>
            ))}
          </ul>

          {naming ? (
            <div className="branches__new">
              <input
                className="branches__input"
                value={draft}
                placeholder={SAYS.newBranchPlaceholder}
                autoFocus
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') create();
                  if (event.key === 'Escape') {
                    // Closes this and only this — the press must not reach the
                    // run going on behind it.
                    event.preventDefault();
                    setNaming(false);
                    setDraft('');
                  }
                }}
                aria-label={SAYS.newBranchPlaceholder}
              />
              <button type="button" className="branches__create" onClick={create} disabled={draft.trim() === ''}>
                {SAYS.create}
              </button>
            </div>
          ) : (
            <button type="button" className="branches__newbtn" onClick={() => setNaming(true)}>
              + {SAYS.newBranch}
            </button>
          )}
        </section>
      )}

      <Versions
        versions={versions}
        pictures={pictures}
        kept={kept}
        putBack={putBack}
        onPutBack={onPutBack}
        onName={onName}
        {...(onKeep === undefined ? {} : { onKeep })}
        onDismissPutBack={onDismissPutBack}
        busy={busy}
        showMe={showMe}
        bare
      />

      {versions.length === 0 ? null : (
        <button type="button" className="history__do" onClick={onOpenGraph}>
          <span className="history__dowords">{SAYS.graph}</span>
          <span className="history__doarrow" aria-hidden="true">
            →
          </span>
        </button>
      )}
    </div>
  );
}