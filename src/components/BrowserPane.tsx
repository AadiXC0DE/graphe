import { useEffect, useRef, useState } from 'react';
import { walkthrough } from '../diff/flow';
import { WATCH_WORDS, type Watched } from '../preview/watching';
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
  /** Hand the address to the machine's own browser. Left off, the control is
   *  not offered. */
  onElsewhere?: (address: string) => void;
  /** What the agent's own browser is doing, when somebody is watching it. Left
   *  off, the control is not offered. */
  watched?: Watched;
  /** True while the agent's browser is showing itself. */
  watching?: boolean;
  /** Start watching the agent's browser, and stop. */
  onWatch?: (want: boolean) => void;
  /** True while what somebody does on the page is being recorded. */
  recording?: boolean;
  /** Start recording, and stop it. Left off, the control is not offered. */
  onRecord?: (want: boolean) => void;
};

export const SAYS = {
  label: 'The page',
  address: 'Address',
  reload: 'Load it again',
  close: 'Close the page',
  elsewhere: 'Open it in your browser',
  wider: 'Give the page the whole window',
  narrower: 'Show the conversation too',
  nothing: 'Nothing is being served yet. Press “Preview” and the page will open here.',
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
 * The one control that records the page, in whichever state it is in.
 *
 * The same press starts it and stops it, so both states have to be readable off
 * the button itself — a control that looks the same while it is running is a
 * control people leave running. Nothing being served is not a failure to
 * report: the button says why it cannot be pressed and stays quiet.
 */
export function recordControl(now: { recording: boolean; address: string | null }): {
  label: string;
  title: string;
  on: boolean;
  ready: boolean;
} {
  if (now.recording) {
    return { label: walkthrough.stop, title: walkthrough.working, on: true, ready: true };
  }
  const nothing = now.address === null;
  return {
    label: walkthrough.button,
    title: nothing ? SAYS.nothing : walkthrough.button,
    on: false,
    ready: !nothing,
  };
}

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
  onElsewhere,
  onAddress,
  onRoom,
  onClose,
  onBounds,
  variations,
  variation,
  onVariation,
  recording = false,
  onRecord,
  watched,
  watching = false,
  onWatch,
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
  }, [room, onBounds, size, address, recording]);

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

        {/* Every state a page goes through only exists while somebody is
            using it, so the way to keep one is to record somebody using it.
            Beside the address, because that is where the hand already is. */}
        {onRecord === undefined ? null : (
          <RecordButton recording={recording} address={address} onRecord={onRecord} />
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

        {/* Some things only a real browser does — an extension, a login already
            signed in, a devtools panel. One press and the same address is there. */}
        {onElsewhere === undefined ? null : (
        <button
          type="button"
          className="pane__act"
          onClick={() => {
            if (address !== null) onElsewhere(address);
          }}
          disabled={address === null}
          title={SAYS.elsewhere}
          aria-label={SAYS.elsewhere}
        >
          <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
            <path
              d="M8 2h4v4M12 2 6.5 7.5M11 8.5V11a1.5 1.5 0 0 1-1.5 1.5H3A1.5 1.5 0 0 1 1.5 11V4.5A1.5 1.5 0 0 1 3 3h2.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
        )}

        {/* The agent's browser runs out of sight, which is the point. This is
            the answer to "what is it doing" — a picture a second, in the room
            already here for looking at pages. */}
        {onWatch === undefined ? null : (
          <button
            type="button"
            className={`pane__act ${watching ? 'pane__act--on' : ''}`}
            onClick={() => onWatch(!watching)}
            title={watching ? WATCH_WORDS.off : WATCH_WORDS.on}
            aria-label={watching ? WATCH_WORDS.off : WATCH_WORDS.on}
            aria-pressed={watching}
          >
            <svg viewBox="0 0 14 14" width="12" height="12" fill="none" aria-hidden="true">
              <path
                d="M1 7s2.2-3.5 6-3.5S13 7 13 7s-2.2 3.5-6 3.5S1 7 1 7Z"
                stroke="currentColor"
                strokeWidth="1.3"
                strokeLinejoin="round"
              />
              <circle cx="7" cy="7" r="1.6" fill="currentColor" />
            </svg>
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

      {/* What the page is painted over. The fixed-width screen box is what the
          native view is glued to, so choosing a size redraws the page at it;
          the stage around it just centres the box and shows its own nothing
          until something is being served. */}
      <div className="pane__stage" ref={stage}>
        <div className={`pane__screen pane__screen--${size}`} ref={screen}>
          {/* The agent's own browser, drawn here rather than painted over by
              the shell — it is a picture, not a page, and it takes the room
              while somebody is watching it. */}
          {watching === true ? (
            watched?.picture == null ? (
              <p className="pane__nothing">{WATCH_WORDS.waiting}</p>
            ) : (
              <img className="pane__watched" src={watched.picture} alt={WATCH_WORDS.on} />
            )
          ) : address === null ? (
            <p className="pane__nothing">{SAYS.nothing}</p>
          ) : null}
        </div>
      </div>
    </section>
  );
}

function RecordButton({
  recording,
  address,
  onRecord,
}: {
  recording: boolean;
  address: string | null;
  onRecord: (want: boolean) => void;
}) {
  const control = recordControl({ recording, address });
  return (
    <button
      type="button"
      className={`pane__watch ${control.on ? 'pane__watch--on' : ''}`}
      onClick={() => onRecord(!recording)}
      disabled={!control.ready}
      title={control.title}
      aria-label={control.label}
      aria-pressed={control.on}
    >
      <span className="pane__dot" aria-hidden="true" />
      <span className="pane__watchsays">{control.label}</span>
    </button>
  );
}
