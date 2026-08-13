import type { Waiting } from '../lib/projects';
import './InLine.css';

type Props = {
  waiting: readonly Waiting[];
  /** Take one back out of the line. Nothing is sent, and the words come back
   *  to the box so a second thought can be changed rather than only cancelled. */
  onTake: (id: string) => void;
};

export const SAYS = {
  one: 'Waiting in line',
  many: (count: number) => `${String(count)} waiting in line`,
  take: (text: string) => `Take “${text}” back`,
} as const;

/**
 * What has been typed and not sent yet, because something was already running.
 *
 * Directly above the composer, where the words were typed — the eye is already
 * there, and a message that went somewhere the eye is not is a message that
 * looks lost. Absent entirely when the line is empty: it is an event, not
 * furniture.
 */
export default function InLine({ waiting, onTake }: Props) {
  if (waiting.length === 0) return null;

  return (
    <div className="inline" aria-label={SAYS.one}>
      <p className="inline__head">{waiting.length === 1 ? SAYS.one : SAYS.many(waiting.length)}</p>
      <ul className="inline__list">
        {waiting.map((one) => (
          <li key={one.id} className="inline__item">
            <span className="inline__text">{one.text}</span>
            <button
              type="button"
              className="inline__take"
              onClick={() => onTake(one.id)}
              aria-label={SAYS.take(one.text)}
            >
              <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
