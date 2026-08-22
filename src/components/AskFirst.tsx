import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';

import { allAnswered, askWords, type Answers, type Question } from '../agent/asking';
import './AskFirst.css';

/** The turn ended with the card still open. askWords has no sentence for it,
 *  and it has to say plainly that nothing was answered. */

/** What is picked against one question while the card is still a question.
 *  `words` survives switching away from "Something else" and back. */
type Picked = {
  readonly labels: readonly string[];
  readonly own: boolean;
  readonly words: string;
};

const NOTHING: Picked = { labels: [], own: false, words: '' };

type Props = {
  questions: readonly Question[];
  /** What was picked, once it has been. Empty while it is still a question. */
  answers: Answers;
  /** Null while it is still a question; after that, the record of how it closed. */
  answered: 'answered' | 'waved-through' | 'withdrawn' | null;
  /** Null is a real answer — somebody saying to decide for them. */
  onAnswer: (answers: Answers | null) => void;
};

/**
 * The few things it would rather not guess, asked before the work starts.
 *
 * It asks before it starts or it does not ask, so this is the one moment in the
 * run where somebody is meant to stop and read. Everything after answering can
 * happen with nobody watching — which is why the card carries the weight of a
 * question and then, once answered, stops being a control at all.
 *
 * Every word on it comes from agent/asking.ts. The picking is held here; the
 * turn only hears the answer.
 */
