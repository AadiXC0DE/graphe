import { useId, useState } from 'react';

import {
  HOW_MUCH,
  gateWords,
  howMuchBy,
  saysHowMuch,
  type Verdict,
} from '../design/gate';
import {
  NOTHING_CAME_OUT,
  nothingCameOut,
  readsHeld,
  whichToShow,
  type Held,
  type Sight,
} from '../diff/holdshot';
import type { WaitingWork } from '../lib/ipc';
import { holdWords } from '../share/holding';
import './SeeFirst.css';

/**
 * The answer, with the picture attached.
 *
 * Work that waits is the safest thing this app does and the hardest to judge:
 * "let it in" means nothing to somebody who cannot read the change. So the two
 * answers arrive under a photograph of what the change would look like, taken in
 * the copy before any of it reaches the files on screen.
 *
 * A picture that could not be taken never removes the decision: a project that
 * will not build says so where the picture would have been, and is still
 * decided. What does hold the work is a picture that came out and looks
 * different from the last one somebody agreed to — that reading is made in
 * `src/design/gate.ts` and only shown here.
 */

export type SeeFirstProps = {
  /** What is waiting, or null when nothing is. */
  waiting: WaitingWork | null;
  /** The pictures, or null while there are none yet. */
  held: Held | null;
  /** True while they are still being taken. */
  looking?: boolean;
  /** Something else is going on; both answers wait for it. */
  busy?: boolean;
  onDecide: (letIn: boolean, observed?: boolean) => void;
  /** What the pictures were compared to, or null when nothing was compared. */
  gate?: Verdict | null;
  /** Which line is in force, by id. */
  howMuch?: string;
  /** Move the line. Left out and the control is not offered. */
  onHowMuch?: (id: string) => void;
};

export default function SeeFirst({
  waiting,
  held,
  looking = false,
  busy = false,
  onDecide,
  gate = null,
  howMuch,
  onHowMuch,
}: SeeFirstProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const [showingLine, setShowingLine] = useState(false);
  const name = useId();
  const lineId = useId();

  if (waiting === null) return null;
  if (waiting.state !== 'making' && waiting.state !== 'waiting') return null;

  const sights = held?.sights ?? [];
  const at = (id: string | null) =>
    id === null ? null : (sights.find((one) => one.id === id) ?? null);
  // The gate opens on whichever width moved, because that is the one being
  // asked about; anything else opens on the widest, where the work was done.
  const chosen =
    at(picked) ?? (gate?.stops === true ? at(gate.open) : null) ?? (held === null ? null : whichToShow(held));
  const reading = held === null ? null : readsHeld(held);
  const blank = held !== null && nothingCameOut(held);
  const settled = waiting.state === 'waiting';
  /* The pictures came out and one of them is wrong. Everything below this line
     is the same two answers the other way round — the safe one carries the
     weight and the other says what it is. Nobody is stopped: a photograph is
     evidence, not a veto, and the reading itself is already on screen. */
  const doubt = reading !== null && !reading.ok && !blank && chosen !== null;
  const stopped = gate?.stops === true;
  // The gate has already named the widths that came back without a picture.
  const named = gate?.standing === 'unchecked';
  const safeFirst = stopped || doubt;
  const line = howMuchBy(howMuch);

  return (
    <section className="seefirst" aria-label="Work waiting for you">
      <p className="seefirst__doing">{waiting.doing}</p>
      <p className="seefirst__says">{settled ? holdWords.waiting : holdWords.making}</p>

      <div className="seefirst__look" id={name}>
        <h3 className="seefirst__title">{stopped ? gateWords.heading : holdWords.seeIt}</h3>

        {gate === null || gate.standing === 'clear' ? null : (
          <p className={stopped ? 'seefirst__stopped' : 'seefirst__honest'}>{gate.says}</p>
        )}

        {sights.length > 1 ? (
          <div className="seefirst__sizes" role="group" aria-label={holdWords.atWidth}>
            {sights.map((sight) => (
              <button
                key={sight.id}
                type="button"
                className={`seefirst__size ${chosen?.id === sight.id ? 'seefirst__size--on' : ''}`}
                onClick={() => setPicked(sight.id)}
                aria-pressed={chosen?.id === sight.id}
              >
                {sight.name}
                {mark(gate, sight.id) === null ? null : (
                  <span className="seefirst__mark">{mark(gate, sight.id)}</span>
                )}
              </button>
            ))}
          </div>
        ) : null}

        {chosen === null ? (
          <p className="seefirst__nothing">
            {looking ? holdWords.looking : (reading?.says ?? NOTHING_CAME_OUT)}
          </p>
        ) : (
          <Pictures sight={chosen} />
        )}

        {/* How far this width is from the one that was agreed to, in a number,
            so "it looks different" does not send somebody hunting. */}
        {found(gate, chosen?.id ?? null) === null ? null : (
          <p className="seefirst__trouble">{found(gate, chosen?.id ?? null)?.says}</p>
        )}

        {/* What is true about the whole set rather than about the width in front
            of somebody — and not said twice when the frame already says it. */}
        {reading !== null && !reading.ok && chosen !== null && !blank && !named ? (
          <p className="seefirst__honest">{reading.says}</p>
        ) : null}
        {blank || (chosen === null && !looking) ? (
          <p className="seefirst__honest">{holdWords.decideAnyway}</p>
        ) : null}

        {/* The precise control, behind the thing it is precise about. */}
        {gate === null || onHowMuch === undefined ? null : (
          <div className="seefirst__line">
            <button
              type="button"
              className="seefirst__lineopen"
              onClick={() => setShowingLine((was) => !was)}
              aria-expanded={showingLine}
              aria-controls={lineId}
            >
              {gateWords.howMuch}
            </button>
            {showingLine ? (
              <div className="seefirst__lineinner" id={lineId}>
                <div className="seefirst__choices" role="group" aria-label={gateWords.howMuch}>
                  {HOW_MUCH.map((one) => (
                    <button
                      key={one.id}
                      type="button"
                      className={`seefirst__choice ${one.id === line.id ? 'seefirst__choice--on' : ''}`}
                      onClick={() => onHowMuch(one.id)}
                      aria-pressed={one.id === line.id}
                    >
                      {one.name}
                    </button>
                  ))}
                </div>
                <p className="seefirst__honest">{saysHowMuch(line)}</p>
              </div>
            ) : null}
          </div>
        )}
      </div>

      {settled ? (
        <>
          {doubt && !stopped ? <p className="seefirst__caution">{holdWords.lookAgain}</p> : null}
          {/* The one that carries the weight comes first, in the order somebody
              reads as well as in the way it looks. */}
          <div className="seefirst__row">
            {(safeFirst ? [false, true] : [true, false]).map((letIn, order) => (
              <button
                key={String(letIn)}
                type="button"
                className={order === 0 ? 'seefirst__do seefirst__do--first' : 'seefirst__quietdo'}
                onClick={() => onDecide(letIn, true)}
                disabled={busy}
              >
                {letIn ? proceeds(gate, doubt) : holdWords.setAside}
              </button>
            ))}
          </div>
          {stopped ? <p className="seefirst__honest">{gateWords.moves}</p> : null}
        </>
      ) : null}
    </section>
  );
}

