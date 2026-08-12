import { useEffect, useRef, useState } from 'react';
import { researchWords } from '../agent/research';
import './HowToWork.css';

export type Plans = 'auto' | 'always' | 'never' | 'research';

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
];

export default function HowToWork({ plans, onPlans }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const chosen = CHOICES.find((one) => one.id === plans) ?? CHOICES[0]!;

  /* Click away and escape both close it — people reach for both. */
  useEffect(() => {
    if (!open) return;
    const away = (event: MouseEvent) => {
      if (root.current !== null && !root.current.contains(event.target as Node)) setOpen(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
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
        <span className="ways__label">{chosen.chip}</span>
      </button>

      {open ? (
        <div className="ways__menu" role="listbox" aria-label="Whether to plan first">
          {CHOICES.map((choice) => (
            <button
              key={choice.id}
              type="button"
              role="option"
              aria-selected={choice.id === plans}
              className={`ways__option ${choice.id === plans ? 'ways__option--chosen' : ''}`}
              onClick={() => {
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
                <span className="ways__name">{choice.name}</span>
                <span className="ways__note">{choice.note}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