export default function AskFirst({ questions, answers, answered, onAnswer }: Props) {
  const base = useId();
  const [picks, setPicks] = useState<Readonly<Record<string, Picked>>>({});
  /** Which box in a several-answer question the keyboard comes back to. */
  const [roving, setRoving] = useState<Readonly<Record<string, number>>>({});
  const wordBoxes = useRef(new Map<string, HTMLInputElement | null>());

  const chosen = useMemo<Answers>(() => {
    const out: Record<string, readonly string[]> = {};
    for (const one of questions) {
      const pick = picks[one.question] ?? NOTHING;
      const words = pick.words.trim();
      // "Something else" is not itself an answer — what they typed is.
      const said = [...pick.labels, ...(pick.own && words !== '' ? [words] : [])];
      if (said.length > 0) out[one.question] = said;
    }
    return out;
  }, [questions, picks]);

  const ready = allAnswered(questions, chosen);

  const change = useCallback((question: string, to: (was: Picked) => Picked) => {
    setPicks((current) => ({ ...current, [question]: to(current[question] ?? NOTHING) }));
  }, []);

  /** One of the model's own choices. Single picking replaces; several toggles. */
  const pick = useCallback(
    (one: Question, label: string) => {
      change(one.question, (was) =>
        one.many
          ? {
              ...was,
              labels: was.labels.includes(label)
                ? was.labels.filter((kept) => kept !== label)
                : [...was.labels, label],
            }
          : { ...was, labels: [label], own: false },
      );
    },
    [change],
  );

  const pickOwn = useCallback(
    (one: Question) => {
      change(one.question, (was) =>
        one.many ? { ...was, own: !was.own } : { ...was, labels: [], own: true },
      );
    },
    [change],
  );

  /** Typing is picking: nobody writes in a box they did not mean to use. */
  const say = useCallback(
    (question: string, words: string) => {
      change(question, (was) => ({ ...was, own: true, words }));
    },
    [change],
  );

  const send = useCallback(() => {
    if (ready) onAnswer(chosen);
  }, [ready, chosen, onAnswer]);

  /* Arrows move within a question, the way they already do between radios. A
     several-answer group is one tab stop, so Tab still steps question to
     question rather than choice to choice. */
  const stepWithin = useCallback((event: KeyboardEvent<HTMLDivElement>, question: string) => {
    const on = event.target;
    if (!(on instanceof HTMLInputElement) || on.type !== 'checkbox') return;
    const by =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? -1
          : 0;
    const end = event.key === 'Home' ? 'first' : event.key === 'End' ? 'last' : null;
    if (by === 0 && end === null) return;

    const boxes = [...event.currentTarget.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')];
    const at = boxes.indexOf(on);
    if (at === -1 || boxes.length === 0) return;
    const to = end === null ? (at + by + boxes.length) % boxes.length : end === 'first' ? 0 : boxes.length - 1;
    const next = boxes[to];
    if (next === undefined) return;
    event.preventDefault();
    next.focus();
    setRoving((current) => ({ ...current, [question]: to }));
  }, []);

  /* Enter sends, from anywhere in the card including the free-text box. Buttons
     keep their own Enter, or the primary would fire twice. */
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Enter') return;
    if (event.shiftKey || event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.target instanceof HTMLButtonElement) return;
    if (!ready) return;
    event.preventDefault();
    send();
  };

  const headingId = `${base}-heading`;

  if (answered !== null) {
    return (
      <section className="askfirst askfirst--settled" aria-label={askWords.heading}>
        <ul className="askfirst__record">
          {questions.map((one) => {
            const said = answers[one.question] ?? [];
            return (
              <li key={one.question}>
                <span className="askfirst__was">{one.question}</span>
                {said.length === 0 ? null : (
                  <span className="askfirst__picked">{said.join(', ')}</span>
                )}
              </li>
            );
          })}
        </ul>
        <p className="askfirst__said">
          {answered === 'answered'
            ? askWords.answered
            : answered === 'waved-through'
              ? askWords.wavedThrough
              : askWords.ended}
        </p>
      </section>
    );
  }

  return (
    <section className="askfirst" aria-labelledby={headingId} onKeyDown={onKeyDown}>
      <h2 className="askfirst__heading" id={headingId}>
        {askWords.heading}
      </h2>
      <p className="askfirst__why">{askWords.why}</p>

      <ul className="askfirst__questions">
        {questions.map((one, at) => {
          const pickedHere = picks[one.question] ?? NOTHING;
          const askedId = `${base}-q${String(at)}`;
          const ownId = `${askedId}-own`;
          const lands = roving[one.question] ?? 0;
          const kind = one.many ? 'askfirst__choice askfirst__choice--many' : 'askfirst__choice';

          return (
            <li className="askfirst__question" key={one.question}>
              {/* The header names the axis being decided, so four questions read
                  as four decisions rather than four paragraphs. It is derived
                  from the question, so nothing is read out twice. */}
              <p className="askfirst__header" aria-hidden="true">
                {one.header}
              </p>
              <p className="askfirst__asked" id={askedId}>
                {one.question}
              </p>

              <div
                className="askfirst__choices"
                role={one.many ? 'group' : 'radiogroup'}
                aria-labelledby={askedId}
                onKeyDown={one.many ? (event) => stepWithin(event, one.question) : undefined}
              >
                {one.choices.map((choice, index) => {
                  const id = `${askedId}-c${String(index)}`;
                  const on = pickedHere.labels.includes(choice.label);
                  return (
                    <label className={kind} key={choice.label} data-on={on}>
                      <input
                        id={id}
                        className="askfirst__input"
                        type={one.many ? 'checkbox' : 'radio'}
                        {...(one.many
                          ? {
                              tabIndex: index === lands ? 0 : -1,
                              onFocus: () =>
                                setRoving((current) => ({ ...current, [one.question]: index })),
                            }
                          : { name: `${base}-n${String(at)}` })}
                        checked={on}
                        aria-labelledby={`${id}-label`}
                        {...(choice.note === '' ? {} : { 'aria-describedby': `${id}-note` })}
                        onChange={() => pick(one, choice.label)}
                      />
                      <span className="askfirst__mark" aria-hidden="true" />
                      <span className="askfirst__text">
                        <span className="askfirst__label" id={`${id}-label`}>
                          {choice.label}
                        </span>
                        {choice.note === '' ? null : (
                          <span className="askfirst__note" id={`${id}-note`}>
                            {choice.note}
                          </span>
                        )}
                      </span>
                    </label>
                  );
                })}

                {/* Always offered. The choices are the agent's guesses, and being
                    unable to say anything else would make a wrong guess binding. */}
                <div className="askfirst__own">
                  <label className={kind} data-on={pickedHere.own}>
                    <input
                      id={ownId}
                      className="askfirst__input"
                      type={one.many ? 'checkbox' : 'radio'}
                      {...(one.many
                        ? {
                            tabIndex: one.choices.length === lands ? 0 : -1,
                            onFocus: () =>
                              setRoving((current) => ({
                                ...current,
                                [one.question]: one.choices.length,
                              })),
                          }
                        : { name: `${base}-n${String(at)}` })}
                      checked={pickedHere.own}
                      aria-labelledby={`${ownId}-label`}
                      onChange={() => pickOwn(one)}
                      onClick={(event) => {
                        // Only a real click. Arrowing onto it must leave the
                        // focus on the group, or there is no arrowing off it.
                        if (event.detail === 0) return;
                        requestAnimationFrame(() => wordBoxes.current.get(one.question)?.focus());
                      }}
                    />
                    <span className="askfirst__mark" aria-hidden="true" />
                    <span className="askfirst__text">
                      <span className="askfirst__label" id={`${ownId}-label`}>
                        {askWords.ownWords}
                      </span>
                    </span>
                  </label>

                  <div
                    className="askfirst__reveal"
                    data-open={pickedHere.own}
                    {...(pickedHere.own ? {} : { 'aria-hidden': true })}
                  >
                    <div className="askfirst__revealed">
                      <input
                        type="text"
                        className="askfirst__words"
                        ref={(box) => {
                          wordBoxes.current.set(one.question, box);
                        }}
                        value={pickedHere.words}
                        placeholder={askWords.ownWordsPlaceholder}
                        aria-label={askWords.ownWords}
                        disabled={!pickedHere.own}
                        onChange={(event) => say(one.question, event.target.value)}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="askfirst__actions">
        {/* The plain answer first, so it is first for the keyboard too. */}
        <button
          type="button"
          className="askfirst__button askfirst__button--skip"
          onClick={() => onAnswer(null)}
        >
          {askWords.skip}
        </button>
        {/* Dimmed rather than `disabled`: its label is the instruction for
            getting it live, and a disabled button cannot be reached to read. */}
        <button
          type="button"
          className="askfirst__button askfirst__button--go"
          aria-disabled={!ready}
          onClick={send}
        >
          {ready ? askWords.send : askWords.needsAnswers}
        </button>
      </div>
    </section>
  );
}
