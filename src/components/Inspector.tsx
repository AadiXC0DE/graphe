import { readColour } from '../design/drift';
import { saysValues } from '../preview/inspect';
import type { Adrift, AtWidth, Reading, Using } from '../preview/inspect';
import './Inspector.css';

type Props = {
  reading: Reading;
  /** Pictures at the other sizes, by size id. Absent means none taken yet. */
  shots?: ReadonlyMap<string, string | null>;
  /** Absent means the sizes are named rather than shown. */
  onWidth?: (width: AtWidth) => void;
  /** Put this element, and everything known about it, in the next message. */
  onAsk?: () => void;
  /** Absent means the place it was written is reported and not opened. */
  onOpen?: (where: { file: string; line: number }) => void;
  /** "Show me" is on: the exact values sit under each sentence. */
  detail?: boolean;
  onClose?: () => void;
};

/** Every word this component can put on screen, in one place. */
export const SAYS = {
  card: 'What this is',
  came: 'Where this came from',
  using: 'From your styles',
  adrift: 'Not from your styles',
  changed: 'The last change',
  widths: 'At other sizes',
  unsure: 'What I could not tell',
  reach: 'Used',
  also: 'Also used in',
  screens: 'Appears on',
  find: 'Look for',
  ask: 'Ask about this',
  open: 'Open where it was written',
  close: 'Close',
  taking: 'Taking a look…',
  look: (name: string): string => `See it on ${name}`,
  here: 'You are looking at this one',
  sure: {
    exact: 'Certain',
    likely: 'Near certain',
    guess: 'A guess',
  },
} as const;

/** A colour gets a well; anything else gets its amount. Both of them read at a
 *  glance, which a property name never does. */
function Well({ value }: { value: string }) {
  const colour = readColour(value);
  if (colour === null) {
    return (
      <span className="inspector__amount" aria-hidden="true">
        {value}
      </span>
    );
  }
  return <span className="inspector__well" style={{ background: value }} aria-hidden="true" />;
}

function UsingRow({ one, detail }: { one: Using; detail: boolean }) {
  return (
    <li className="inspector__row">
      <Well value={one.value} />
      <span className="inspector__text">
        <span className="inspector__says">{one.says}</span>
        {detail ? (
          <span className="inspector__detail">
            {one.name}: {one.value}
          </span>
        ) : null}
      </span>
      <span className="inspector__token">{one.name}</span>
    </li>
  );
}

/** The written value and the project's own, meeting along one seam: a
 *  difference you can see needs no sentence, and one you cannot is the sentence. */
function AdriftRow({ one, detail }: { one: Adrift; detail: boolean }) {
  return (
    <li className={`inspector__row inspector__row--${one.confidence}`}>
      <span className="inspector__pair" aria-hidden="true">
        <Well value={one.wrote} />
        <Well value={one.mine.value} />
      </span>
      <span className="inspector__text">
        <span className="inspector__says">{one.says}</span>
        {detail ? <span className="inspector__detail">{one.detail}</span> : null}
      </span>
      <span className="inspector__token">{one.mine.name}</span>
    </li>
  );
}

/**
 * A clicked element, read back.
 *
 * Ordered by what somebody asked when they clicked: what is this, what is it
 * made of, when did it move, what does it look like elsewhere. The last section
 * is the one most tools leave out — everything the reading could not work out,
 * said plainly, because a card that quietly omits half its answer is worse than
 * one that admits to it.
 */
