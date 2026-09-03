import { useEffect, useMemo, useState } from 'react';
import type { Money } from '../agent/types';
import type { SpendView } from '../lib/spend';
import type { DayTokens, TokenUsageView } from '../lib/token-days';
import { costInMonth, costOnDay, lastDays, saysTokens, spendCsv } from '../lib/token-days';
import type { SpendLimit } from '../cost/limits';
import { formatMoney, fromMajor, toMajor } from '../cost/money';
import { Ceiling } from './CostMeter';
import './Usage.css';

type Props = {
  open: boolean;
  spent: SpendView | null;
  onClose: () => void;
  /** Days by cost and model, read when the sheet opens. Left off, only the
   *  sitting's own number is offered. */
  onTokens?: () => Promise<TokenUsageView | null>;
  /** The ceiling somebody set on the month, if they set one. */
  limit?: SpendLimit | null;
  onLimit?: (ceiling: Money | null) => void;
  /** Open one of the conversations in the list. */
  onOpenConversation?: (path: string) => void;
  /** Hand the days to the shell to write out. */
  onExport?: (csv: string) => void;
};

/** How many days the bar chart shows. */
const DAYS = 30;

/** Each model's own colour: the accent hue turned a further 40° per model, so
 *  a stack reads as one palette rather than a paint box. */
function modelColour(at: number): string {
  return `oklch(from var(--accent) l c calc(h + ${String((at * 40) % 360)}deg))`;
}

