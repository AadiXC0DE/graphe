import { useId, useState } from 'react';

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
 * The picture never gates the answer. A project that will not build has no
 * picture, says so where the picture would have been, and still gets decided.
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
  onDecide: (letIn: boolean) => void;
};

export default function SeeFirst({
  waiting,
  held,
  looking = false,
  busy = false,
  onDecide,
}: SeeFirstProps) {
  const [picked, setPicked] = useState<string | null>(null);
  const name = useId();

  if (waiting === null) return null;
  if (waiting.state !== 'making' && waiting.state !== 'waiting') return null;

  const sights = held?.sights ?? [];
  const chosen =
    (picked === null ? null : (sights.find((one) => one.id === picked) ?? null)) ??
    (held === null ? null : whichToShow(held));
  const reading = held === null ? null : readsHeld(held);
  const blank = held !== null && nothingCameOut(held);
  const settled = waiting.state === 'waiting';
  /* The pictures came out and one of them is wrong. Everything below this line
     is the same two answers the other way round — the safe one carries the
     weight and the other says what it is. Nobody is stopped: a photograph is
     evidence, not a veto, and the reading itself is already on screen. */
  const doubt = reading !== null && !reading.ok && !blank && chosen !== null;

  return (
    <section className="seefirst" aria-label="Work waiting for you">
      <p className="seefirst__doing">{waiting.doing}</p>
      <p className="seefirst__says">{settled ? holdWords.waiting : holdWords.making}</p>

      <div className="seefirst__look" id={name}>
        <h3 className="seefirst__title">{holdWords.seeIt}</h3>

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

        {/* What is true about the whole set rather than about the width in front
            of somebody — and not said twice when the frame already says it. */}
        {reading !== null && !reading.ok && chosen !== null && !blank ? (
          <p className="seefirst__honest">{reading.says}</p>
        ) : null}
        {blank || (chosen === null && !looking) ? (
          <p className="seefirst__honest">{holdWords.decideAnyway}</p>
        ) : null}
      </div>

      {settled ? (
        <>
          {doubt ? <p className="seefirst__caution">{holdWords.lookAgain}</p> : null}
          {/* The one that carries the weight comes first, in the order somebody
              reads as well as in the way it looks. */}
          <div className="seefirst__row">
            {(doubt ? [false, true] : [true, false]).map((letIn, at) => (
              <button
                key={String(letIn)}
                type="button"
                className={at === 0 ? 'seefirst__do seefirst__do--first' : 'seefirst__quietdo'}
                onClick={() => onDecide(letIn)}
                disabled={busy}
              >
                {letIn ? (doubt ? holdWords.approveAnyway : holdWords.approve) : holdWords.setAside}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </section>
  );
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
