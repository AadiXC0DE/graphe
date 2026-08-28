import { useEffect, useRef, useState } from 'react';
import {
  chooseDepth,
  chosenDepth,
  DEFAULT_DEPTH,
  DEPTHS,
  howDeep,
  researchWords,
  type Depth,
} from '../agent/research';
import { executiveWords } from '../agent/executive';
import { goalWords } from '../work/goal';
import './HowToWork.css';

export type Plans = 'auto' | 'always' | 'never' | 'research' | 'plan' | 'goal' | 'executive';

type Props = {
  plans: Plans;
  onPlans: (plans: Plans) => void;
};

/**
 * Whether to look before touching anything.
 *
 * It sits in the composer's own row next to the model, because it is the other
 * thing that changes what happens when you press send. The default decides for
 * itself and is the one almost nobody needs to think about; the other two are
 * for the person who has an opinion about this particular message.
 */
const CHOICES: readonly { id: Plans; chip: string; name: string; note: string }[] = [
  {
    id: 'auto',
    chip: 'Plans big jobs',
    name: 'Plan the big ones',
    note: 'Looks around first when a request sounds like a lot, and gets straight on with the small ones.',
  },
  {
    id: 'always',
    chip: 'Plans first',
    name: 'Always plan first',
    note: 'Tells you what it would do every time, and waits.',
  },
  {
    id: 'never',
    chip: 'Straight in',
    name: 'Never plan',
    note: 'Gets on with it. You can still put anything back afterwards.',
  },
  {
    id: 'research',
    chip: researchWords.chip,
    name: researchWords.name,
    note: researchWords.note,
  },
  {
    id: 'goal',
    chip: goalWords.chip,
    name: goalWords.name,
    note: `${goalWords.note} ${goalWords.howFarNote}`,
  },
  {
    id: 'plan',
    chip: 'Plan',
    name: 'Plan only',
    note: 'Reads and proposes a plan, no edits or commands until you approve it. Write tools are held.',
  },
  {
    id: 'executive',
    chip: executiveWords.chip,
    name: executiveWords.name,
    note: executiveWords.note,
  },
];

export default function HowToWork({ plans, onPlans }: Props) {
  const [open, setOpen] = useState(false);
  /* The way of working is one message; how far to go is a preference. It is
     kept where the send can read it, and mirrored here to draw the tick. */
  const [howFar, setHowFar] = useState<Depth>(chosenDepth);
  const root = useRef<HTMLDivElement>(null);
  const chosen = CHOICES.find((one) => one.id === plans) ?? CHOICES[0]!;
  /* The chip keeps its own words at the setting nobody had to choose, and wears
     the setting itself once somebody has. */
  const label =
    plans === 'research' && howFar !== DEFAULT_DEPTH
      ? howDeep(howFar).name
      : plans === 'goal'
        ? `${chosen.chip} · full access`
        : chosen.chip;

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      // Closes this and only this. Left to travel on, the same press reaches
      // the window and stops the run behind it.
      event.stopPropagation();
      event.preventDefault();
      setOpen(false);
    };
    document.addEventListener('mousedown', away);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', away);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  return (
    <div className="ways" ref={root}>
      <button
        type="button"
        className="ways__chip"
        onClick={() => setOpen((was) => !was)}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={chosen.note}
      >
        <svg width="11" height="11" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path
            d="M2 3h8M2 6h8M2 9h5"
            stroke="currentColor"
            strokeWidth="1.3"
            strokeLinecap="round"
          />
        </svg>
        <span className="ways__label">{label}</span>
      </button>

      {open ? (
        <div className="ways__menu" role="listbox" aria-label="Whether to plan first">
          {CHOICES.map((choice) => {
            const blocked = choice.id === 'goal' && plans === 'plan';
            return (
            <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={choice.id === plans}
              aria-disabled={blocked ? 'true' : undefined}
              disabled={blocked}
              className={`ways__option ${choice.id === plans ? 'ways__option--chosen' : ''}${blocked ? ' ways__option--blocked' : ''}`}
              title={blocked ? 'Plan mode is on — finish or exit plan before starting a goal.' : choice.note}
              onClick={() => {
                if (blocked) return;
                onPlans(choice.id);
                setOpen(false);
              }}
            >
              <span className="ways__tick" aria-hidden="true">
                {choice.id === plans ? (
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
              <span className="ways__text">
                <span className="ways__name">
                  {choice.name}
                  {choice.id === 'research' ? (
                    <span className="ways__badge">
                      <svg width="10" height="10" viewBox="0 0 12 12" fill="none" aria-hidden="true">
                        <circle cx="5.2" cy="5.2" r="3.2" stroke="currentColor" strokeWidth="1.2" />
                        <path d="M7.5 7.5 10 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                      </svg>
                      Deep research
                    </span>
                  ) : null}
                </span>
                <span className="ways__note">{blocked ? 'Plan mode is on — finish or exit plan before starting a goal.' : choice.note}</span>
              </span>
            </button>
          );
          })}

          {/* Behind the choice it belongs to, so it is found by the hand that
              is already here and is out of the way of everybody else. */}
          {plans === 'research' ? (
            <div role="group" aria-label={researchWords.howFar}>
              <div
                className="ways__note"
                style={{ padding: 'var(--space-2) var(--space-2) 0 var(--space-5)' }}
                aria-hidden="true"
              >
                {researchWords.howFar}
              </div>
              {DEPTHS.map((one) => (
                <button
                  key={one.id}
                  type="button"
                  role="option"
                  aria-selected={one.id === howFar}
                  className={`ways__option ${one.id === howFar ? 'ways__option--chosen' : ''}`}
                  style={{ paddingLeft: 'var(--space-5)' }}
                  onClick={() => {
                    chooseDepth(one.id);
                    setHowFar(one.id);
                    setOpen(false);
                  }}
                >
                  <span className="ways__tick" aria-hidden="true">
                    {one.id === howFar ? (
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
                  <span className="ways__text">
                    <span className="ways__name">{one.name}</span>
                    <span className="ways__note">{one.note}</span>
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