function saysDay(at: number): string {
  return new Date(at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/**
 * What this cost: the sitting, the day, the month, and where the month went.
 *
 * Three numbers first, because "am I fine?" is the question people open this
 * with. Everything under them answers "where did it go?" — by day, by model,
 * by conversation — and the CSV at the top is for whoever has to expense it.
 */
export default function Usage({
  open,
  spent,
  onClose,
  onTokens,
  limit,
  onLimit,
  onOpenConversation,
  onExport,
}: Props) {
  const [tokens, setTokens] = useState<TokenUsageView | null>(null);

  useEffect(() => {
    if (!open) return;
    const key = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [open, onClose]);

  /* Read once per opening, and quietly: a slow disk delays a card, never the
     sheet. */
  useEffect(() => {
    if (!open || onTokens === undefined) return;
    let alive = true;
    void onTokens().then((answer) => {
      if (alive) setTokens(answer);
    });
    return () => {
      alive = false;
    };
  }, [open, onTokens]);

  const currency = spent?.total.currency ?? limit?.ceiling.currency ?? 'USD';
  const days = useMemo<readonly DayTokens[]>(
    () => (tokens === null ? [] : lastDays(tokens.days, Date.now(), DAYS)),
    [tokens],
  );
  /* One colour per model, fixed by the order of the whole table, so a model
     keeps its colour whichever day it appears in. */
  const colours = useMemo(() => {
    const found = new Map<string, string>();
    (tokens?.byModel ?? []).forEach((one, at) => found.set(one.model, modelColour(at)));
    return found;
  }, [tokens]);

  if (!open) return null;
  const money = (major: number): string => formatMoney(fromMajor(major, currency));
  const split = spent?.split ?? null;
  const now = Date.now();
  const today = tokens === null ? 0 : costOnDay(tokens.days, now);
  const month = tokens === null ? 0 : costInMonth(tokens.days, now);
  const tallest = days.reduce((most, day) => Math.max(most, day.cost), 0);
  const ceilingMajor = limit === null || limit === undefined ? 0 : toMajor(limit.ceiling);
  const conversations = tokens?.byConversation ?? [];

  return (
    <section className="usage scroll--auto" aria-label="What this cost" role="dialog" aria-modal="true">
      <header className="usage__top">
        <div>
          <h1>What this cost</h1>
          <p>Spend by day, model and conversation.</p>
        </div>
        <div className="usage__actions">
          {tokens === null || onExport === undefined ? null : (
            <button type="button" className="usage__export" onClick={() => onExport(spendCsv(tokens))}>
              Export
            </button>
          )}
          <button type="button" className="usage__close" onClick={onClose}>
            Close <kbd>Esc</kbd>
          </button>
        </div>
      </header>

      {spent === null && tokens === null ? (
        <p className="usage__empty">Nothing has been spent in this sitting yet.</p>
      ) : (
        <div className="usage__body">
          <section className="usage__numbers">
            <div className="usage__number">
              <strong>{spent === null ? money(0) : formatMoney(spent.total)}</strong>
              <span>This sitting</span>
            </div>
            <div className="usage__number">
              <strong>{money(today)}</strong>
              <span>Today</span>
            </div>
            <div className="usage__number">
              <strong>{money(month)}</strong>
              <span>This month</span>
              {limit === null || limit === undefined ? null : (
                <>
                  <p className="usage__of">of {formatMoney(limit.ceiling)} limit</p>
                  <div className="usage__rule" aria-hidden="true">
                    <span
                      style={{
                        width: `${String(Math.min(100, ceilingMajor === 0 ? 0 : (month / ceilingMajor) * 100))}%`,
                      }}
                    />
                  </div>
                </>
              )}
              {onLimit === undefined ? null : (
                <Ceiling
                  limit={limit ?? null}
                  spent={fromMajor(month, currency)}
                  onLimit={onLimit}
                />
              )}
            </div>
          </section>

          {tokens === null ? null : (
            <section className="usage__card">
              <h2>By day</h2>
              <div className="usage__bars" role="img" aria-label={`${money(tokens.cost)} over ${String(DAYS)} days`}>
                {days.map((day) => (
                  <div
                    key={day.at}
                    className="usage__bar"
                    title={`${saysDay(day.at)} · ${money(day.cost)} · ${saysTokens(day.tokens)} tokens`}
                  >
                    <span
                      className="usage__barstack"
                      style={{ height: `${String(tallest === 0 ? 0 : (day.cost / tallest) * 100)}%` }}
                    >
                      {day.models.map((one) => (
                        <i
                          key={one.model}
                          style={{
                            height: `${String(day.cost === 0 ? 0 : (one.cost / day.cost) * 100)}%`,
                            background: colours.get(one.model) ?? 'var(--accent)',
                          }}
                        />
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <footer className="usage__barfoot">
                <span>{saysDay(days[0]?.at ?? now)}</span>
                <span>{saysDay(days[days.length - 1]?.at ?? now)}</span>
              </footer>
            </section>
          )}

          {tokens === null || tokens.byModel.length === 0 ? null : (
            <section className="usage__card">
              <h2>By model</h2>
              <table className="usage__table">
                <thead>
                  <tr>
                    <th scope="col">Model</th>
                    <th scope="col">Turns</th>
                    <th scope="col">Tokens in</th>
                    <th scope="col">Tokens out</th>
                    <th scope="col">Cached</th>
                    <th scope="col">Cost</th>
                  </tr>
                </thead>
                <tbody>
                  {tokens.byModel.map((one) => (
                    <tr key={one.model}>
                      <th scope="row">
                        <i className="usage__swatch" style={{ background: colours.get(one.model) ?? 'var(--accent)' }} />
                        {one.model}
                      </th>
                      <td>{one.turns}</td>
                      <td>{saysTokens(one.input)}</td>
                      <td>{saysTokens(one.output)}</td>
                      <td>{Math.round(one.cached * 100)}%</td>
                      <td>{money(one.cost)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}

          {conversations.length === 0 ? null : (
            <section className="usage__card">
              <h2>By conversation</h2>
              <ul className="usage__conversations">
                {conversations.map((one) => (
                  <li key={one.id}>
                    <button
                      type="button"
                      className="usage__conversation"
                      disabled={onOpenConversation === undefined}
                      onClick={() => onOpenConversation?.(one.path)}
                    >
                      <span className="usage__conversationtitle">{one.title}</span>
                      <span className="usage__conversationturns">{one.turns} turns</span>
                      <span className="usage__conversationcost">{money(one.cost)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {split === null ? null : (
            <p className="usage__retries">
              Work you asked for {formatMoney(split.work)} · attempts that did not work{' '}
              {formatMoney(split.retry)}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
