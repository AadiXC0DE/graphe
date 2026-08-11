import { PLAN_WORDS } from '../agent/plan';
import './PlanCard.css';

type Props = {
  steps: readonly string[];
  caveats: readonly string[];
  /** Null while it is still a question. Once answered it becomes the record of
   *  what was agreed, and the buttons go. */
  answered: 'went-ahead' | 'changing' | null;
  onGo: () => void;
  onChange: () => void;
};

/**
 * What the agent would do, before it does any of it.
 *
 * The list is the whole point: a designer's worst moment with a coding agent is
 * finding out afterwards that forty files changed. Numbered, in their own
 * language, with the safe option carrying the weight — the same grammar every
 * other question in the app uses.
 */
export default function PlanCard({ steps, caveats, answered, onGo, onChange }: Props) {
  return (
    <section className={`plan ${answered === null ? '' : 'plan--settled'}`} aria-label="What I would do">
      <h2 className="plan__heading">{PLAN_WORDS.heading}</h2>

      <ol className="plan__steps">
        {steps.map((step, index) => (
          <li key={`${index}-${step}`} className="plan__step">
            <span className="plan__number" aria-hidden="true">
              {index + 1}
            </span>
            <span className="plan__what">{step}</span>
          </li>
        ))}
      </ol>

      {caveats.length === 0 ? null : (
        <ul className="plan__caveats">
          {caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      )}

      {answered === null ? (
        <div className="plan__actions">
          {/* Safe first in the DOM, so it is first for the keyboard too. */}
          <button type="button" className="plan__button plan__button--change" onClick={onChange}>
            {PLAN_WORDS.alternative}
          </button>
          <button type="button" className="plan__button plan__button--go" onClick={onGo}>
            {PLAN_WORDS.confirm}
          </button>
        </div>
      ) : (
        <p className="plan__answered">
          {answered === 'went-ahead' ? 'You said go ahead.' : 'You wanted to change something.'}
        </p>
      )}
    </section>
  );
}
