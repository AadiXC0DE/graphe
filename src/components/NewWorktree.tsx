import { useEffect, useState } from 'react';

import { bridge } from '../lib/bridge';
import type { Dependencies, Trouble, WorktreePlan } from '../lib/ipc';
import { dependenciesNotStarted, setupWords } from '../projects/setup';
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
  carries: 'Carries into the copy',
  carriesNone: 'Nothing here is ignored by git, so the copy gets the tracked files and nothing else.',
  carriesNote:
    'These are the files git ignores. A copy gets the tracked files only, so anything the project needs and keeps out of git has to be picked here, and picked once: the choice is remembered for this project.',
  create: 'Create worktree',
  cancel: 'Cancel',
  loading: 'Working out where the copy would go.',
  failed: 'I could not work out where a copy would go.',
  installing: 'Install dependencies',
  installingNow: 'Installing…',
  installFailed: 'Try the install again',
  done: 'Done',
  installsLater:
    'Dependencies are not installed in a new copy. Installing them is its own step, once the copy exists.',
  nothingToInstall: 'This project has nothing at the top of it to install.',
} as const;

/**
 * The one place a checkout is made on purpose.
 *
 * Everything a person needs in order to decide is on the card before anything
 * exists: the folder, the commit it would start from, what would be left
 * behind, and which gitignored files travel with it — the last of these being
 * the choice that decides whether the copy can run at all. The dependencies are
 * not installed here: making a copy and installing into it fail for different
 * reasons, and a copy that exists with nothing installed says so rather than
 * pretending otherwise.
 */
export default function NewWorktree({ project, onClose, onMade }: Props) {
  const [plan, setPlan] = useState<WorktreePlan | null>(null);
  const [trouble, setTrouble] = useState<Trouble | null>(null);
  const [busy, setBusy] = useState(false);
  /** The copy that now exists, and where its install has got to. */
  const [made, setMade] = useState<{ address: string | null; state: Dependencies } | null>(null);

  // Keyed on the project alone: the where object is rebuilt every render, and
  // asking again on every render would ask the shell forever.
  useEffect(() => {
    let live = true;
    setPlan(null);
    setTrouble(null);
    setMade(null);
    void bridge.worktreePlan(project === null ? {} : { project }).then((answer) => {
      if (!live) return;
      if (answer.ok) setPlan(answer.value);
      else setTrouble(answer.trouble);
    });
    return () => {
      live = false;
    };
  }, [project]);

  /* A tick is written down as it is made, not when the copy is made: the
     answer is the project's, and somebody decides it once. The shell answers
     with the reading as it is now, which is what gets drawn — a file somebody
     edited by hand in between is dropped rather than copied. */
  const pick = (path: string, on: boolean): void => {
    if (plan === null || busy) return;
    const wanted = plan.setup.candidates
      .filter((one) => (one.path === path ? on : one.chosen))
      .map((one) => one.path);
    setBusy(true);
    void bridge.setupChoose(wanted, project === null ? {} : { project }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setTrouble(answer.trouble);
        return;
      }
      setPlan((was) => (was === null ? was : { ...was, setup: answer.value }));
    });
  };

  const make = (): void => {
    if (busy || plan === null || !plan.possible || made !== null) return;
    setBusy(true);
    void bridge
      .worktreeNew(plan.baseSha === null ? {} : { base: plan.baseSha }, project === null ? {} : { project })
      .then((answer) => {
        setBusy(false);
        if (!answer.ok) {
          setTrouble(answer.trouble);
          return;
        }
        /* The copy exists and its conversation has started, and nothing is
           installed in it. Both facts are on the card now: the conversation is
           opened when the person leaves, so the install is a step somebody
           pressed rather than something that happened to them. */
        setMade({ address: answer.value.address ?? null, state: dependenciesNotStarted });
      });
  };

  const install = (): void => {
    if (busy || made === null) return;
    setBusy(true);
    setMade({ ...made, state: { how: 'running' } });
    void bridge.setupInstall(project === null ? {} : { project }).then((answer) => {
      setBusy(false);
      if (!answer.ok) {
        setTrouble(answer.trouble);
        setMade((was) => (was === null ? was : { ...was, state: dependenciesNotStarted }));
        return;
      }
      setTrouble(null);
      setMade((was) => (was === null ? was : { ...was, state: answer.value.state }));
    });
  };

  const leave = (): void => {
    if (made === null) {
      onClose();
      return;
    }
    onMade(made.address);
  };

  const short = plan?.baseSha === null || plan?.baseSha === undefined ? null : plan.baseSha.slice(0, 7);
  const installs = plan?.setup.plan ?? null;

  return (
    <section className="newworktree" role="group" aria-label={SAYS.label}>
      <h2 className="newworktree__head">{SAYS.label}</h2>
      <p className="newworktree__lead">{SAYS.lead}</p>

      {trouble !== null ? <p className="newworktree__trouble">{trouble.because}</p> : null}

      {made !== null ? (
        <>
          <p className="newworktree__dirty">
            {installs === null ? SAYS.nothingToInstall : SAYS.installsLater}
          </p>
          <p className="newworktree__quiet">{setupWords.dependencies(made.state)}</p>
        </>
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

          <p className="newworktree__carriessays">{SAYS.carries}</p>
          {plan.setup.candidates.length === 0 ? (
            <p className="newworktree__quiet">{SAYS.carriesNone}</p>
          ) : (
            <>
              <ul className="newworktree__carries scroll--auto">
                {plan.setup.candidates.map((one) => (
                  <li key={one.path} className="newworktree__carry">
                    <label className="newworktree__carrylabel">
                      <input
                        type="checkbox"
                        checked={one.chosen}
                        disabled={busy}
                        onChange={(event) => pick(one.path, event.target.checked)}
                      />
                      <code className="newworktree__carrypath">{one.path}</code>
                    </label>
                  </li>
                ))}
              </ul>
              <p className="newworktree__carrynote">{SAYS.carriesNote}</p>
            </>
          )}
        </>
      )}

      <div className="newworktree__actions">
        {/* Safe first in the DOM, so it is also first for the keyboard. */}
        <button type="button" className="newworktree__button newworktree__button--keep" onClick={leave}>
          {made === null ? SAYS.cancel : SAYS.done}
        </button>
        {made === null ? (
          <button
            type="button"
            className="newworktree__button newworktree__button--make"
            onClick={make}
            disabled={busy || plan === null || !plan.possible}
          >
            {SAYS.create}
          </button>
        ) : installs === null ? null : (
          <button
            type="button"
            className="newworktree__button newworktree__button--make"
            onClick={install}
            disabled={busy || made.state.how === 'running' || made.state.how === 'done'}
          >
            {made.state.how === 'running'
              ? SAYS.installingNow
              : made.state.how === 'failed'
                ? SAYS.installFailed
                : SAYS.installing}
          </button>
        )}
      </div>
    </section>
  );
}
