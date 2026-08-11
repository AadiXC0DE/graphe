import { legible, saysFindings, type Finding } from '../design/legibility';
import './Legible.css';

type Props = {
  findings: readonly Finding[];
  /** Absent means the list is a report and nothing more. */
  onFix?: (finding: Finding) => void;
  /** The one being changed right now, so its press can say so. */
  fixing?: string | null;
  /** The measurements under each line, when "Show me" is on. */
  showMe?: boolean;
};

/** The letters in the sample. Two of them, one of each case, because a capital
 *  and a lowercase carry different amounts of ink. */
const SAMPLE = 'Aa';

/**
 * What on this page cannot be read, and the colour that would fix it.
 *
 * Every row shows the pairing as it is and as it would be, at the size the type
 * actually is — a sentence about a colour is an argument, and two samples side
 * by side is the answer. The numbers behind the sentence hang underneath it and
 * only when they were asked for.
 */
export default function Legible({ findings, onFix, fixing, showMe }: Props) {
  return (
    <section className="legible" aria-label={legible.heading}>
      {findings.length === 0 ? null : <h2 className="legible__heading">{legible.heading}</h2>}

      {findings.length === 0 ? null : (
        <ul className="legible__list">
          {findings.map((finding) => {
            const busy = fixing === finding.id;
            return (
              <li key={finding.id} className="legible__one">
                <div className="legible__head">
                  <p className="legible__where">{finding.where}</p>
                  {onFix === undefined || finding.fix === null ? null : (
                    <button
                      type="button"
                      className="legible__do"
                      onClick={() => onFix(finding)}
                      disabled={busy}
                    >
                      {busy ? legible.fixing : legible.fix}
                    </button>
                  )}
                </div>

                <p className="legible__says">{finding.says}</p>

                {/* The colours themselves. Nothing here is the only carrier of
                    anything: the sentence above has already said it. */}
                <div className="legible__pair" aria-hidden="true">
                  <span className="legible__sample">
                    <span
                      className="legible__well"
                      style={{ background: finding.back, color: finding.front }}
                    >
                      {SAMPLE}
                    </span>
                    <span className="legible__label">{legible.now}</span>
                  </span>

                  {finding.fix === null ? null : (
                    <>
                      <span className="legible__arrow">→</span>
                      <span className="legible__sample">
                        <span
                          className="legible__well"
                          style={{ background: finding.back, color: finding.fix.colour }}
                        >
                          {SAMPLE}
                        </span>
                        <span className="legible__label">
                          {finding.fix.name ?? legible.instead}
                        </span>
                      </span>
                    </>
                  )}
                </div>

                {finding.fix?.fromScale ? <p className="legible__own">{legible.own}</p> : null}

                {showMe ? <code className="legible__real">{finding.detail.line}</code> : null}
              </li>
            );
          })}
        </ul>
      )}

      <p className="legible__all">{saysFindings(findings)}</p>
    </section>
  );
}
