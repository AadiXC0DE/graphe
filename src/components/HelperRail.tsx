import { useEffect, useState } from 'react';
import HelperMark from './HelperMark';
import type { Helper } from '../lib/projects';
import './HelperRail.css';

type Props = {
  helpers: readonly Helper[];
  /** Open the whole lot. A chip opens on the one that was clicked. */
  onOpen: (id: string | null) => void;
};

/** How many chips before the rest become one. Four is where a row of them stops
 *  being readable at a glance, which is the only thing the rail is for. */
const AT_ONCE = 3;

export const SAYS = {
  label: 'Helpers',
  more: (count: number) => `+${String(count)}`,
  moreLabel: (count: number) =>
    count === 1 ? '1 more helper' : `${String(count)} more helpers`,
} as const;

/** Counting up, not a clock time. */
function elapsed(ms: number): string {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 60) return `${String(Math.floor(minutes / 60))}h`;
  if (minutes > 0) return `${String(minutes)}m`;
  return `${String(seconds)}s`;
}

/** The first few words of what it was asked. Enough to tell two helpers apart,
 *  which is the whole job of a chip. */
function inShort(task: string): string {
  const words = task.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'a piece of work';
  const few = words.slice(0, 4).join(' ');
  return words.length > 4 ? `${few}…` : few;
}

/**
 * Who is working alongside this conversation, in one row above the composer.
 *
 * It sits here rather than in the right-hand panel because that panel is a
 * reading of what has already happened, and a helper is now. It is also the
 * only thing in the app that is working while you are reading something else,
 * which makes it the one thing that must never be behind a tab.
 *
 * Absent entirely when nothing has been sent off — it is an event, not
 * furniture.
 */
export default function HelperRail({ helpers, onOpen }: Props) {
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

  // Still working first, then the newest of the rest. The one that can still
  // surprise you is the one worth a place in a row of three.
  const order = [...helpers].reverse();
  const first = [
    ...order.filter((one) => one.state === 'running'),
    ...order.filter((one) => one.state !== 'running'),
  ];
  const shown = first.slice(0, AT_ONCE);
  const rest = first.length - shown.length;

  return (
    <div className="helperrail" aria-label={SAYS.label}>
      {shown.map((helper) => (
        <button
          key={helper.id}
          type="button"
          className={`helperrail__chip helperrail__chip--${helper.state}`}
          onClick={() => onOpen(helper.id)}
          title={helper.task}
        >
          <HelperMark state={helper.state} />
          <span className="helperrail__task">{inShort(helper.task)}</span>
          <span className="helperrail__time">
            {helper.state === 'running' ? elapsed(now - helper.startedAt) : ''}
          </span>
        </button>
      ))}

      {rest > 0 ? (
        <button
          type="button"
          className="helperrail__more"
          onClick={() => onOpen(null)}
          aria-label={SAYS.moreLabel(rest)}
        >
          {SAYS.more(rest)}
        </button>
      ) : null}
    </div>
  );
}
