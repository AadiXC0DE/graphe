import { useEffect } from 'react';
import type { SpendView } from '../lib/spend';
import { formatMoney } from '../cost/money';
import './Usage.css';

type Props = {
  open: boolean;
  spent: SpendView | null;
  onClose: () => void;
};

/** The model's own cache accounting, made legible. This is a details surface:
 * model names belong here, not beside ordinary design work. */
export default function Usage({ open, spent, onClose }: Props) {
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

  if (!open) return null;
  const usage = spent?.usage ?? null;
  const split = spent?.split ?? null;
  const reused = usage?.reusedShare;

  return (
    <section className="usage" aria-label="What this cost" role="dialog" aria-modal="true">
      <header className="usage__top">
        <div>
          <p className="usage__eyebrow">This sitting</p>
          <h1>What this cost</h1>
          <p>What was spent, what got another try, and what was reused from earlier.</p>
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
