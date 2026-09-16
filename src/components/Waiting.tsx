import type { ReviewEntry } from '../lib/ipc';
import { ago } from '../lib/when';
import { saysEntry, waiting } from '../work/reviewqueue';
import './Waiting.css';

type Props = {
  /** What is waiting for the conversation this panel is about. The owner of
   *  the query, and of the scope, is whoever asked for this panel: it used to
   *  fetch the project queue itself, unqualified, and keep the last answer,
   *  which made a project list read as this chat's state. */
  entries: readonly ReviewEntry[];
  /** Open the Review screen, at this entry. */
  onOpen?: (id?: string) => void;
  /** The window's clock, so "2m ago" moves without a timer of its own. */
  clock?: number;
};

/** Past this the band is a list rather than a summary, and the screen is a
 *  press away. */
const SHOWN = 3;

export const WAITING_WORDS = {
  heading: 'Waiting for you',
  more: (many: number): string => `and ${String(many)} more`,
} as const;

/**
 * What has finished and is waiting to be looked at.
 *
 * A row is a press into the Review screen and nothing else. Four presses on a
 * card in a 328px column, each saying the same thing in different words, was
 * how the panel came to spend its most valuable space on state somebody acts on
 * once a day. When nothing waits the band is not drawn at all: an empty band
 * teaches people to stop looking.
 */
export default function Waiting({ entries, onOpen, clock }: Props) {
  // An entry leaves the list the moment it is decided about, so everything
  // still here is still waiting.
  if (entries.length === 0) return null;
  const shown = entries.slice(0, SHOWN);

  return (
    <section className="overview__block">
      <div className="waiting__top">
        <h2 className="overview__title">{WAITING_WORDS.heading}</h2>
        <span className="waiting__count">{String(waiting(entries))}</span>
      </div>
      <ul className="waiting__list">
        {shown.map((one) => (
          <li key={one.id}>
            <button type="button" className="waiting__row" onClick={() => onOpen?.(one.id)}>
              <span className={`waiting__dot ${one.read ? '' : 'waiting__dot--unread'}`} aria-hidden="true" />
              <span className="waiting__text">
                <span className="waiting__title">{one.title}</span>
                <span className="waiting__meta">
                  {saysEntry(one)} · {ago(one.at, clock ?? Date.now())}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {entries.length > SHOWN ? (
        <button type="button" className="waiting__more" onClick={() => onOpen?.()}>
          {WAITING_WORDS.more(entries.length - SHOWN)}
        </button>
      ) : null}
    </section>
  );
}
