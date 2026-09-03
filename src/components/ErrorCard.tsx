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

/** Something went wrong, said in the thread rather than dropped on it.
 *
 * A failure is usually one small interruption in a much larger conversation.
 * This is deliberately a compact recovery note, not a modal-sized dark card:
 * it keeps the useful next action within reach without making a routine
 * failure look like the application has fallen apart. */
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

      <div className="errorcard__body">
        <p className="errorcard__because">{because}</p>
        <button type="button" className="errorcard__button" onClick={onAction}>
          {actionLabel}
        </button>

        {technicalDetails ? (
          <details className="errorcard__tech">
            <summary className="errorcard__summary">Technical details</summary>
            <pre className="errorcard__pre scroll--auto">{technicalDetails}</pre>
          </details>
        ) : null}
      </div>
    </section>
  );
}
