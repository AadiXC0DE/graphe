import type { Money } from '../agent/types';
import { checkLimit, type SpendLimit } from '../cost/limits';
import { formatMoney } from '../cost/money';
import { limitNudge, meter } from '../cost/phrasing';
import './CostMeter.css';

type Props = {
  /** What has been spent in the period the meter is reporting on. */
  spent: Money;
  /** The ceiling the user set, if they set one. Drives the approaching state. */
  limit?: SpendLimit;
  /** Opens the session split — work versus attempts that didn't work. */
  onDetails?: () => void;
  /** Pin it to the bottom-right of the window as permanent furniture. */
  corner?: boolean;
  /** BCP 47 tag; left off, the host's own locale formats the amount. */
  locale?: string;
};

/** The small, still number in the corner.
 *
 * It never animates — not on mount, not when the figure changes. A number that
 * moves catches the eye every time it changes, and this one changes constantly;
 * motion here would turn quiet awareness into a source of anxiety
 * (notes/strategy/COST-DESIGN.md §1, and the frequency rule in notes/strategy/UI-DESIGN.md).
 *
 * Every word comes from src/cost/phrasing.ts, which is the file the language
 * audit sweeps. Money is the only unit shown, ever. */
export default function CostMeter({ spent, limit, onDetails, corner, locale }: Props) {
  const status = limit ? checkLimit(limit, spent) : null;
  const state = status?.state ?? 'ok';
  const near = state === 'nudge' || state === 'stop';

  const amount = formatMoney(spent, { locale });
  const ceiling = limit ? formatMoney(limit.ceiling, { locale }) : null;
  // Clamped for display: past the ceiling the rule is full, not overflowing.
  const filled = status ? Math.max(0, Math.min(1, status.fraction)) : 0;

  return (
    <aside
      className={`cost-meter cost-meter--${state} ${corner ? 'cost-meter--corner' : ''}`}
      aria-label={meter.screenReaderLabel(spent, { locale })}
    >
      <div className="cost-meter__row">
        <span className="cost-meter__label">Today</span>
        <span className="cost-meter__value" aria-hidden="true">
          {amount}
        </span>
      </div>

      {status ? (
        <div
          className="cost-meter__rule"
          role="img"
          aria-label={`${amount} of the ${ceiling} you set`}
        >
          <span className="cost-meter__fill" style={{ width: `${filled * 100}%` }} />
        </div>
      ) : null}

      {status && near ? (
        <p className="cost-meter__note" title={limitNudge(status, { locale })}>
          {state === 'stop'
            ? `That’s the ${ceiling} you set. I’ll ask before spending more.`
            : `Getting close to the ${ceiling} you set.`}
        </p>
      ) : null}

      {onDetails ? (
        <button type="button" className="cost-meter__details" onClick={onDetails}>
          {meter.detailsLink}
        </button>
      ) : null}
    </aside>
  );
}
