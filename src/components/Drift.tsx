import { useState } from 'react';
import type { Finding } from '../design/drift';
import { saysAll } from '../design/drift';
import './Drift.css';

type Props = {
  findings: readonly Finding[];
  /** The file they came from, so each row can say where it is. */
  where?: string;
  /** Absent means the list is a report and nothing more. */
  onUse?: (finding: Finding) => void;
  /** Every one of them at once. */
  onUseAll?: (findings: readonly Finding[]) => void;
  /** "Show me" is on: the exact values sit under each sentence. */
  detail?: boolean;
};

/** Every word this component can put on screen, in one place. */
export const SAYS = {
  heading: 'Not from your styles',
  hint: 'Written into the file by hand, a hair off one of your own values.',
  use: 'Use yours',
  useAll: 'Fix all',
  wrote: 'Written here',
  yours: 'Yours',
  more: (count: number): string => `Show ${String(count)} more`,
  at: (file: string, line: number): string =>
    file === '' ? `line ${String(line)}` : `${file}:${String(line)}`,
} as const;

/** How many are drawn before the rest are offered. */
const AT_ONCE = 20;

/** A colour is judged by eye; a length is a number beside a number. */
function Swatch({ value, kind, title }: { value: string; kind: Finding['kind']; title: string }) {
  if (kind === 'colour') {
    return <span className="drift__well" style={{ background: value }} title={title} />;
  }
  return null;
}

/**
 * Values that were nearly the project's own.
 *
 * A list of places rather than a list of sentences: where it is, what is
 * written there, what belongs there, and one press to put it right. The
 * evidence is the two values touching, because a near-miss is far more
 * convincing seen than described.
 */
export default function Drift({ findings, where, onUse, onUseAll, detail = false }: Props) {
  const [room, setRoom] = useState(AT_ONCE);
  if (findings.length === 0) return null;

  const drawn = findings.slice(0, room);
  const rest = findings.length - drawn.length;
  const file = where ?? '';

  return (
    <section className="drift" aria-label={SAYS.heading}>
      <header className="drift__head">
        <h2 className="drift__heading">{SAYS.heading}</h2>
        <p className="drift__count">{saysAll(findings)}</p>
        {onUseAll === undefined ? null : (
          <button type="button" className="drift__all" onClick={() => onUseAll(findings)}>
            {SAYS.useAll}
          </button>
        )}
      </header>

      <ul className="drift__list">
        {drawn.map((finding) => (
          <li key={finding.id} className={`drift__row drift__row--${finding.confidence}`}>
            <code className="drift__at">{SAYS.at(file, finding.line)}</code>

            <span className="drift__wrote">
              <Swatch value={finding.wrote} kind={finding.kind} title={SAYS.wrote} />
              <span className="drift__amount">{finding.wrote}</span>
            </span>

            <span className="drift__arrow" aria-hidden="true">
              →
            </span>

            <span className="drift__mine">
              <Swatch value={finding.mine.value} kind={finding.kind} title={SAYS.yours} />
              <span className="drift__amount drift__amount--mine">{finding.use}</span>
            </span>

            <span className="drift__says" id={`drift-${finding.id}`}>
              {detail ? finding.detail : finding.says}
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

      {rest > 0 ? (
        <button type="button" className="drift__more" onClick={() => setRoom(room + AT_ONCE)}>
          {SAYS.more(Math.min(rest, AT_ONCE))}
        </button>
      ) : null}
    </section>
  );
}
