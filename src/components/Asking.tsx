import { useEffect, useRef, useState } from 'react';
import './Asking.css';

type Props = {
  /** True while the questions are switched off. */
  quiet: boolean;
  onQuiet: (quiet: boolean) => void;
};

export const SAYS = {
  asks: 'Asks first',
  quiet: 'Not asking',
  /** On the chip, in both states. */
  asksNote: 'I stop and check with you before anything that could cost you something.',
  quietNote: 'I am not stopping to check. Every change is still one undo away.',
  /** The two rows in the menu. */
  onName: 'Check with me',
  onNote: 'I stop before anything risky and wait for a yes.',
  offName: 'Do not stop to ask',
  offNote: 'I get on with it. Nothing is refused that would be refused anyway.',
  /** Said once, before it can be turned on. */
  warningTitle: 'You will not be asked again this sitting',
  warning:
    'I will stop checking with you before things I would normally ask about — running something, reaching the internet, changing a lot of files at once.',
  keeps:
    'Two things do not change: a saved moment is still taken before anything destructive, so you can put it back; and the handful of things I refuse outright — wiping a disk, reaching outside this folder, reading your keys — I still refuse.',
  until: 'It goes back to asking when you next open Graphe.',
  go: 'Turn it off for this sitting',
  no: 'Keep asking',
} as const;

/**
 * Whether to stop and check first.
 *
 * Beside the model and the planning chip, because it is the third thing that
 * changes what happens when you press send. Turning it off asks once, in full,
 * and says what it does *not* change — a switch that quietly widened what the
 * Guard allows would be worse than no switch, and the honest version of this is
 * "fewer interruptions", not "fewer rules".
 *
 * It lasts as long as the window does and is never written down. Somebody who
 * turned this on a week ago and forgot is the failure this whole app is a
 * reaction to.
 */
export default function Asking({ quiet, onQuiet }: Props) {
  const [open, setOpen] = useState(false);
  const [warning, setWarning] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setWarning(false);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      setWarning(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const shut = () => {
    setOpen(false);
    setWarning(false);
  };

  return (
    <div className={`asking ${quiet ? 'asking--quiet' : ''}`} ref={root}>
      <button
        type="button"
        className="asking__chip"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={quiet ? SAYS.quietNote : SAYS.asksNote}
      >
        {quiet ? (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M1.5 6.5 4.5 9.5 10.5 2.5"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : (
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
            <path
              d="M4 4.2a2 2 0 1 1 2.6 1.9c-.4.2-.6.5-.6.9v.5"
              stroke="currentColor"
              strokeWidth="1.3"
              strokeLinecap="round"
            />
            <circle cx="6" cy="9.6" r="0.8" fill="currentColor" />
          </svg>
        )}
        <span className="asking__label">{quiet ? SAYS.quiet : SAYS.asks}</span>
      </button>

      {!open ? null : warning ? (
        /* The one screen in this control that matters. It says what changes,
           what does not, and how long it lasts — in that order, because the
           middle one is the part people assume wrongly. */
        <div className="asking__menu asking__menu--warning" role="dialog" aria-label={SAYS.warningTitle}>
          <p className="asking__warntitle">{SAYS.warningTitle}</p>
          <p className="asking__warn">{SAYS.warning}</p>
          <p className="asking__warn">{SAYS.keeps}</p>
          <p className="asking__until">{SAYS.until}</p>
          <div className="asking__row">
            <button
              type="button"
              className="asking__go"
              onClick={() => {
                onQuiet(true);
                shut();
              }}
            >
              {SAYS.go}
            </button>
            <button type="button" className="asking__quiet" onClick={shut}>
              {SAYS.no}
            </button>
          </div>
        </div>
      ) : (
        <div className="asking__menu" role="menu" aria-label="Whether to check with you first">
          {[
            { on: true, name: SAYS.onName, note: SAYS.onNote },
            { on: false, name: SAYS.offName, note: SAYS.offNote },
          ].map((choice) => (
            <button
              key={choice.name}
              type="button"
              role="menuitemradio"
              aria-checked={choice.on === !quiet}
              className={`asking__option ${choice.on === !quiet ? 'asking__option--chosen' : ''}`}
              onClick={() => {
                // Turning it back on is a decision nobody needs talking through.
                if (choice.on) {
                  onQuiet(false);
                  shut();
                } else if (quiet) shut();
                else setWarning(true);
              }}
            >
              <span className="asking__tick" aria-hidden="true">
                {choice.on === !quiet ? (
                  <svg viewBox="0 0 12 12" width="10" height="10" fill="none">
                    <path
                      d="M2 6l3 3 5-5.5"
                      stroke="currentColor"
                      strokeWidth="1.6"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                ) : null}
              </span>
              <span className="asking__text">
                <span className="asking__name">{choice.name}</span>
                <span className="asking__note">{choice.note}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
