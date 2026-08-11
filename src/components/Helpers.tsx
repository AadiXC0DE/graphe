import { useEffect, useState } from 'react';
import { agoInSentence } from '../lib/when';
import './Helpers.css';

/** One helper working alongside the main thread, as the screen sees it. */
export type Helper = {
  id: string;
  task: string;
  saying: string | null;
  state: 'running' | 'done' | 'failed';
  startedAt: number;
};

type Props = {
  helpers: readonly Helper[];
  /** Only offered for a helper that has stopped — there is nothing to clear
   *  about one that is still going. */
  onDismiss?: (id: string) => void;
};

/** Every word this component can put on screen, in one place, so the copy can
 *  be read without reading the markup. */
export const SAYS = {
  heading: 'Helpers',
  working: (count: number) => (count === 1 ? '1 still working' : `${count} still working`),
  asked: 'Asked',
  states: {
    running: 'Working',
    done: 'Finished',
    failed: 'Stopped',
  },
  nothingSaid: 'Nothing said yet.',
  started: (when: string) => `Started ${when}`,
  clear: 'Clear',
  clearOne: (task: string) => `Clear “${task}”`,
} as const;

/** Counting up, not a clock time: this is how long something has been going. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const rest = seconds % 60;
  if (hours > 0) return `${String(hours)}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${String(minutes)}m ${String(rest).padStart(2, '0')}s`;
  return `${String(rest)}s`;
}

/**
 * What everybody helping is doing, all at once.
 *
 * Work that happens off to one side is work you cannot judge, so each helper
 * keeps its own card: the whole of what it was asked, wrapped rather than cut;
 * the last thing it said; and a time that keeps moving while it does. Finished
 * cards stay — the record of what happened is the point — but they recede.
 */
export default function Helpers({ helpers, onDismiss }: Props) {
  const running = helpers.filter((one) => one.state === 'running').length;
  const [now, setNow] = useState(() => Date.now());

  /* The clock only runs while something does. */
  useEffect(() => {
    if (running === 0) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);

  if (helpers.length === 0) return null;

  return (
    <section className="helpers" aria-label={SAYS.heading}>
      <header className="helpers__head">
        <h2 className="helpers__heading">{SAYS.heading}</h2>
        {running > 0 ? <p className="helpers__count">{SAYS.working(running)}</p> : null}
      </header>

      <ul className="helpers__list">
        {helpers.map((helper) => (
          <li key={helper.id} className={`helpers__card helpers__card--${helper.state}`}>
            <div className="helpers__top">
              <p className="helpers__state">
                {helper.state === 'running' ? (
                  <span className="helpers__pulse" aria-hidden="true" />
                ) : (
                  <span className="helpers__mark" aria-hidden="true">
                    {helper.state === 'done' ? (
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                        <path
                          d="M2 6l3 3 5-5.5"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    ) : (
                      <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                        <path
                          d="M2.5 6h7"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                        />
                      </svg>
                    )}
                  </span>
                )}
                <span className="helpers__statename">{SAYS.states[helper.state]}</span>
              </p>

              <p className="helpers__time">
                {helper.state === 'running'
                  ? elapsed(now - helper.startedAt)
                  : SAYS.started(agoInSentence(helper.startedAt, now))}
              </p>
            </div>

            <p className="helpers__task">
              <span className="helpers__asked">{SAYS.asked}</span>
              {helper.task}
            </p>

            <p className="helpers__saying">{helper.saying ?? SAYS.nothingSaid}</p>

            {onDismiss !== undefined && helper.state !== 'running' ? (
              <button
                type="button"
                className="helpers__clear"
                onClick={() => onDismiss(helper.id)}
                title={SAYS.clearOne(helper.task)}
              >
                {SAYS.clear}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
