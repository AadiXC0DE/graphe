/** What is up right now, above the composer.
 *
 * A server is the one kind of work that has no place in the conversation: it is
 * started by one sentence and outlives every sentence after it, so filing it
 * under the turn that started it would put it out of reach the moment the
 * conversation moved on. It lives here instead, where the model chip and the
 * autonomy chip already are — the row that says what pressing send will do.
 *
 * Nothing here polls. The band is drawn from what the shell last said, and the
 * shell says something whenever one starts, finds its address or falls over.
 */

import type { RunningPiece } from '../agent/types';
import './Running.css';

export const SAYS = {
  /** The band's own name, said once. */
  title: 'Running now',
  open: 'Open',
  stop: 'Stop',
  /** A piece that is up but has never printed an address. A watcher, a build
   *  that re-runs itself: ordinary, and not a failure. */
  noAddress: 'no address of its own',
  starting: 'starting…',
  stopped: 'stopped',
} as const;

type Props = {
  pieces: readonly RunningPiece[];
  /** Point the window at one of them. */
  onOpen: (address: string) => void;
  onStop: (id: string) => void;
};

function saysAbout(piece: RunningPiece): string {
  if (piece.state === 'stopped') return SAYS.stopped;
  if (piece.address !== null) return piece.address.replace(/^https?:\/\//, '');
  return piece.state === 'starting' ? SAYS.starting : SAYS.noAddress;
}

export default function Running({ pieces, onOpen, onStop }: Props) {
  if (pieces.length === 0) return null;

  return (
    <section className="running" aria-label={SAYS.title}>
      <p className="running__title">{SAYS.title}</p>
      <ul className="running__list">
        {pieces.map((piece) => (
          <li
            key={piece.id}
            className={`running__one running__one--${piece.state}`}
          >
            <span className="running__dot" aria-hidden="true" />
            <span className="running__name">{piece.label}</span>
            <span className="running__where">{saysAbout(piece)}</span>
            {piece.address !== null && piece.state !== 'stopped' ? (
              <button
                type="button"
                className="running__act"
                onClick={() => onOpen(piece.address ?? '')}
              >
                {SAYS.open}
              </button>
            ) : null}
            <button
              type="button"
              className="running__act running__act--stop"
              onClick={() => onStop(piece.id)}
            >
              {SAYS.stop}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
