import SeeFirst from './SeeFirst';
import { useState } from 'react';
import type { HandedOver, Landing as LandingState, WentOnline } from '../lib/ipc';
import { holdWords } from '../share/holding';
import { handoverWords } from '../share/handover';
import { behind, reallyRuns, realSteps } from '../lib/showme';
import './Landing.css';

/** What came of the last thing that left, or tried to. */
export type Outcome =
  | { kind: 'handed'; handed: HandedOver }
  | { kind: 'online'; went: WentOnline }
  | null;

type Props = {
  /** Null until the shell has answered, so nothing flashes on the way in. */
  state: LandingState | null;
  busy: boolean;
  showMe: boolean;
  /** Which of the two is going, if either is. */
  going: 'developer' | 'online' | null;
  outcome: Outcome;
  onHoldBack: (on: boolean) => void;
  onDecide: (letIn: boolean) => void;
  /** Undo letting work in — the same put-back as anywhere else. */
  onUndo: (versionId: string) => void;
  onHandOver: () => void;
  onShare: () => void;
  onOpenLink: (address: string) => void;
  /** What was just decided about work, and the version that undoes it. Null
   *  until somebody decides something. */
  decided: { letIn: boolean; undoTo: string } | null;
  /** True while the pictures are still being taken. */
  looking?: boolean;
};

/**
 * The band that answers "what now?".
 *
 * Two things that matter: work that waits to be looked at, and work handed to
 * whoever writes the code. Putting it online used to live here as a button —
 * that is a conversation with the agent now, because every host is different
 * and a button that only works for one of them is a trap.
 *
 * Nothing here reaches the network on a single press. Handing over opens its
 * own confirmation first, saying in the shell's own words what is about to
 * happen, and only the second press does anything.
 */
export default function Landing({
  state,
  busy,
  showMe,
  going,
  outcome,
  onHoldBack,
  onDecide,
  onUndo,
  onHandOver,
  onShare,
  onOpenLink,
  decided,
  looking,
}: Props) {
  const [asking, setAsking] = useState(false);

  const waiting = state?.waiting ?? null;
  const held = state?.held ?? null;
  const stopped = busy || going !== null;

  return (
    <section className="landing" aria-label="Ready to ship">
      <h2 className="landing__title">Ready to ship</h2>

      <label className="landing__switch">
        <input
          type="checkbox"
          checked={state?.holdBack === true}
          disabled={state === null || stopped}
          onChange={(event) => onHoldBack(event.target.checked)}
        />
        <span className="landing__switchtext">
          <span className="landing__switchlabel">{holdWords.label}</span>
          <span className="landing__switchhint">{holdWords.hint}</span>
        </span>
      </label>

      <SeeFirst
        waiting={waiting}
        held={held}
        {...(looking === undefined ? {} : { looking })}
        busy={stopped}
        onDecide={onDecide}
      />

      {decided === null ? null : (
        <p className="landing__done">
          {decided.letIn ? holdWords.isIn : holdWords.isAside}{' '}
          <button type="button" className="landing__link" onClick={() => onUndo(decided.undoTo)}>
            {decided.letIn ? holdWords.undo : holdWords.bringBack}
          </button>
        </p>
      )}

      <div className="landing__thing">
        <button
          type="button"
          className="landing__do"
          onClick={() => setAsking((was) => !was)}
          disabled={state === null || stopped}
          aria-expanded={asking}
        >
          {going === 'developer' ? handoverWords.working : handoverWords.label}
        </button>
        <p className="landing__hint">{handoverWords.hint}</p>
        {showMe ? <p className="landing__runs">{reallyRuns.handOver}</p> : null}
        {state?.canHandOver === false && state.handOverSays !== undefined ? (
          <p className="landing__why">{state.handOverSays}</p>
        ) : null}
        {asking ? (
          <div className="landing__confirm">
            <p className="landing__warning">{handoverWords.aboutTo}</p>
            <div className="landing__row">
              <button
                type="button"
                className="landing__do landing__do--first"
                onClick={() => {
                  setAsking(false);
                  onHandOver();
                }}
              >
                Yes, send it
              </button>
              <button type="button" className="landing__quietdo" onClick={() => setAsking(false)}>
                Not now
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {outcome === null ? null : (
        <div className="landing__outcome" role="status">
          <p className="landing__says">
            {outcome.kind === 'handed' ? outcome.handed.says : outcome.went.says}
          </p>
          {address(outcome) === null ? null : (
            <button
              type="button"
              className="landing__link"
              onClick={() => {
                const where = address(outcome);
                if (where !== null) onOpenLink(where);
              }}
            >
              {address(outcome)}
            </button>
          )}
          {showMe && steps(outcome).length > 0 ? (
            <ul className="landing__real">
              {realSteps(steps(outcome)).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <div className="landing__thing">
        <button
          type="button"
          className="landing__quietdo landing__alone"
          onClick={onShare}
          disabled={busy}
        >
          Save a page of what changed
        </button>
        <p className="landing__hint">
          Every before-and-after with a sentence beside it, in one file you send yourself.
        </p>
        {showMe ? <p className="landing__runs">{reallyRuns.page}</p> : null}
      </div>

      {showMe ? <p className="landing__switchhint">{behind.landing}</p> : null}
    </section>
  );
}

function address(outcome: Outcome): string | null {
  if (outcome === null) return null;
  return outcome.kind === 'handed' ? outcome.handed.address : outcome.went.address;
}

function steps(outcome: Outcome): readonly string[] {
  if (outcome === null) return [];
  return outcome.kind === 'handed' ? outcome.handed.steps : outcome.went.steps;
}
