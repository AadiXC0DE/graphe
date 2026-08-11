import { responsive, type Look } from '../design/widths';
import './Responsive.css';

type Props = {
  looks: readonly Look[];
  /** The trio in one sentence, already written. */
  says: string;
  busy: boolean;
  onCheck: () => void;
};

/** A picture that could not be taken says so, rather than leaving a broken
 *  frame where a screen should be. */
const MISSING = 'This one didn’t come out.';

/**
 * "Does this work on a phone?" — the button, the wait, and the three pictures.
 *
 * Nothing before the press but the question itself: three empty frames would
 * promise pictures nobody has asked for yet.
 */
export default function Responsive({ looks, says, busy, onCheck }: Props) {
  const shown = busy ? [] : looks;

  return (
    <section className="widths" aria-label={responsive.button}>
      {shown.length === 0 ? null : <h2 className="widths__heading">{responsive.heading}</h2>}

      {shown.length === 0 ? null : (
        <ul className="widths__shots">
          {shown.map((look) => (
            <li key={look.id} className="widths__one">
              <figure className="widths__figure">
                {look.shot === null ? (
                  <div className="widths__missing">
                    <p className="widths__missingsays">{MISSING}</p>
                  </div>
                ) : (
                  <img
                    className="widths__shot"
                    src={look.shot}
                    alt={`Your page on ${look.name.toLowerCase()}`}
                  />
                )}
                <figcaption className="widths__caption">
                  <span className="widths__name">{look.name}</span>
                  <span className="widths__width">{look.width}px</span>
                </figcaption>
              </figure>
              {look.trouble === null ? null : (
                <p className="widths__trouble">{look.trouble}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      {busy ? <p className="widths__working">{responsive.working}</p> : null}
      {!busy && shown.length > 0 ? <p className="widths__says">{says}</p> : null}

      <button type="button" className="widths__ask" onClick={onCheck} disabled={busy}>
        {looks.length === 0 ? responsive.button : responsive.again}
      </button>
    </section>
  );
}
