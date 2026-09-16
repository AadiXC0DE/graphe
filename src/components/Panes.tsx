import { type ViewId } from '../domain/views';
import './Panes.css';

/** What one pane is called on the band. */
export type PaneRow = {
  id: ViewId;
  title: string;
  focused: boolean;
};

type Props = {
  panes: readonly PaneRow[];
  /** The inspector's own line while it is pinned, or null while it follows the
   *  focus. Only ever set with a second pane: pinning is a decision about a
   *  panel beside a pane, and with one pane there is nothing to pin against. */
  pinned: string | null;
  onFocus: (id: ViewId) => void;
  onClose: (id: ViewId) => void;
  onTogglePin?: () => void;
};

export const SAYS = {
  label: 'Panes',
  unsplit: (title: string) => `Close the pane showing ${title}`,
  pin: 'Pin',
  pinned: 'Following',
  pinHint: 'Keep the panel on this chat while the other pane is focused',
  unpinHint: 'Let the panel follow whichever pane is focused',
} as const;

/**
 * Which pane the hand is in, and the two controls that make a second one worth
 * having.
 *
 * It exists only once there are two: with one pane there is no question of
 * where the hand is, so the single press that makes a second lives at the end
 * of the conversation tab strip, where somebody choosing a conversation is
 * already looking. Drawing nothing here keeps one control for one operation.
 *
 * The row is a real tablist, so the keyboard moves between panes with the
 * arrows. That matters more than tidiness here: focusing a pane is what
 * retargets the composer and the keys, so the row is the control for the whole
 * feature and it has to be reachable without a mouse.
 */
export default function Panes({ panes, pinned, onFocus, onClose, onTogglePin }: Props) {
  if (panes.length < 2) return null;

  const step = (from: number, by: number): void => {
    const wanted = panes[(from + by + panes.length) % panes.length];
    if (wanted !== undefined) onFocus(wanted.id);
  };

  return (
    <div className="panes">
      <div className="panes__row" role="tablist" aria-label={SAYS.label}>
        {panes.map((one, at) => (
          <div
            key={one.id}
            className={`panes__one ${one.focused ? 'panes__one--here' : ''}`}
          >
            <button
              type="button"
              role="tab"
              className="panes__tab"
              aria-selected={one.focused}
              tabIndex={one.focused ? 0 : -1}
              onClick={() => onFocus(one.id)}
              onKeyDown={(event) => {
                if (event.key === 'ArrowRight') {
                  event.preventDefault();
                  step(at, 1);
                }
                if (event.key === 'ArrowLeft') {
                  event.preventDefault();
                  step(at, -1);
                }
              }}
            >
              {one.title}
            </button>
            <button
              type="button"
              className="panes__close"
              title={SAYS.unsplit(one.title)}
              aria-label={SAYS.unsplit(one.title)}
              onClick={() => onClose(one.id)}
            >
              <svg
                width="9"
                height="9"
                viewBox="0 0 12 12"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M3 3l6 6M9 3l-6 6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        ))}
      </div>

      <div className="panes__acts">
        {/* Only while pinned: a panel that stopped following the hand is
            otherwise indistinguishable from one that is stuck. */}
        {pinned === null ? null : (
          <span className="panes__pinned">{pinned}</span>
        )}
        {onTogglePin === undefined ? null : <button
          type="button"
          className={`panes__act ${pinned === null ? '' : 'panes__act--on'}`}
          title={pinned === null ? SAYS.pinHint : SAYS.unpinHint}
          aria-pressed={pinned !== null}
          onClick={onTogglePin}
        >
          {pinned === null ? SAYS.pin : SAYS.pinned}
        </button>}
      </div>
    </div>
  );
}
