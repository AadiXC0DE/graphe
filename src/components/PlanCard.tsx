import { useState } from 'react';

import { PLAN_WORDS } from '../agent/plan';
import './PlanCard.css';

type Props = {
  steps: readonly string[];
  caveats: readonly string[];
  /** Null while it is still a question. Once answered it becomes the record of
   *  what was agreed, and the buttons go. */
  answered: 'went-ahead' | 'changing' | null;
  /** What was agreed to, in the order proposed. The whole list when nothing was
   *  dropped, which is almost always. */
  onGo: (kept: readonly string[], dropped: readonly string[]) => void;
  onChange: () => void;
};

/**
 * What the agent would do, before it does any of it.
 *
 * The list is the whole point: a designer's worst moment with a coding agent is
 * finding out afterwards that forty files changed. Numbered, in their own
 * language, with the safe option carrying the weight — the same grammar every
 * other question in the app uses.
 *
 * Steps can be left out before agreeing. Most plans are agreed whole, so the
 * control is quiet until the pointer is near it; what it saves is the round trip
 * where somebody says "yes but not the third one" and waits for a new plan to
 * disagree with. Dropping is never deleting — it comes straight back, so trying
 * it costs nothing.
 */
export default function PlanCard({ steps, caveats, answered, onGo, onChange }: Props) {
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set());
  const settled = answered !== null;

  const kept = steps.filter((_, at) => !dropped.has(at));
  const left = steps.filter((_, at) => dropped.has(at));
  const nothingLeft = kept.length === 0 && steps.length > 0;

  const toggle = (at: number): void => {
    setDropped((was) => {
      const next = new Set(was);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  };

  return (
    <section className={`plan ${settled ? 'plan--settled' : ''}`} aria-label="What I would do">
      <h2 className="plan__heading">{PLAN_WORDS.heading}</h2>

      <ol className="plan__steps">
        {steps.map((step, index) => {
          const out = dropped.has(index);
          return (
            <li
              key={`${String(index)}-${step}`}
              className={`plan__step ${out ? 'plan__step--out' : ''}`}
            >
              <span className="plan__number" aria-hidden="true">
                {index + 1}
              </span>
              <span className="plan__what">{step}</span>
              {settled ? null : (
                <button
                  type="button"
                  className="plan__drop"
                  onClick={() => toggle(index)}
                  aria-pressed={out}
                  aria-label={out ? PLAN_WORDS.undrop : PLAN_WORDS.drop}
                  title={out ? PLAN_WORDS.undrop : PLAN_WORDS.drop}
                >
                  {out ? PLAN_WORDS.undrop : '\u2715'}
                </button>
              )}
            </li>
          );
        })}
      </ol>

      {caveats.length === 0 ? null : (
        <ul className="plan__caveats">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}

      {settled ? (
        <p className="plan__answered">
          {answered === 'went-ahead' ? 'You said go ahead.' : 'You wanted to change something.'}
        </p>
      ) : (
        <>
          {left.length === 0 ? null : (
            <p className="plan__left">
              {nothingLeft ? PLAN_WORDS.nothingLeft : PLAN_WORDS.dropped(left.length)}
            </p>
          )}
          <div className="plan__actions">
            {/* Safe first in the DOM, so it is first for the keyboard too. */}
            <button type="button" className="plan__button plan__button--change" onClick={onChange}>
              {PLAN_WORDS.alternative}
            </button>
            <button
              type="button"
              className="plan__button plan__button--go"
              onClick={() => onGo(kept, left)}
              disabled={nothingLeft}
            >
              {left.length === 0 ? PLAN_WORDS.confirm : PLAN_WORDS.confirmSome(kept.length)}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