export default function Inspector({
  reading,
  shots,
  onWidth,
  onAsk,
  onOpen,
  detail = false,
  onClose,
}: Props) {
  const { made, using, adrift, changed, widths, unsure } = reading;
  const where = made.where;

  return (
    <section className="inspector" aria-label={SAYS.card}>
      <header className="inspector__head">
        <div className="inspector__title">
          <h2 className="inspector__name">{reading.title}</h2>
          <p className={`inspector__sure inspector__sure--${made.sure}`}>{SAYS.sure[made.sure]}</p>
        </div>
        {onClose === undefined ? null : (
          <button type="button" className="inspector__close" onClick={onClose} aria-label={SAYS.close}>
            ×
          </button>
        )}
      </header>

      <section className="inspector__part">
        <h3 className="inspector__heading">{SAYS.came}</h3>
        <p className="inspector__line">{made.says}</p>

        {where === undefined ? (
          <p className="inspector__aside">
            {SAYS.find} <code className="inspector__code">{made.find}</code>
          </p>
        ) : null}

        {where !== undefined && onOpen !== undefined ? (
          <button
            type="button"
            className="inspector__button"
            onClick={() => onOpen({ file: where.file, line: where.line })}
          >
            {SAYS.open}
          </button>
        ) : null}

        {made.reach === undefined ? null : (
          <p className="inspector__reach">
            {SAYS.reach} {made.reach}
          </p>
        )}

        {made.alsoIn === undefined ? null : (
          <p className="inspector__aside">
            {SAYS.also}{' '}
            {made.alsoIn.map((file) => (
              <code key={file} className="inspector__code">
                {file}
              </code>
            ))}
          </p>
        )}

        {made.screens === undefined ? null : (
          <p className="inspector__aside">
            {SAYS.screens}{' '}
            {made.screens.map((screen) => (
              <span key={screen} className="inspector__chip">
                {screen}
              </span>
            ))}
          </p>
        )}
      </section>

      {using.length === 0 && adrift.length === 0 ? null : (
        <section className="inspector__part">
          <div className="inspector__band">
            <h3 className="inspector__heading">{using.length > 0 ? SAYS.using : SAYS.adrift}</h3>
            <p className="inspector__count">{saysValues(reading)}</p>
          </div>

          {using.length === 0 ? null : (
            <ul className="inspector__list">
              {using.map((one) => (
                <UsingRow key={`${one.what}-${one.name}`} one={one} detail={detail} />
              ))}
            </ul>
          )}

          {adrift.length === 0 ? null : (
            <>
              {using.length > 0 ? <h3 className="inspector__heading">{SAYS.adrift}</h3> : null}
              <ul className="inspector__list">
                {adrift.map((one) => (
                  <AdriftRow key={`${one.what}-${one.wrote}`} one={one} detail={detail} />
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {changed === null ? null : (
        <section className="inspector__part">
          <h3 className="inspector__heading">{SAYS.changed}</h3>
          <p className="inspector__line">{changed.says}</p>
        </section>
      )}

      <section className="inspector__part">
        <h3 className="inspector__heading">{SAYS.widths}</h3>
        <p className="inspector__aside">{widths.says}</p>
        <ul className="inspector__widths">
          {widths.all.map((width) => {
            const shot = shots?.get(width.id);
            return (
              <li key={width.id} className="inspector__width">
                <button
                  type="button"
                  className={`inspector__shot${width.here ? ' inspector__shot--here' : ''}`}
                  onClick={onWidth === undefined ? undefined : () => onWidth(width)}
                  disabled={onWidth === undefined}
                  title={width.here ? SAYS.here : SAYS.look(width.name)}
                >
                  {shot === undefined || shot === null ? (
                    <span className="inspector__waiting">{width.width}</span>
                  ) : (
                    <img className="inspector__picture" src={shot} alt={SAYS.look(width.name)} />
                  )}
                </button>
                <span className="inspector__widthname">{width.name}</span>
              </li>
            );
          })}
        </ul>
      </section>

      {unsure.length === 0 ? null : (
        <section className="inspector__part inspector__part--unsure">
          <h3 className="inspector__heading">{SAYS.unsure}</h3>
          <ul className="inspector__doubts">
            {unsure.map((one) => (
              <li key={one} className="inspector__doubt">
                {one}
              </li>
            ))}
          </ul>
        </section>
      )}

      {onAsk === undefined ? null : (
        <button type="button" className="inspector__ask" onClick={onAsk}>
          {SAYS.ask}
        </button>
      )}
    </section>
  );
}
