import { useEffect, useRef, useState } from 'react';
import type { HowFar } from '../agent/guard/policy';
import './Asking.css';

type Props = {
  /** How far it may go before it stops and asks. */
  howFar: HowFar;
  onHowFar: (howFar: HowFar) => void;
};

export const SAYS = {
  /** The chip, one rung each, in the fewest words that are still true. */
  rungs: {
    looking: { name: 'Just looking', note: 'I read and tell you what I find. I change nothing.' },
    asking: { name: 'Asks first', note: 'I stop and check with you before anything that could cost you something.' },
    changing: { name: 'Changes files', note: 'I edit without asking, and still stop before running anything.' },
    doing: {
      name: 'Gets on with it',
      note: 'Full computer access for this sitting, using the accounts and tools you already use in your terminal.',
    },
  },

  /** Said once, before the top two can be turned on. Each screen says what
   *  changes, what does not, and how long it lasts — in that order, because the
   *  middle one is the part people assume wrongly. */
  screens: {
    doing: {
      title: 'Full computer access for this sitting',
      changes:
        'I will run commands and work anywhere on your computer without asking first, using your normal terminal environment.',
      keeps:
        'This is intentionally unrestricted: it can reach outside this project and it does not create restore points first. Turn it on only when you want that level of access.',
      go: 'Turn it off for this sitting',
    },
  },
  until: 'It goes back to asking when you next open Graphe.',
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
/** In the order they let go, so the menu reads as a ladder rather than a list
 *  of unrelated modes. */
export const RUNGS: readonly HowFar[] = ['looking', 'asking', 'changing', 'doing'];

/** The one worth stopping somebody on: it runs commands in the person's normal
 * terminal environment rather than the contained project environment. */
const WORTH_A_WARNING: readonly HowFar[] = ['doing'];

function screenFor(rung: HowFar): (typeof SAYS.screens)['doing'] | null {
  if (rung === 'doing') return SAYS.screens.doing;
  return null;
}

export default function Asking({ howFar, onHowFar }: Props) {
  const [open, setOpen] = useState(false);
  /** Which rung is being asked about, or null when the menu is the menu. */
  const [warning, setWarning] = useState<HowFar | null>(null);
  const root = useRef<HTMLDivElement>(null);

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) {
        setOpen(false);
        setWarning(null);
      }
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
      setWarning(null);
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
    setWarning(null);
  };

  const here = SAYS.rungs[howFar];
  const loose = howFar === 'changing' || howFar === 'doing';

  return (
    <div className={`asking ${loose ? 'asking--quiet' : ''}`} ref={root}>
      <button
        type="button"
        className="asking__chip"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="menu"
        aria-expanded={open}
        title={here.note}
      >
        {loose ? (
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
        <span className="asking__label">{here.name}</span>
      </button>

      {!open ? null : warning !== null && screenFor(warning) !== null ? (
        /* The screens that matter. Each says what changes, what does not, and
           how long it lasts — in that order, because the middle one is the part
           people assume wrongly. */
        <div
          className="asking__menu asking__menu--warning"
          role="dialog"
          aria-label={screenFor(warning)?.title ?? ''}
        >
          <p className="asking__warntitle">{screenFor(warning)?.title}</p>
          <p className="asking__warn">{screenFor(warning)?.changes}</p>
          <p className="asking__warn">{screenFor(warning)?.keeps}</p>
          <p className="asking__until">{SAYS.until}</p>
          <div className="asking__row">
            <button
              type="button"
              className="asking__go"
              onClick={() => {
                onHowFar(warning);
                shut();
              }}
            >
              {screenFor(warning)?.go}
            </button>
            <button type="button" className="asking__quiet" onClick={shut}>
              {SAYS.no}
            </button>
          </div>
        </div>
      ) : (
        <div className="asking__menu" role="menu" aria-label="How far to go on your own">
          {RUNGS.map((rung) => {
            const chosen = rung === howFar;
            const said = SAYS.rungs[rung];
            return (
            <button
              key={rung}
              type="button"
              role="menuitemradio"
              aria-checked={chosen}
              className={`asking__option ${chosen ? 'asking__option--chosen' : ''}`}
              onClick={() => {
                // Tightening is a decision nobody needs talking through; only
                // the rung that runs things without asking is worth a screen.
                if (WORTH_A_WARNING.includes(rung) && rung !== howFar) {
                  setWarning(rung);
                  return;
                }
                onHowFar(rung);
                shut();
              }}
            >
              <span className="asking__tick" aria-hidden="true">
                {chosen ? (
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
                <span className="asking__name">{said.name}</span>
                <span className="asking__note">{said.note}</span>
              </span>
            </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
