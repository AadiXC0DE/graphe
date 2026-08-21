import type { Waiting } from '../lib/projects';
import './InLine.css';

type Props = {
  waiting: readonly Waiting[];
  /** Take the line back out. Nothing is sent, and the words come back to the
   *  box so a second thought can be changed rather than only cancelled. All of
   *  it at once: the queue belongs to the agent and it hands back all or none,
   *  and taking one would silently reorder the rest. */
  onTake: () => void;
};

export const SAYS = {
  one: 'Waiting in line',
  many: (count: number) => `${String(count)} waiting in line`,
  take: 'Put it back in the box',
  takeMany: (count: number) => `Put all ${String(count)} back in the box`,
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
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="inline__take"
        onClick={onTake}
        aria-label={waiting.length === 1 ? SAYS.take : SAYS.takeMany(waiting.length)}
      >
        {waiting.length === 1 ? SAYS.take : SAYS.takeMany(waiting.length)}
      </button>
    </div>
  );
}
