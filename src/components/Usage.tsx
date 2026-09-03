import { useEffect, useState } from 'react';
import type { SpendView } from '../lib/spend';
import type { TokenUsageView } from '../lib/token-days';
import { intensityOf, saysTokens, weeksOf } from '../lib/token-days';
import { formatMoney } from '../cost/money';
import './Usage.css';

type Props = {
  open: boolean;
  spent: SpendView | null;
  onClose: () => void;
  /** Tokens by day, read when the sheet opens. Left off, the grid is not
   *  offered — a caller that cannot read transcripts says nothing. */
  onTokens?: () => Promise<TokenUsageView | null>;
};

/** How many weeks the grid shows. Ten fits the sheet's measure and reaches
 *  back far enough for a rhythm to be visible. */
const WEEKS = 10;

/** The model's own cache accounting, made legible. This is a details surface:
 * model names belong here, not beside ordinary design work.
 *
 * Two answers to one question sit side by side. Money says what it cost;
 * tokens say how much work went through the model, day by day — because a
 * cheap model burns a pile of tokens for a small bill, and neither number
 * alone tells somebody how much they are actually using. */
export default function Usage({ open, spent, onClose, onTokens }: Props) {
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

  if (!open) return null;
  const usage = spent?.usage ?? null;
  const split = spent?.split ?? null;
  const reused = usage?.reusedShare;
  const weeks = tokens === null ? [] : weeksOf(tokens.days, Date.now(), WEEKS);

  return (
    <section className="usage scroll--auto" aria-label="What this cost" role="dialog" aria-modal="true">
      <header className="usage__top">
        <div>
          <p className="usage__eyebrow">This sitting</p>
          <h1>What this cost</h1>
          <p>Spend by day, model and conversation.</p>
        </div>
        <button type="button" className="usage__close" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </header>

      {spent === null ? (
        <p className="usage__empty">Nothing has been spent in this sitting yet.</p>
      ) : (
        <div className="usage__body">
          <section className="usage__total">
            <span>Total so far</span>
            <strong>{formatMoney(spent.total)}</strong>
          </section>

          {tokens === null ? null : (
            <section className="usage__card">
              <h2>Tokens, week by week</h2>
              <p className="usage__gridnote">
                How much work went through the model, one square to a day. Alongside the money:
                a small bill can still be a lot of work.
              </p>
              <div className="usage__grid" role="img" aria-label={`About ${saysTokens(tokens.total)} tokens in the last ${WEEKS} weeks`}>
                {weeks.map((week, at) => (
                  <span className="usage__week" key={at}>
                    {week.map((day) => (
                      <span
                        key={day.at}
                        // -1 marks days this week hasn't reached yet.
                        className={`usage__cell ${day.tokens < 0 ? 'usage__cell--ahead' : ''} ${
                          day.tokens > 0 ? `usage__cell--${intensityOf(day.tokens, tokens.days)}` : ''
                        }`}
                        title={
                          day.tokens < 0
                            ? undefined
                            : `${new Date(day.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}: ${
                                day.tokens === 0 ? 'nothing' : `${saysTokens(day.tokens)} tokens`
                              }`
                        }
                      />
                    ))}
                  </span>
                ))}
              </div>
              <footer className="usage__gridfoot">
                <strong>{saysTokens(tokens.total)}</strong>
                <span>tokens in ten weeks</span>
                <span className="usage__scale" aria-hidden="true">
                  less
                  <i className="usage__cell" />
                  <i className="usage__cell usage__cell--1" />
                  <i className="usage__cell usage__cell--2" />
                  <i className="usage__cell usage__cell--3" />
                  more
                </span>
              </footer>
            </section>
          )}

          <section className="usage__card">
            <h2>What came back from earlier</h2>
            {reused === null || reused === undefined ? (
              <p>This account has not reported reusable prompt work yet.</p>
            ) : (
              <>
                <div className="usage__reuse">
                  <strong>{Math.round(reused * 100)}%</strong>
                  <span>reused</span>
                </div>
                <div className="usage__rule" aria-hidden="true">
                  <span style={{ width: `${Math.round(reused * 100)}%` }} />
                </div>
                <p>Work already understood from earlier messages did not need to be read again.</p>
              </>
            )}
          </section>

          <section className="usage__card">
            <h2>Models used</h2>
            {usage === null || usage.byModel.length === 0 ? (
              <p>It will appear after the first model response.</p>
            ) : (
              <ul className="usage__models">
                {usage.byModel.map((model) => (
                  <li key={model.name}>
                    <span>{model.name}</span>
                    <span>{Math.round(model.share * 100)}%</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="usage__card">
            <h2>Work and retries</h2>
            {split === null ? (
              <p>This settles when the current work finishes.</p>
            ) : (
              <div className="usage__split">
                <p><span>Work you asked for</span><strong>{formatMoney(split.work)}</strong></p>
                <p><span>Attempts that did not work</span><strong>{formatMoney(split.retry)}</strong></p>
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
