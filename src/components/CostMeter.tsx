import { useState } from 'react';

import type { Money, SittingUsage, SpendSummary } from '../agent/types';
import { checkLimit, type SpendLimit } from '../cost/limits';
import { formatMoney, fromMajor, toMajor } from '../cost/money';
import { forProject, type OverTime } from '../cost/overtime';
import { limitSetup, meter } from '../cost/phrasing';
import './CostMeter.css';

/** Which stretch the figure covers. */
export type Span = 'today' | 'project' | 'months';

type Props = {
  /** What has been spent in the period the meter is reporting on. */
  spent: Money;
  /** The ceiling the user set, if they set one. Drives the approaching state. */
  limit?: SpendLimit;
  /** Opens the session split — work versus attempts that didn't work. */
  onDetails?: () => void;
  /** Set the ceiling, raise it, or take it away with null. Left off, the meter
   *  only reports and the ceiling is somebody else's business. */
  onLimit?: (ceiling: Money | null) => void;
  /** The account being used is paid for by its own plan rather than by use, so
   *  the figure is a count and not a bill, and the meter has to say so. */
  onAPlan?: boolean;
  /** Pin it as permanent furniture. `window` floats bottom-right; `panel`
   *  sticks to the foot of the right rail so scrolling cannot drag it. */
  corner?: boolean | 'window' | 'panel';
  /** BCP 47 tag; left off, the host's own locale formats the amount. */
  locale?: string;
  /** Longer than one sitting: what each folder and each month came to. Given
   *  this, the meter draws a quiet month strip under the figure. */
  history?: OverTime;
  /** The folder open right now, so "this project" means the right one. */
  project?: string;
  /** The work-versus-retry split for this sitting, once it has settled. */
  split?: SpendSummary | null;
  /** Cache reuse and which model, once anything has been priced. */
  usage?: SittingUsage | null;
  /** Drive the stretch from outside. Left off, the meter remembers its own. */
  span?: Span;
  onSpan?: (span: Span) => void;
};

/** The small, still number in the corner or rail.
 *
 * It never animates — not on mount, not when the figure changes. A number that
 * moves catches the eye every time it changes, and this one changes constantly;
 * motion here would turn quiet awareness into a source of anxiety
 * (notes/strategy/COST-DESIGN.md §1, and the frequency rule in notes/strategy/UI-DESIGN.md).
 *
 * Every word comes from src/cost/phrasing.ts, which is the file the language
 * audit sweeps. Money is the only unit shown, ever. */
