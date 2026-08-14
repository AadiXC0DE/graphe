import { useEffect, useRef, useState } from 'react';
import { walkthrough } from '../diff/flow';
import './BrowserPane.css';

/** How the window is split between the conversation and the page. */
export type Room = 'off' | 'split' | 'whole';

/** The width to draw the page at. `auto` fills the room it is given. */
export type ScreenSize = 'auto' | 'phone' | 'tablet';

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
  /** A set of designs being compared, each served on its own address. When
   *  given, the pane shows the strip so the page being drawn can be switched. */
  variations?: readonly { id: string; name: string }[];
  /** Which variation is in front, null when none is. */
  variation?: string | null;
  /** Switch the page to another variation. */
  onVariation?: (id: string) => void;
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
  variations: 'Designs to compare',
  pick: (name: string): string => `Look at ${name}`,
} as const;

/* The sizes somebody might want to look at the page in. Terse on purpose: this
   is a control beside the address, and a row of words the length of a sentence
   is how a band becomes a menu. */
export const SIZES: readonly { id: ScreenSize; label: string; title: string }[] = [
  { id: 'auto', label: 'Full', title: 'Fill the room it is given' },
  { id: 'phone', label: 'Phone', title: 'See it at a phone width' },
  { id: 'tablet', label: 'Tablet', title: 'See it at a tablet width' },
];

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
  variations,
  variation,
  onVariation,
  onWatch,
  watching,
}: Props) {
  const stage = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(address ?? '');
  const [size, setSize] = useState<ScreenSize>('auto');

  useEffect(() => {
    setTyped(address ?? '');
  }, [address]);

  /* The page is a native view glued to the fixed-width screen box, so every
     reason that box could move has to be heard: the window resizing, the panels
     opening, the size changing, and the mode changing. */
  useEffect(() => {
    const holder = stage.current;
    const el = screen.current ?? holder;
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
  }, [room, onBounds, size, address]);

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

        {/* A set of designs being compared: the strip sits in the same band as
            the address, so the thing being looked at is one gesture away. */}
        {onVariation === undefined || variations === undefined || variations.length === 0 ? null : (
          <div className="pane__variations" role="group" aria-label={SAYS.variations}>
            {variations.map((one) => (
              <button
                key={one.id}
                type="button"
                className={`pane__variation ${variation === one.id ? 'pane__variation--on' : ''}`}
                onClick={() => onVariation(one.id)}
                title={SAYS.pick(one.name)}
                aria-pressed={variation === one.id}
              >
                {one.name}
              </button>
            ))}
          </div>
        )}

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

        {/* The width to look at the page in, in the band beside the address. */}
        <div className="pane__sizes" role="group" aria-label="Page width">
          {SIZES.map((one) => (
            <button
              key={one.id}
              type="button"
              className={`pane__size ${size === one.id ? 'pane__size--on' : ''}`}
              onClick={() => setSize(one.id)}
              title={one.title}
              aria-pressed={size === one.id}
            >
              {one.label}
            </button>
          ))}
        </div>

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

      {/* What the page is painted over. The fixed-width screen box is what the
          native view is glued to, so choosing a size redraws the page at it;
          the stage around it just centres the box and shows its own nothing
          until something is being served. */}
      <div className="pane__stage" ref={stage}>
        <div className={`pane__screen pane__screen--${size}`} ref={screen}>
          {address === null ? <p className="pane__nothing">{SAYS.nothing}</p> : null}
        </div>
      </div>
    </section>
  );
}
