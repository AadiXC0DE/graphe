import { useEffect, useState } from 'react';

import { bridge } from '../lib/bridge';
import type { Trouble, WorktreePlan } from '../lib/ipc';
import './NewWorktree.css';

type Props = {
  /** The project the copy would be made in, or null when nothing is open. */
  project: string | null;
  onClose: () => void;
  /** Handed the address of the conversation started in the copy. */
  onMade: (address: string | null) => void;
};

export const SAYS = {
  label: 'New worktree',
  lead: 'A copy of this project on a branch of its own, so another chat can work at the same time without writing the same files.',
  folder: 'Folder',
  starting: 'Starting from',
  detached: 'the last commit',
  clean: 'Your uncommitted work stays in your project folder. The copy starts from the last commit.',
  dirty: (count: number): string =>
    count === 1
      ? 'One file changed here does not come with it: a copy starts from the last commit.'
      : `${String(count)} files changed here do not come with it: a copy starts from the last commit.`,
  create: 'Create worktree',
  cancel: 'Cancel',
  loading: 'Working out where the copy would go.',
  failed: 'I could not work out where a copy would go.',
} as const;

/**
 * The one place a checkout is made on purpose.
 *
 * Everything a person needs in order to decide is on the card before anything
 * exists: the folder, the commit it would start from, and what would be left
 * behind. A copy starts from a commit, so uncommitted work is the thing that
 * surprises people, and it is said rather than discovered afterwards.
 */
export default function NewWorktree({ project, onClose, onMade }: Props) {
  const [plan, setPlan] = useState<WorktreePlan | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [busy, setBusy] = useState(false);

  // Keyed on the project alone: the where object is rebuilt every render, and
  // asking again on every render would ask the shell forever.
  useEffect(() => {
    let live = true;
    setPlan(null);
    setTrouble(null);
    void bridge.worktreePlan(project === null ? {} : { project }).then((answer) => {
      if (!live) return;
      if (answer.ok) setPlan(answer.value);
      else setTrouble(answer.trouble);
    });
    return () => {
      live = false;
    };
  }, [project]);

  const make = (): void => {
    if (busy || plan === null || !plan.possible) return;
    setBusy(true);
    void bridge
      .worktreeNew(plan.baseSha === null ? {} : { base: plan.baseSha }, project === null ? {} : { project })
      .then((answer) => {
        setBusy(false);
        if (!answer.ok) {
          setTrouble(answer.trouble);
          return;
        }
        onMade(answer.value.address ?? null);
      });
  };

  const short = plan?.baseSha === null || plan?.baseSha === undefined ? null : plan.baseSha.slice(0, 7);

  return (
    <section className="newworktree" role="group" aria-label={SAYS.label}>
      <h2 className="newworktree__head">{SAYS.label}</h2>
      <p className="newworktree__lead">{SAYS.lead}</p>

      {trouble !== null ? (
        <p className="newworktree__trouble">{trouble.because}</p>
      ) : plan === null ? (
        <p className="newworktree__quiet">{SAYS.loading}</p>
      ) : !plan.possible ? (
        <p className="newworktree__trouble">{plan.because ?? SAYS.failed}</p>
      ) : (
        <>
          <dl className="newworktree__facts">
            <dt>{SAYS.folder}</dt>
            <dd className="newworktree__path">{plan.folder}</dd>
            <dt>{SAYS.starting}</dt>
            <dd>
              {plan.baseBranch === null ? SAYS.detached : plan.baseBranch}
              {short === null ? null : <code className="newworktree__sha"> {short}</code>}
            </dd>
          </dl>
          <p className="newworktree__dirty">
            {plan.leftBehind.length === 0 ? SAYS.clean : SAYS.dirty(plan.leftBehind.length)}
          </p>
        </>
      )}

      <div className="newworktree__actions">
        {/* Safe first in the DOM, so it is also first for the keyboard. */}
        <button type="button" className="newworktree__button newworktree__button--keep" onClick={onClose}>
          {SAYS.cancel}
        </button>
        <button
          type="button"
          className="newworktree__button newworktree__button--make"
          onClick={make}
          disabled={busy || plan === null || !plan.possible}
        >
          {SAYS.create}
        </button>
      </div>
    </section>
  );
}
