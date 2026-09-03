import { legible, saysFindings, type Finding } from '../design/legibility';
import './Legible.css';

type Props = {
  findings: readonly Finding[];
  /** Absent means the list is a report and nothing more. */
  onFix?: (finding: Finding) => void;
  /** Every one that can be fixed, at once. */
  onFixAll?: (findings: readonly Finding[]) => void;
  /** The one being changed right now, so its press can say so. */
  fixing?: string | null;
  /** Where each pairing is written, as `file:line`. */
  at?: ReadonlyMap<string, string>;
  /** The measurements under each row, when "Show me" is on. */
  showMe?: boolean;
};

export const SAYS = {
  fixAll: 'Fix all',
} as const;

/** The letters in the sample. Two of them, one of each case, because a capital
 *  and a lowercase carry different amounts of ink. */
const SAMPLE = 'Aa';

/**
 * What on this page cannot be read, and the colour that would fix it.
 *
 * A list of places: where the pairing is written, what is there, what belongs
 * there, and one press. The two samples are drawn as themselves because a
 * sentence about a colour is an argument and a pair of samples is the answer.
 */
export default function Legible({ findings, onFix, onFixAll, fixing, at, showMe }: Props) {
  const fixable = findings.filter((finding) => finding.fix !== null);

  return (
    <section className="legible" aria-label={legible.heading}>
      <header className="legible__head">
        <h2 className="legible__heading">{legible.heading}</h2>
        <p className="legible__all">{saysFindings(findings)}</p>
        {onFixAll === undefined || fixable.length === 0 ? null : (
          <button type="button" className="legible__every" onClick={() => onFixAll(fixable)}>
            {SAYS.fixAll}
          </button>
        )}
      </header>

      {findings.length === 0 ? null : (
        <ul className="legible__list">
          {findings.map((finding) => {
            const busy = fixing === finding.id;
            return (
              <li key={finding.id} className="legible__one">
                <code className="legible__at">{at?.get(finding.id) ?? finding.where}</code>

                <span className="legible__pair" aria-hidden="true">
                  <span
                    className="legible__well"
                    style={{ background: finding.back, color: finding.front }}
                  >
                    {SAMPLE}
                  </span>
                  <span className="legible__amount">{finding.front}</span>
                </span>

                {finding.fix === null ? null : (
                  <>
                    <span className="legible__arrow" aria-hidden="true">
                      →
                    </span>
                    <span className="legible__pair">
                      <span
                        className="legible__well"
                        style={{ background: finding.back, color: finding.fix.colour }}
                        aria-hidden="true"
                      >
                        {SAMPLE}
                      </span>
                      <span className="legible__amount legible__amount--mine">
                        {finding.fix.name ?? finding.fix.colour}
                      </span>
                    </span>
                  </>
                )}

                <span className="legible__says" id={`legible-${finding.id}`}>
                  {showMe ? finding.detail.line : finding.says}
                </span>

                {onFix === undefined || finding.fix === null ? null : (
                  <button
                    type="button"
                    className="legible__do"
                    onClick={() => onFix(finding)}
                    disabled={busy}
                    aria-describedby={`legible-${finding.id}`}
                  >
                    {busy ? legible.fixing : legible.fix}
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
