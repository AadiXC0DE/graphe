import type { Finding } from '../design/drift';
import { saysAll } from '../design/drift';
import './Drift.css';

type Props = {
  findings: readonly Finding[];
  /** The file they came from, named as a designer would name it. Optional. */
  where?: string;
  /** Absent means the list is a report and nothing more. */
  onUse?: (finding: Finding) => void;
  /** "Show me" is on: the exact values sit under each sentence. */
  detail?: boolean;
};

/** Every word this component can put on screen, in one place. */
export const SAYS = {
  heading: 'Not quite yours',
  use: 'Use yours',
  wrote: 'Written here',
  yours: 'Yours',
  at: (line: number) => `line ${String(line)}`,
} as const;

/** The written value and the project's own, touching, so the eye does the
 *  comparing. Two swatches with a gap between them is two colours; two swatches
 *  that meet is one seam you either see or do not. */
function Pair({ finding }: { finding: Finding }) {
  /* Decorative to a screen reader: the sentence beside it is the finding. */
  if (finding.kind === 'colour') {
    return (
      <span className="drift__pair" aria-hidden="true">
        <span className="drift__well" style={{ background: finding.wrote }} title={SAYS.wrote} />
        <span
          className="drift__well"
          style={{ background: finding.mine.value }}
          title={SAYS.yours}
        />
      </span>
    );
  }
  return (
    <span className="drift__pair drift__pair--sizes" aria-hidden="true">
      <span className="drift__amount" title={SAYS.wrote}>
        {finding.wrote}
      </span>
      <span className="drift__amount drift__amount--mine" title={SAYS.yours}>
        {finding.mine.value}
      </span>
    </span>
  );
}

/**
 * Values that were nearly the project's own.
 *
 * The sentence is the claim and the two swatches are the evidence, so they sit
 * on the same line and the swatches come first — a near-miss is far more
 * convincing seen than described. One press puts the project's value back.
 */
export default function Drift({ findings, where, onUse, detail = false }: Props) {
  if (findings.length === 0) return null;

  return (
    <section className="drift" aria-label={SAYS.heading}>
      <header className="drift__head">
        <h2 className="drift__heading">{SAYS.heading}</h2>
        <p className="drift__count">{where ?? saysAll(findings)}</p>
      </header>

      <ul className="drift__list">
        {findings.map((finding) => (
          <li key={finding.id} className={`drift__row drift__row--${finding.confidence}`}>
            <Pair finding={finding} />

            <span className="drift__text">
              <span className="drift__says" id={`drift-${finding.id}`}>
                {finding.says}
              </span>
              {detail ? (
                <span className="drift__detail">
                  {finding.detail} · {SAYS.at(finding.line)}
                </span>
              ) : null}
            </span>

            {onUse === undefined ? null : (
              <button
                type="button"
                className="drift__use"
                onClick={() => onUse(finding)}
                aria-describedby={`drift-${finding.id}`}
              >
                {SAYS.use}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
