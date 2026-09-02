import { useState } from 'react';
import type { BuildPlan } from '../lib/ipc';
import { bridge } from '../lib/bridge';
import './BuildProgress.css';

type Props = {
  plan: BuildPlan;
  /** True while a turn is still running, so the collapsed line can say so. */
  running?: boolean;
  /** Which project's list this is. Given, Clear lands on that project even if
   *  the front tab has moved; left out, it cancels whatever is in front, which
   *  is the same thing whenever the tracker is on screen. */
  project?: string;
  /** What the app is doing carrying this job on by itself, when it is. Drawn
   *  under the count so a second reply nobody typed is never a mystery. */
  carryingOn?: { said: string; round: number } | null;
  /** Stop it carrying on. Separate from Stop-the-todo: one ends the loop, the
   *  other ends the list. */
  onStopCarryingOn?: () => void;
};

export const SAYS = {
  /* Not "PRD": the list is just as often a handful of jobs somebody typed, and
     naming it after the one document that can start it made the other nine
     times read as the wrong feature. */
  name: 'Todo progress',
  done: 'complete',
  failed: (n: number) => (n === 1 ? '1 task failed' : `${n} tasks failed`),
  open: 'Show the plan',
  close: 'Hide the plan',
  working: 'Working on',
  stuck: 'Needs another try',
  /* "Stop", not "Clear": what ends is the todo itself, and Stop is the word
     the rest of the app already uses for ending something. The title carries
     the boundary — a run already going is not interrupted. */
  stop: 'Stop',
  stopTitle:
    'Stops this todo: the list comes off the screen and stays gone. A run already going is not interrupted.',
  /* A finished list stays on screen saying so. It used to delete itself the
     moment it read as complete, which meant a list that finished by mistake
     vanished with nothing to resume from. */
  finished: 'All done',
  clear: 'Clear',
  clearTitle: 'Takes the finished list off the screen.',
  skipped: 'Skipped',
  /** How many other conversations in this project are holding a list. */
  elsewhere: (n: number) =>
    n === 1 ? '1 other list in this project' : `${n} other lists in this project`,
  /** The Stop beside the carrying-on line. */
  rest: 'Stop carrying on',
  restTitle: 'Stops the app sending itself the next step. The run in flight finishes.',
} as const;

function glyph(status: BuildPlan['tasks'][number]['status']): string {
  if (status === 'done') return '✓';
  if (status === 'doing') return '●';
  if (status === 'failed') return '!';
  if (status === 'skipped') return '–';
  return '○';
}

/**
 * A lightweight tracker for a document-to-build: how much of the plan is done,
 * what is being worked on now, and what is left. Collapsed it is one quiet line
 * above the box; expanded it is the checklist itself. The plan on disk is the
 * source of truth, so the line survives whatever happened to the window and a
 * resumed build simply picks it up.
 */
export default function BuildProgress({
  plan,
  running = false,
  project,
  carryingOn = null,
  onStopCarryingOn,
}: Props) {
  const [open, setOpen] = useState(false);
  const failed = plan.tasks.filter((one) => one.status === 'failed').length;
  const head = plan.finished
    ? `${SAYS.finished} · ${plan.done}/${plan.total}`
    : failed > 0
      ? `${plan.done}/${plan.total} complete · ${SAYS.failed(failed)}`
      : `${plan.done}/${plan.total} ${SAYS.done}`;

  return (
    <section className={`buildprogress ${open ? 'buildprogress--open' : ''}`} aria-label="Progress">
      {/* The fold and the Clear are two controls, so they are two buttons in a
          row — a button inside a button is not a thing HTML can say. */}
      <div className="buildprogress__bar">
        <button
          type="button"
          className="buildprogress__head"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-label={open ? SAYS.close : SAYS.open}
        >
          <span className={`buildprogress__dot ${running ? 'buildprogress__dot--live' : ''}`} aria-hidden="true" />
          <span className="buildprogress__name">{SAYS.name}</span>
          <span className="buildprogress__count">{head}</span>
          <span className="buildprogress__caret" aria-hidden="true">
            <svg width="10" height="10" viewBox="0 0 12 12" fill="none">
              <path
                d="M4.5 2.5 8 6l-3.5 3.5"
                stroke="currentColor"
                strokeWidth="1.4"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
        </button>
        <button
          type="button"
          className="buildprogress__cancel"
          onClick={() => {
            void bridge.buildCancel(project === undefined ? undefined : { project });
          }}
          aria-label={plan.finished ? `${SAYS.clear} todo` : `${SAYS.stop} todo`}
          title={plan.finished ? SAYS.clearTitle : SAYS.stopTitle}
        >
          {plan.finished ? SAYS.clear : SAYS.stop}
        </button>
      </div>

      {carryingOn !== null ? (
        <div className="buildprogress__carrying">
          <span className="buildprogress__carryingsaid">{carryingOn.said}</span>
          {onStopCarryingOn === undefined ? null : (
            <button
              type="button"
              className="buildprogress__cancel"
              onClick={onStopCarryingOn}
              title={SAYS.restTitle}
            >
              {SAYS.rest}
            </button>
          )}
        </div>
      ) : null}

      {open ? (
        <ul className="buildprogress__list">
          {plan.tasks.map((task) => (
            <li
              key={task.n}
              className={`buildprogress__row buildprogress__row--${task.status}`}
            >
              <span className="buildprogress__glyph" aria-hidden="true">
                {glyph(task.status)}
              </span>
              <span className="buildprogress__title">{task.title}</span>
              {task.status === 'doing' ? (
                <span className="buildprogress__tag">{SAYS.working}</span>
              ) : task.status === 'failed' ? (
                <span className="buildprogress__tag">{SAYS.stuck}</span>
              ) : task.status === 'skipped' ? (
                <span className="buildprogress__tag">{SAYS.skipped}</span>
              ) : null}
            </li>
          ))}
          {plan.elsewhere > 0 ? (
            <li className="buildprogress__row buildprogress__row--elsewhere">
              <span className="buildprogress__glyph" aria-hidden="true">
                ·
              </span>
              <span className="buildprogress__title">{SAYS.elsewhere(plan.elsewhere)}</span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </section>
  );
}
