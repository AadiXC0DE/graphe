import { useState } from 'react';

import type { Money } from '../agent/types';
import { checkLimit, type SpendLimit } from '../cost/limits';
import { formatMoney, fromMajor, toMajor } from '../cost/money';
import { asSummary, forProject, type OverTime, type Split } from '../cost/overtime';
import { limitNudge, limitSetup, meter, sessionSummary } from '../cost/phrasing';
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
  /** Pin it to the bottom-right of the window as permanent furniture. */
  corner?: boolean;
  /** BCP 47 tag; left off, the host's own locale formats the amount. */
  locale?: string;
  /** Longer than one sitting: what each folder and each month came to. Given
   *  this, the meter offers those stretches beside today's figure. */
  history?: OverTime;
  /** The folder open right now, so "this project" means the right one. */
  project?: string;
  /** Drive the stretch from outside. Left off, the meter remembers its own. */
  span?: Span;
  onSpan?: (span: Span) => void;
};

const SPANS: readonly { span: Span; word: string }[] = [
  { span: 'today', word: 'Today' },
  { span: 'project', word: 'This project' },
  { span: 'months', word: 'Each month' },
];

/** The small, still number in the corner.
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
  onAPlan,
  corner,
  locale,
  history,
  project,
  span,
  onSpan,
}: Props) {
  const [held, hold] = useState<Span>('today');
  const chosen = span ?? held;

  const status = limit ? checkLimit(limit, spent) : null;
  const state = status?.state ?? 'ok';
  const near = state === 'nudge' || state === 'stop';

  const ceiling = limit ? formatMoney(limit.ceiling, { locale }) : null;
  // Clamped for display: past the ceiling the rule is full, not overflowing.
  const filled = status ? Math.max(0, Math.min(1, status.fraction)) : 0;

  const totals = history?.main ?? null;
  const here = totals ? (project ? forProject(totals, project) : (totals.byProject[0] ?? null)) : null;
  const months = totals?.byMonth ?? [];
  const thisMonth = months.find((one) => one.current) ?? months[0] ?? null;

  const offer = totals !== null;
  const showing = offer ? chosen : 'today';

  const head =
    showing === 'project'
      ? { label: here?.name ?? 'This project', figure: here?.total ?? null }
      : showing === 'months'
        ? { label: thisMonth?.name ?? 'This month', figure: thisMonth?.total ?? null }
        : { label: 'Today', figure: spent };

  const amount = head.figure ? formatMoney(head.figure, { locale }) : null;
  const todayAmount = formatMoney(spent, { locale });

  return (
    <aside
      className={`cost-meter cost-meter--${state} ${corner ? 'cost-meter--corner' : ''}`}
      aria-label={
        showing === 'today'
          ? meter.screenReaderLabel(spent, { locale })
          : `Spent, ${head.label.toLowerCase()}: ${amount ?? 'nothing yet'}`
      }
    >
      <div className="cost-meter__row">
        <span className="cost-meter__label">{head.label}</span>
        <span className="cost-meter__value" aria-hidden="true">
          {amount ?? '—'}
        </span>
      </div>

      {status ? (
        <div
          className="cost-meter__rule"
          role="img"
          aria-label={`${todayAmount} of the ${ceiling} you set`}
        >
          <span className="cost-meter__fill" style={{ width: `${filled * 100}%` }} />
        </div>
      ) : null}

      {onAPlan ? <p className="cost-meter__note">{meter.onAPlan}</p> : null}

      {status && near ? (
        <p className="cost-meter__note" title={limitNudge(status, { locale })}>
          {state === 'stop'
            ? `That’s the ${ceiling} you set. I’ll ask before spending more.`
            : `Getting close to the ${ceiling} you set.`}
        </p>
      ) : null}

      {offer ? (
        <>
          <div className="cost-meter__spans" role="group" aria-label="What the figure covers">
            {SPANS.map(({ span: one, word }) => (
              <button
                key={one}
                type="button"
                className="cost-meter__span"
                aria-pressed={showing === one}
                onClick={() => {
                  hold(one);
                  onSpan?.(one);
                }}
              >
                {word}
              </button>
            ))}
          </div>

          {showing === 'project' ? <Where split={here} locale={locale} /> : null}
          {showing === 'months' ? (
            <ul className="cost-meter__list">
              {months.map((month) => (
                <li key={month.key} className="cost-meter__item">
                  <span className="cost-meter__item-name">{month.name}</span>
                  <span className="cost-meter__item-value">
                    {formatMoney(month.total, { locale })}
                  </span>
                </li>
              ))}
              {months.length === 0 ? <li className="cost-meter__aside">Nothing yet.</li> : null}
            </ul>
          ) : null}
          {showing !== 'today' ? <Elsewhere history={history} locale={locale} /> : null}
        </>
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

/** The split, in the same words the end of a sitting uses. */
function Where({ split, locale }: { split: Split | null; locale?: string }) {
  if (split === null || split.entryCount === 0) {
    return <p className="cost-meter__aside">Nothing spent here yet.</p>;
  }
  const said = sessionSummary(asSummary(split), { locale });
  return (
    <p className="cost-meter__aside">
      {said.work}
      <br />
      {said.retry}
    </p>
  );
}

/** Money in another currency is never folded into the figure above, so it says
 *  so out loud rather than going missing. */
function Elsewhere({ history, locale }: { history?: OverTime; locale?: string }) {
  const others = (history?.currencies ?? []).slice(1);
  if (others.length === 0) return null;
  const amounts = others.map((one) => formatMoney(one.overall.total, { locale }));
  const said =
    amounts.length === 1
      ? amounts[0]
      : `${amounts.slice(0, -1).join(', ')} and ${amounts[amounts.length - 1]}`;
  return <p className="cost-meter__aside">Also {said}, kept apart — it isn’t the same money.</p>;
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
            if (event.key === 'Escape') setOpen(false);
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
      </div>
    </div>
  );
}
