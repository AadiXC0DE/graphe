import { useRef, useState } from 'react';

import {
  PLAN_WORDS,
  decideOn,
  moved,
  type PlanDecision,
} from '../agent/plan';
import './PlanCard.css';

type Props = {
  steps: readonly string[];
  caveats: readonly string[];
  /** What it wants to know before starting, when the answer would change the
   *  list. Usually empty, and the card is the same card without them. */
  questions?: readonly string[];
  /** Null while it is still a question. Once answered it becomes the record of
   *  what was agreed, and the buttons go. */
  answered: 'went-ahead' | 'changing' | null;
  /** What was agreed to, in the order decided. The third argument carries the
   *  whole of it — order, notes, answers — for the sentence sent back. */
  onGo: (
    kept: readonly string[],
    dropped: readonly string[],
    decision: PlanDecision,
  ) => void;
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
 * It is a draft, not a verdict. A step can be struck out, moved, or have
 * something said about it, and where the request left something genuinely open
 * the questions that would change the plan are asked at the top — all of it
 * travelling back on one press rather than costing a round trip each.
 *
 * Every decision here is made in agent/plan.ts; this holds what somebody left
 * behind and hands it over.
 */
export default function PlanCard({ steps, caveats, questions = [], answered, onGo, onChange }: Props) {
  /** Where each proposed step now sits. The steps themselves are never
   *  rewritten, so a step put back is identical to one never moved. */
  const [order, setOrder] = useState<readonly number[]>(() => steps.map((_, at) => at));
  const [dropped, setDropped] = useState<ReadonlySet<number>>(new Set());
  const [notes, setNotes] = useState<Readonly<Record<number, string>>>({});
  const [answers, setAnswers] = useState<Readonly<Record<number, string>>>({});
  /** Which step's note is open for writing. */
  const [writing, setWriting] = useState<number | null>(null);
  /** Said out loud after a move, for somebody who cannot see the list shift. */
  const [heard, setHeard] = useState('');
  const noteBox = useRef<HTMLTextAreaElement | null>(null);

  const settled = answered !== null;
  const decision = decideOn(steps, order, dropped, notes, questions, answers);
  const kept = decision.kept.map((one) => one.step);
  const nothingLeft = kept.length === 0 && steps.length > 0;

  const toggle = (at: number): void => {
    setDropped((was) => {
      const next = new Set(was);
      if (next.has(at)) next.delete(at);
      else next.add(at);
      return next;
    });
  };

  /* The moved step keeps its own key, so React moves the button rather than
     replacing it — which is what keeps the focus on the thing that moved and
     lets somebody press again without reaching for it a second time. */
  const move = (place: number, by: -1 | 1): void => {
    const next = moved(order, place, by);
    if (next === order) return;
    setOrder(next);
    setHeard(PLAN_WORDS.nowAt(place + by + 1, order.length));
  };

  const openNote = (at: number): void => {
    setWriting(at);
    // After the box exists, not before.
    requestAnimationFrame(() => noteBox.current?.focus());
  };

  return (
    <section className={`plan ${settled ? 'plan--settled' : ''}`} aria-label="What I would do">
      {questions.length === 0 || settled ? null : (
        <div className="plan__asking">
          <h2 className="plan__heading">{PLAN_WORDS.questions(questions.length)}</h2>
          <ul className="plan__questions">
            {questions.map((question, at) => (
              <li className="plan__question" key={question}>
                <label className="plan__asked" htmlFor={`plan-answer-${String(at)}`}>
                  {question}
                </label>
                <input
                  id={`plan-answer-${String(at)}`}
                  className="plan__answer"
                  type="text"
                  value={answers[at] ?? ''}
                  onChange={(event) => setAnswers((was) => ({ ...was, [at]: event.target.value }))}
                />
              </li>
            ))}
          </ul>
          <p className="plan__hint">{PLAN_WORDS.questionsHint}</p>
        </div>
      )}

      <h2 className="plan__heading">{PLAN_WORDS.heading}</h2>

      <ol className="plan__steps">
        {order.map((at, place) => {
          const step = steps[at];
          if (step === undefined) return null;
          const out = dropped.has(at);
          const note = (notes[at] ?? '').trim();
          return (
            <li
              key={at}
              className={`plan__step ${out ? 'plan__step--out' : ''}`}
              onKeyDown={(event) => {
                // The shortcut for somebody who is already on the row and does
                // not want to reach for a 12px arrow to move a step twice.
                if (!event.altKey || settled) return;
                if (event.key === 'ArrowUp') move(place, -1);
                else if (event.key === 'ArrowDown') move(place, 1);
                else return;
                event.preventDefault();
              }}
            >
              <span className="plan__number" aria-hidden="true">
                {place + 1}
              </span>
              <div className="plan__body">
                <span className="plan__what">{step}</span>
                {note === '' || writing === at ? null : <p className="plan__note">{note}</p>}
                {writing === at ? (
                  <div className="plan__writing">
                    <label className="plan__hidden" htmlFor={`plan-note-${String(at)}`}>
                      {PLAN_WORDS.saidLabel}
                    </label>
                    <textarea
                      id={`plan-note-${String(at)}`}
                      ref={noteBox}
                      className="plan__notebox"
                      rows={2}
                      placeholder={PLAN_WORDS.sayHint}
                      value={notes[at] ?? ''}
                      onChange={(event) => setNotes((was) => ({ ...was, [at]: event.target.value }))}
                      onKeyDown={(event) => {
                        if (event.key === 'Escape' || (event.key === 'Enter' && !event.shiftKey)) {
                          event.preventDefault();
                          setWriting(null);
                        }
                      }}
                    />
                    <button
                      type="button"
                      className="plan__done"
                      onClick={() => setWriting(null)}
                    >
                      {PLAN_WORDS.sayDone}
                    </button>
                  </div>
                ) : null}
              </div>
              {settled ? null : (
                <span className="plan__controls">
                  {/* Never `disabled`: a control that goes dead under the finger
                      hands the focus back to the page, and the whole point of
                      moving a step twice is not having to find it again. */}
                  <button
                    type="button"
                    className="plan__move"
                    onClick={() => move(place, -1)}
                    aria-disabled={place === 0}
                    aria-label={PLAN_WORDS.up}
                    title={PLAN_WORDS.up}
                  >
                    {'↑'}
                  </button>
                  <button
                    type="button"
                    className="plan__move"
                    onClick={() => move(place, 1)}
                    aria-disabled={place === order.length - 1}
                    aria-label={PLAN_WORDS.down}
                    title={PLAN_WORDS.down}
                  >
                    {'↓'}
                  </button>
                  <button
                    type="button"
                    className={`plan__note-open ${note === '' ? '' : 'plan__note-open--said'}`}
                    onClick={() => openNote(at)}
                    aria-expanded={writing === at}
                    aria-label={PLAN_WORDS.say}
                    title={PLAN_WORDS.say}
                  >
                    {'✎'}
                  </button>
                  <button
                    type="button"
                    className="plan__drop"
                    onClick={() => toggle(at)}
                    aria-pressed={out}
                    aria-label={out ? PLAN_WORDS.undrop : PLAN_WORDS.drop}
                    title={out ? PLAN_WORDS.undrop : PLAN_WORDS.drop}
                  >
                    {out ? PLAN_WORDS.undrop : '✕'}
                  </button>
                </span>
              )}
            </li>
          );
        })}
      </ol>

      <p className="plan__hidden" aria-live="polite">
        {heard}
      </p>

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
          {decision.dropped.length === 0 ? null : (
            <p className="plan__left">
              {nothingLeft ? PLAN_WORDS.nothingLeft : PLAN_WORDS.dropped(decision.dropped.length)}
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
              onClick={() => onGo(kept, decision.dropped, decision)}
              disabled={nothingLeft}
            >
              {decision.dropped.length === 0 ? PLAN_WORDS.confirm : PLAN_WORDS.confirmSome(kept.length)}
            </button>
          </div>
        </>
      )}
    </section>
  );
}