/** The word beside a width's name. A colour on its own would say nothing to
 *  half the people who need it. */
function mark(gate: Verdict | null, id: string): string | null {
  if (gate === null) return null;
  if (gate.unchecked.some((one) => one.id === id)) return gateWords.missing;
  return found(gate, id)?.stops === true ? gateWords.moved : null;
}

function found(gate: Verdict | null, id: string | null) {
  if (gate === null || id === null) return null;
  const reading = gate.readings.find((one) => one.id === id) ?? null;
  return reading !== null && reading.stops ? reading : null;
}

/** What the answer that proceeds is called. Taking a change the gate stopped
 *  also moves the mark it is measured against, so it says something else. */
function proceeds(gate: Verdict | null, doubt: boolean): string {
  if (gate?.stops === true) return gate.proceed;
  return doubt ? holdWords.approveAnyway : holdWords.approve;
}

/** One width. Whatever came out is shown; whatever did not says why in the
 *  space it would have taken, so there is never a frame with nothing in it. */
function Pictures({ sight }: { sight: Sight }) {
  const both = sight.now !== null && sight.changed !== null;
  return (
    <>
      <div className={`seefirst__pair ${both ? '' : 'seefirst__pair--one'}`}>
        {sight.now === null && sight.changed === null ? (
          <p className="seefirst__blank">{sight.missing}</p>
        ) : null}
        {sight.now === null ? null : (
          <figure className="seefirst__half">
            <img className="seefirst__picture" src={sight.now} alt={holdWords.now} />
            <figcaption className="seefirst__caption">{holdWords.now}</figcaption>
          </figure>
        )}
        {sight.changed === null ? null : (
          <figure className="seefirst__half seefirst__half--after">
            <img className="seefirst__picture" src={sight.changed} alt={holdWords.ifIn} />
            <figcaption className="seefirst__caption">{holdWords.ifIn}</figcaption>
          </figure>
        )}
      </div>
      {sight.missing === null || (sight.now === null && sight.changed === null) ? null : (
        <p className="seefirst__honest">{sight.missing}</p>
      )}
      {sight.trouble === null ? null : <p className="seefirst__trouble">{sight.trouble}</p>}
    </>
  );
}
