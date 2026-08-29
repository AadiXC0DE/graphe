import { flagOf, responsive, type Look } from '../design/widths';
import './Responsive.css';

type Props = {
  looks: readonly Look[];
  /** The row in one sentence, already written. */
  says: string;
  busy: boolean;
  onCheck: () => void;
  /** The size being read, when one has been picked out of the row. */
  workingAt?: string | null;
  /** Absent means the pictures are a row of pictures and nothing more. */
  onWorkAt?: (look: Look) => void;
};

/**
 * Every size, side by side.
 *
 * The band says what the press will do before there is anything to show: empty
 * frames would promise pictures nobody has asked for yet, but a lone button
 * under a heading is a button nobody presses. After it, the sizes sit in one
 * row so the narrow one is read against the wide one, and anything wrong is
 * marked on the picture it is wrong in — a fault listed under a row of four is
 * a fault nobody can match to a screen.
 */
export default function Responsive({
  looks,
  says,
  busy,
  onCheck,
  workingAt = null,
  onWorkAt,
}: Props) {
  const shown = busy ? [] : looks;
  const said = says.trim();

  return (
    <section className="widths" aria-label={responsive.button}>
      <p className="widths__what">{responsive.what}</p>

      {shown.length === 0 ? null : (
        <ul className="widths__shots scroll--auto">
          {shown.map((look) => {
            const flag = flagOf(look);
            const here = workingAt !== null && workingAt === look.id;
            const inside = (
              <>
                <span className="widths__frame">
                  {look.shot === null ? (
                    <span className="widths__missing" />
                  ) : (
                    <img
                      className="widths__shot"
                      src={look.shot}
                      alt={`Your page on ${look.name.toLowerCase()}`}
                    />
                  )}
                  {flag.badge === null ? null : (
                    <span className={`widths__flag widths__flag--${flag.tone}`}>
                      {flag.badge}
                    </span>
                  )}
                </span>
                <span className="widths__caption">
                  <span className="widths__name">{look.name}</span>
                  <span className="widths__width">{look.width}px</span>
                </span>
                {flag.says === null ? null : (
                  <span className="widths__trouble">{flag.says}</span>
                )}
              </>
            );

            return (
              <li key={look.id} className="widths__one">
                {onWorkAt === undefined ? (
                  <div className="widths__card">{inside}</div>
                ) : (
                  <button
                    type="button"
                    className={`widths__card widths__card--live${here ? ' widths__card--here' : ''}`}
                    onClick={() => onWorkAt(look)}
                    aria-pressed={here}
                    title={here ? responsive.picked : responsive.pick}
                  >
                    {inside}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {busy ? <p className="widths__working">{responsive.working}</p> : null}
      {/* Said whether or not there are pictures: a look that came back with a
          reason and no pictures used to leave the band blank. */}
      {!busy && said !== '' ? <p className="widths__says">{said}</p> : null}

      <div className="widths__foot">
        <button type="button" className="widths__ask" onClick={onCheck} disabled={busy}>
          {looks.length === 0 ? responsive.button : responsive.again}
        </button>
        <p className="widths__where">{responsive.where}</p>
      </div>
    </section>
  );
}
