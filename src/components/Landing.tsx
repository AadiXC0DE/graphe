import SeeFirst from './SeeFirst';
import { useState } from 'react';
import type { Verdict } from '../design/gate';
import type { HandedOver, Landing as LandingState, WentOnline } from '../lib/ipc';
import { holdWords } from '../share/holding';
import { handoverWords } from '../share/handover';
import { reallyRuns, realSteps } from '../lib/showme';
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
  onDecide: (letIn: boolean, observed?: boolean) => void;
  /** How far the work has moved from the pictures that were agreed to, or null
   *  when nothing was compared. */
  gate: Verdict | null;
  /** Which line is in force, by id. */
  howMuch: string;
  /** Move the line. */
  onHowMuch: (id: string) => void;
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

/** Every word this band can put on screen, in one place. The band answers
 *  "what now?" — work that waits for a decision, and the one thing that leaves
 *  the machine. Nothing else lives here. */
export const SAYS = {
  heading: 'When the work is done',
  nothingWaiting:
    'Nothing waiting — everything you asked for is in your project.',
} as const;

/**
 * The band that answers "what now?".
 *
 * One thing and two doors. The one thing: work that waits to be looked at —
 * finished in a copy, photographed, and a decision asked for before anything
 * reaches the project. The two doors: handing work to whoever writes the code,
 * and saving a page of what changed. Nothing here reaches the network on a
 * single press; handing over opens its own confirmation first, and only the
 * second press does anything.
 */
export default function Landing({
  state,
  busy,
  showMe,
  going,
  outcome,
  onDecide,
  gate,
  howMuch,
  onHowMuch,
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

  const hasWorkToShow =
    waiting !== null ||
    decided !== null ||
    outcome !== null ||
    going !== null;

  return (
    <section className="landing" aria-label={SAYS.heading}>
      <h2 className="landing__title">{SAYS.heading}</h2>

      {/* Clear work goes in silently without moving the agreed picture. First,
          unchecked and stopped work all need a human answer: only a picture
          somebody actually saw is allowed to become the next baseline. */}
      {gate !== null && !gate.asks ? null : (
        <SeeFirst
          waiting={waiting}
          held={held}
          {...(looking === undefined ? {} : { looking })}
          busy={stopped}
          onDecide={onDecide}
          gate={gate}
          howMuch={howMuch}
          onHowMuch={onHowMuch}
        />
      )}

      {decided === null ? null : (
        <p className="landing__done">
          {decided.letIn ? holdWords.isIn : holdWords.isAside}{' '}
          <button type="button" className="landing__link" onClick={() => onUndo(decided.undoTo)}>
            {decided.letIn ? holdWords.undo : holdWords.bringBack}
          </button>
        </p>
      )}

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

      {!hasWorkToShow && !stopped ? (
        <p className="landing__quiet">{SAYS.nothingWaiting}</p>
      ) : null}

      <div className="landing__actions">
        <div className="landing__thing">
          <button
            type="button"
            className="landing__do landing__do--handover"
            onClick={() => setAsking((was) => !was)}
            disabled={state === null || stopped}
            aria-expanded={asking}
          >
            {going === 'developer' ? handoverWords.working : handoverWords.label}
          </button>
          {state?.canHandOver === false && state.handOverSays !== undefined ? (
            <p className="landing__why">{state.handOverSays}</p>
          ) : null}
          {showMe ? <p className="landing__runs">{reallyRuns.handOver}</p> : null}
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

        <button
          type="button"
          className="landing__quietdo landing__alone"
          onClick={onShare}
          disabled={busy}
        >
          Save a page of what changed
        </button>
      </div>
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