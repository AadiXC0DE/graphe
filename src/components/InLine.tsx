import type { Waiting } from '../lib/projects';
import type { WaitingSend } from '../agent/types';
import './InLine.css';

type Props = {
  waiting: readonly Waiting[];
  /** Sends waiting for the folder rather than for the agent: another chat is
   *  working in the same files, so nothing of these has begun. */
  queued: readonly WaitingSend[];
  /** Take the line back out. Nothing is sent, and the words come back to the
   *  box so a second thought can be changed rather than only cancelled. All of
   *  it at once: the queue belongs to the agent and it hands back all or none,
   *  and taking one would silently reorder the rest. */
  onTake: () => void;
  /** The way out of the wait: a copy of the project, on a branch of its own,
   *  that a chat can work in at the same time. */
  onNewWorktree: () => void;
};

export const SAYS = {
  one: 'Waiting in line',
  many: (count: number) => `${String(count)} waiting in line`,
  take: 'Put it back in the box',
  takeMany: (count: number) => `Put all ${String(count)} back in the box`,
  /** The folder is held by another conversation. Nothing of this has begun,
   *  which is a different thing from waiting behind the agent's own queue. */
  queuedFor: 'Queued for this workspace',
  waitingOn: (who: string) => `Waiting on ${who}`,
  copy: 'New worktree',
  copyWhy: 'Start a conversation in a copy of this project',
} as const;

/**
 * What has been typed and not sent yet, because something was already running.
 *
 * Directly above the composer, where the words were typed — the eye is already
 * there, and a message that went somewhere the eye is not is a message that
 * looks lost. Absent entirely when the line is empty: it is an event, not
 * furniture.
 *
 * Two lines, because there are two waits. One is behind the agent, which has
 * the words and will get to them; the other is behind another chat holding the
 * folder, which has nothing of them yet — and the second is where somebody is
 * told who has it and offered a copy to work in instead.
 */
export default function InLine({ waiting, queued, onTake, onNewWorktree }: Props) {
  if (waiting.length === 0 && queued.length === 0) return null;

  return (
    <>
      {queued.length === 0 ? null : (
        <div className="inline inline--folder" aria-label={SAYS.queuedFor}>
          <p className="inline__head">{SAYS.queuedFor}</p>
          <ul className="inline__list">
            {queued.map((one) => (
              <li key={one.id} className="inline__item">
                <span className="inline__text">{one.text}</span>
                {one.ahead === '' ? null : (
                  <span className="inline__ahead">{SAYS.waitingOn(one.ahead)}</span>
                )}
              </li>
            ))}
          </ul>
          <div className="inline__acts">
            <button
              type="button"
              className="inline__copy"
              onClick={onNewWorktree}
              title={SAYS.copyWhy}
            >
              {SAYS.copy}
            </button>
            <button type="button" className="inline__take" onClick={onTake}>
              {SAYS.take}
            </button>
          </div>
        </div>
      )}

      {waiting.length === 0 ? null : (
        <div className="inline" aria-label={SAYS.one}>
          <p className="inline__head">
            {waiting.length === 1 ? SAYS.one : SAYS.many(waiting.length)}
          </p>
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
      )}
    </>
  );
}
