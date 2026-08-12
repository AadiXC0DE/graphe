import { useState } from 'react';
import type { HandedOver, Landing as LandingState, WentOnline } from '../lib/ipc';
import { holdWords } from '../share/holding';
import { handoverWords } from '../share/handover';
import { onlineWords } from '../share/online';
import { behind, realSteps } from '../lib/showme';
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
  onPutOnline: () => void;
  onShare: () => void;
  onOpenLink: (address: string) => void;
  /** What was just decided about work, and the version that undoes it. Null
   *  until somebody decides something. */
  decided: { letIn: boolean; undoTo: string } | null;
};

/** The two things that can leave this computer, and what each says before it
 *  does. Nothing here is a paraphrase — the sentences are the ones the shell
 *  would use, so what is promised and what happens cannot drift apart. */
const SENDING = {
  developer: {
    label: handoverWords.label,
    hint: handoverWords.hint,
    warning: handoverWords.aboutTo,
    yes: 'Yes, hand it over',
  },
  online: {
    label: onlineWords.label,
    hint: onlineWords.hint,
    warning: `${onlineWords.aboutTo} ${onlineWords.andSo}`,
    yes: onlineWords.confirm,
  },
} as const;

/**
 * The band that answers "what now?".
 *
 * Three things that are one thing: work that waits to be looked at, work handed
 * to whoever writes the code, and the project itself put where anybody can open
 * it. They live together because they are the same moment — the point where a
 * designer's afternoon stops being only theirs.
 *
 * Nothing here reaches the network on a single press. Both of the two that can
 * open the band's own confirmation first, saying in the shell's own words what
 * is about to happen, and only the second press does anything.
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
  onPutOnline,
  onShare,
  onOpenLink,
  decided,
}: Props) {
  /* Which of the two has been pressed once. The second press is the one that
     does anything, and pressing anything else puts this away. */
  const [asking, setAsking] = useState<'developer' | 'online' | null>(null);

  const waiting = state?.waiting ?? null;
  const stopped = busy || going !== null;

  const ask = (which: 'developer' | 'online') => {
    setAsking((was) => (was === which ? null : which));
  };

  const goAhead = () => {
    const which = asking;
    setAsking(null);
    if (which === 'developer') onHandOver();
    if (which === 'online') onPutOnline();
  };

  return (
    <section className="landing" aria-label="When it’s ready">
      <h2 className="landing__title">When it’s ready</h2>

      {/* The switch, where the hand already is rather than in a settings
          screen. Everything it changes is described right under it. */}
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

      {waiting === null ? null : (
        <div className="landing__waiting" role="group" aria-label="Work waiting for you">
          <p className="landing__doing">{waiting.doing}</p>
          <p className="landing__says">
            {waiting.state === 'making' ? holdWords.making : holdWords.waiting}
          </p>
          {waiting.state === 'making' ? null : (
            <div className="landing__row">
              <button
                type="button"
                className="landing__do landing__do--first"
                onClick={() => onDecide(true)}
                disabled={stopped}
              >
                {holdWords.approve}
              </button>
              <button
                type="button"
                className="landing__quietdo"
                onClick={() => onDecide(false)}
                disabled={stopped}
              >
                {holdWords.setAside}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Both answers undo through the same door, because both are a version
          and putting the project at a version is one thing this app does. */}
      {decided === null ? null : (
        <p className="landing__done">
          {decided.letIn ? holdWords.isIn : holdWords.isAside}{' '}
          <button type="button" className="landing__link" onClick={() => onUndo(decided.undoTo)}>
            {decided.letIn ? holdWords.undo : holdWords.bringBack}
          </button>
        </p>
      )}

      {/* The two that can send something. Each says what it would do before it
          is allowed to do it, in the same words the shell uses. */}
      {(['developer', 'online'] as const).map((which) => {
        const words = SENDING[which];
        const can = which === 'developer' ? state?.canHandOver : state?.canPutOnline;
        const why = which === 'developer' ? state?.handOverSays : state?.onlineSays;
        const open = asking === which;
        return (
          <div key={which} className="landing__thing">
            <button
              type="button"
              className="landing__do"
              onClick={() => ask(which)}
              disabled={state === null || stopped}
              aria-expanded={open}
            >
              {going === which ? (which === 'online' ? onlineWords.working : handoverWords.working) : words.label}
            </button>
            <p className="landing__hint">{words.hint}</p>
            {can === false && why !== undefined ? <p className="landing__why">{why}</p> : null}
            {open ? (
              <div className="landing__confirm">
                <p className="landing__warning">{words.warning}</p>
                <div className="landing__row">
                  <button type="button" className="landing__do landing__do--first" onClick={goAhead}>
                    {words.yes}
                  </button>
                  <button type="button" className="landing__quietdo" onClick={() => setAsking(null)}>
                    Not now
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}

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
          {/* The real commands, only for somebody who asked to see them, and
              only out of the one file where naming the machinery is allowed. */}
          {showMe && steps(outcome).length > 0 ? (
            <ul className="landing__real">
              {realSteps(steps(outcome)).map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ul>
          ) : null}
        </div>
      )}

      <button type="button" className="landing__quietdo landing__alone" onClick={onShare} disabled={busy}>
        Send this to someone
      </button>

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
