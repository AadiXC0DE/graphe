import { useEffect, useRef, useState } from 'react';
import { walkthrough } from '../diff/flow';
import './BrowserPane.css';

/** How the window is split between the conversation and the page. */
export type Room = 'off' | 'split' | 'whole';

type Props = {
  room: Room;
  /** Where it is pointed. Null before anything is being served. */
  address: string | null;
  onAddress: (address: string) => void;
  onRoom: (room: Room) => void;
  onClose: () => void;
  /** Where the page should be drawn, in window coordinates. The pane itself is
   *  a placeholder: the page is painted over it by the shell, because a real
   *  browser view is a native thing and not part of this tree. */
  onBounds: (bounds: { x: number; y: number; width: number; height: number }) => void;
  /** Start watching how somebody uses the page, or stop and keep what was
   *  seen. Left off, the pane does not offer it. */
  onWatch?: (on: boolean) => void;
  /** True while a walkthrough is being recorded. */
  watching?: boolean;
};

export const SAYS = {
  label: 'The page',
  address: 'Address',
  reload: 'Load it again',
  close: 'Close the page',
  wider: 'Give the page the whole window',
  narrower: 'Show the conversation too',
  nothing: 'Nothing is being served yet. Press “See it” and the page will open here.',
} as const;

/**
 * The project's own page, beside the conversation.
 *
 * The chat has a floor and never goes below it — squeezing a conversation into
 * a column too narrow to read is how every side-by-side layout fails. Past the
 * floor the page gives room back, and past that the window goes to the page
 * alone with the conversation one key away.
 *
 * This element is a placeholder with an address bar around it. The page itself
 * is drawn over it by the shell, so its bounds are reported upward on every
 * resize and scroll rather than assumed.
 */
export default function BrowserPane({
  room,
  address,
  onAddress,
  onRoom,
  onClose,
  onBounds,
  onWatch,
  watching,
}: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(address ?? '');

  useEffect(() => {
    setTyped(address ?? '');
  }, [address]);

  /* The page is a native view glued to this rectangle, so every reason the
     rectangle could move has to be heard: the window resizing, the panels
     opening, and the mode changing. */
  useEffect(() => {
    const el = stage.current;
    if (el === null || room === 'off') return;
    const tell = (): void => {
      const box = el.getBoundingClientRect();
      onBounds({ x: box.x, y: box.y, width: box.width, height: box.height });
    };
    tell();
    const sized = new ResizeObserver(tell);
    sized.observe(el);
    globalThis.addEventListener('resize', tell);
    return () => {
      sized.disconnect();
      globalThis.removeEventListener('resize', tell);
    };
  }, [room, onBounds]);

  if (room === 'off') return null;

  return (
    <section className={`pane pane--${room}`} aria-label={SAYS.label}>
      <header className="pane__bar">
        <form
          className="pane__address"
          onSubmit={(event) => {
            event.preventDefault();
            const wanted = typed.trim();
            if (wanted !== '') onAddress(wanted);
          }}
        >
          <input
            className="pane__field"
            type="text"
            value={typed}
            spellCheck={false}
            aria-label={SAYS.address}
            placeholder={address ?? 'localhost'}
            onChange={(event) => setTyped(event.target.value)}
          />
        </form>

        {/* In the pane's own band, beside the address it is watching. Nobody
            has to know it exists to find it. */}
        {onWatch === undefined ? null : (
          <button
            type="button"
            className={`pane__watch ${watching === true ? 'pane__watch--on' : ''}`}
            onClick={() => onWatch(watching !== true)}
            title={watching === true ? walkthrough.working : walkthrough.button}
          >
            <span className="pane__dot" aria-hidden="true" />
            {watching === true ? walkthrough.stop : walkthrough.button}
          </button>
        )}

        {/* A page you are working against is a page you reload constantly. */}
        <button
          type="button"
          className="pane__act"
          onClick={() => {
            if (address !== null) onAddress(address);
          }}
          disabled={address === null}
          title={SAYS.reload}
          aria-label={SAYS.reload}
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
            <path
              d="M11.5 7a4.5 4.5 0 1 1-1.4-3.2M11.6 2v2.6H9"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <button
          type="button"
          className="pane__act"
          onClick={() => onRoom(room === 'whole' ? 'split' : 'whole')}
          title={room === 'whole' ? SAYS.narrower : SAYS.wider}
          aria-label={room === 'whole' ? SAYS.narrower : SAYS.wider}
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
            <rect x="1.5" y="2.5" width="11" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
            {room === 'whole' ? (
              <path d="M6 2.5v9" stroke="currentColor" strokeWidth="1.3" />
            ) : null}
          </svg>
        </button>

        <button type="button" className="pane__act" onClick={onClose} aria-label={SAYS.close}>
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
            <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      </header>

      {/* What the page is painted over. Empty on purpose: anything drawn in here
          would be hidden the moment the real page arrives. */}
      <div className="pane__stage" ref={stage}>
        {address === null ? <p className="pane__nothing">{SAYS.nothing}</p> : null}
      </div>
    </section>
  );
}
