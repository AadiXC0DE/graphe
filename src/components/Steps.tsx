import { useState } from 'react';
import ActivityLine from './ActivityLine';
import { howItWent, type StepTurn } from '../lib/steps';
import { lastSaid } from '../lib/describe';
import './Steps.css';

type Props = {
  steps: readonly StepTurn[];
  /** Name the real command, path or operation under each step. */
  showMe: boolean;
};

export const SAYS = {
  count: (n: number) => `${String(n)} steps`,
  open: 'Show the steps',
  close: 'Hide the steps',
} as const;

/**
 * A run of steps as one line, with the rest of them behind it.
 *
 * The line carries the *last* step rather than a summary of all of them, which
 * is what keeps "never a spinner without a sentence" true while the run is
 * still going: the newest thing is the thing being done now. Finished, it is
 * the last thing that happened, which is the one a person would ask about.
 *
 * Closed by default. Everything is still there, one click away, and nothing
 * about the run is lost — only the eleven lines it would otherwise have cost.
 */
export default function Steps({ steps, showMe }: Props) {
  const [open, setOpen] = useState(false);
  const state = howItWent(steps);
  const last = steps[steps.length - 1];
  if (last === undefined) return null;

  return (
    <div className={`steps ${open ? 'steps--open' : ''}`}>
      <button
        type="button"
        className="steps__head"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={open ? SAYS.close : SAYS.open}
      >
        {/* Open, the head is only a heading: the last step is already the last
            line below it, and saying it twice is the fold reintroducing the
            noise it was built to remove. */}
        {open ? (
          <ActivityLine state={state} label={SAYS.count(steps.length)} />
        ) : (
          <ActivityLine
            state={state}
            label={last.label}
            detail={last.progress === undefined ? last.detail : lastSaid(last.progress)}
            meta={SAYS.count(steps.length)}
          />
        )}
        <span className="steps__caret" aria-hidden="true">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
            <path
              d="M4.5 2.5L8 6l-3.5 3.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </span>
      </button>

      {open ? (
        <div className="steps__list">
          {steps.map((step) => (
            <ActivityLine
              key={step.id}
              state={step.state}
              label={step.label}
              detail={step.progress === undefined ? step.detail : lastSaid(step.progress)}
              real={showMe ? step.real : undefined}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
