import './ErrorCard.css';

type Props = {
  /** One sentence on what happened, in the user's terms. */
  what: string;
  /** One sentence on the likeliest reason. Honest about being a guess. */
  because: string;
  /** The single thing worth doing next. */
  actionLabel: string;
  onAction: () => void;
  /** Raw text for whoever wants it — the one place jargon is allowed to live. */
  technicalDetails?: string;
};

/** Something went wrong, said calmly.
 *
 * Slower than everything else in the app: 280ms, no shake, no red flash, no
 * jolt. Panic is contagious, and a steady interface during a failure is what
 * keeps a nervous user in the product (notes/strategy/UI-DESIGN.md). Colour carries the
 * severity; motion stays gentle.
 *
 * Three sentences at most before the one button, and the stack trace stays
 * folded away until someone asks for it. */
export default function ErrorCard({
  what,
  because,
  actionLabel,
  onAction,
  technicalDetails,
}: Props) {
  return (
    <section className="errorcard" role="alert">
      <div className="errorcard__head">
        <span className="errorcard__mark" aria-hidden="true">
          <svg viewBox="0 0 16 16" width="14" height="14" fill="none">
            <path d="M8 4.2v4.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            <circle cx="8" cy="11.4" r="0.95" fill="currentColor" />
          </svg>
        </span>
        <h2 className="errorcard__what">{what}</h2>
      </div>

      <p className="errorcard__because">{because}</p>

      <div className="errorcard__actions">
        <button type="button" className="errorcard__button" onClick={onAction}>
          {actionLabel}
        </button>
      </div>

      {technicalDetails ? (
        <details className="errorcard__tech">
          <summary className="errorcard__summary">Show technical details</summary>
          <pre className="errorcard__pre">{technicalDetails}</pre>
        </details>
      ) : null}
    </section>
  );
}