export default function CostMeter({
  spent,
  limit,
  onDetails,
  onLimit,
  corner,
  locale,
  history,
  project,
  split = null,
  usage = null,
}: Props) {
  const status = limit ? checkLimit(limit, spent) : null;
  const state = status?.state ?? 'ok';
  const ceiling = limit ? formatMoney(limit.ceiling, { locale }) : null;
  // Clamped for display: past the ceiling the rule is full, not overflowing.
  const filled = status ? Math.max(0, Math.min(1, status.fraction)) : 0;

  const amount = formatMoney(spent, { locale });
  const dock =
    corner === true || corner === 'window'
      ? 'cost-meter--corner'
      : corner === 'panel'
        ? 'cost-meter--panel'
        : '';

  const months = history?.main?.byMonth.slice(0, 6).reverse() ?? [];
  const monthPeak = Math.max(1, ...months.map((one) => one.total.minor));
  const projectTotal =
    history?.main !== undefined && history.main !== null && project !== undefined
      ? forProject(history.main, project)
      : null;
  const retryShare = split?.retryShare ?? projectTotal?.retryShare ?? null;

  return (
    <aside
      className={`cost-meter cost-meter--${state} ${dock}`}
      aria-label={meter.screenReaderLabel(spent, { locale })}
    >
      <div className="cost-meter__row">
        <span className="cost-meter__label">Total</span>
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

      {/* Quiet month strip — a git-like activity graph of spend, not a chart
          that needs a legend. Absent until there is more than one sitting. */}
      {months.length > 1 ? (
        <div
          className="cost-meter__months"
          role="img"
          aria-label={months.map((one) => `${one.name}: ${formatMoney(one.total, { locale })}`).join('. ')}
        >
          {months.map((one) => (
            <span
              key={one.key}
              className={`cost-meter__bar ${one.current ? 'cost-meter__bar--now' : ''}`}
              style={{ height: `${Math.max(12, Math.round((one.total.minor / monthPeak) * 100))}%` }}
              title={`${one.name}: ${formatMoney(one.total, { locale })}`}
            />
          ))}
        </div>
      ) : null}

      {usage?.reusedShare !== null && usage?.reusedShare !== undefined ? (
        <p className="cost-meter__retry">{meter.reused(usage.reusedShare)}</p>
      ) : null}

      {usage?.mostUsed !== null && usage?.mostUsed !== undefined ? (
        <p className="cost-meter__retry">{meter.mostUsed(usage.mostUsed)}</p>
      ) : null}

      {retryShare !== null && retryShare > 0 ? (
        <p className="cost-meter__retry">
          {Math.round(retryShare * 100)}% on retries
        </p>
      ) : null}

      <div className="cost-meter__row cost-meter__row--doing">
        {onDetails ? (
          <button type="button" className="cost-meter__details" onClick={onDetails}>
            {meter.detailsLink}
          </button>
        ) : null}

        {onLimit ? (
          <Ceiling limit={limit ?? null} spent={spent} onLimit={onLimit} />
        ) : null}
      </div>
    </aside>
  );
}


/**
 * Setting a ceiling, on the meter itself.
 *
 * It belongs here rather than in a settings screen because this is where
 * somebody is already looking at the number when they decide they want a limit
 * on it. Closed it is four words; open it is one field and two buttons.
 */
function Ceiling({
  limit,
  spent,
  onLimit,
}: {
  limit: SpendLimit | null;
  spent: Money;
  onLimit: (ceiling: Money | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');

  const currency = limit?.ceiling.currency ?? spent.currency;

  const save = () => {
    const wanted = Number(typed.replace(/[^0-9.]/g, ''));
    if (!Number.isFinite(wanted) || wanted <= 0) return;
    onLimit(fromMajor(wanted, currency));
    setOpen(false);
  };

  if (!open) {
    return (
      <button
        type="button"
        className="cost-meter__details"
        onClick={() => {
          setTyped(limit === null ? '' : String(toMajor(limit.ceiling)));
          setOpen(true);
        }}
      >
        {limit === null ? limitSetup.open : limitSetup.change}
      </button>
    );
  }

  return (
    <div className="cost-meter__ceiling">
      <label className="cost-meter__ceilinglabel">
        {limitSetup.field}
        <input
          className="cost-meter__ceilingfield"
          type="text"
          inputMode="decimal"
          autoFocus
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save();
            if (event.key === 'Escape') {
              // Closes this and only this — the press must not reach the run.
              event.preventDefault();
              setOpen(false);
            }
          }}
        />
      </label>
      <p className="cost-meter__ceilingnote">{limitSetup.scope}</p>
      <div className="cost-meter__ceilingrow">
        <button type="button" className="cost-meter__ceilingsave" onClick={save}>
          {limitSetup.save}
        </button>
        {limit === null ? null : (
          <button
            type="button"
            className="cost-meter__details"
            onClick={() => {
              onLimit(null);
              setOpen(false);
            }}
          >
            {limitSetup.clear}
          </button>
        )}
        {/* Always a way out. Escape works too, but a panel that only closes on
            a key nobody is told about is a panel that traps the hand. */}
        <button type="button" className="cost-meter__details" onClick={() => setOpen(false)}>
          Not now
        </button>
      </div>
    </div>
  );
}
