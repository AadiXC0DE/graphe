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
  /* "Clear", not "Cancel": this takes the list off the screen. A run that is
     already going does not stop, and a word that promised otherwise would be
     read as one that did. */
  clear: 'Clear',
  clearTitle: 'Clears the list from the screen — any run already going keeps going.',
} as const;

function glyph(status: BuildPlan['tasks'][number]['status']): string {
  return status === 'done' ? '✓' : status === 'doing' ? '●' : status === 'failed' ? '!' : '○';
}

/**
 * A lightweight tracker for a document-to-build: how much of the plan is done,
 * what is being worked on now, and what is left. Collapsed it is one quiet line
 * above the box; expanded it is the checklist itself. The plan on disk is the
 * source of truth, so the line survives whatever happened to the window and a
 * resumed build simply picks it up.
 */
export default function BuildProgress({ plan, running = false, project }: Props) {
  const [open, setOpen] = useState(false);
  const failed = plan.tasks.filter((one) => one.status === 'failed').length;
  const head = failed > 0
    ? `${plan.done}/${plan.total} complete · ${SAYS.failed(failed)}`
    : `${plan.done}/${plan.total} ${SAYS.done}`;
  const canCancel = plan.done < plan.total;

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
        {canCancel ? (
          <button
            type="button"
            className="buildprogress__cancel"
            onClick={() => {
              void bridge.buildCancel(project === undefined ? undefined : { project });
            }}
            aria-label={`${SAYS.clear} todo`}
            title={SAYS.clearTitle}
          >
            {SAYS.clear}
          </button>
        ) : null}
      </div>

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
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
