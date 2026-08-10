import './ActivityLine.css';

export type ActivityState = 'running' | 'done' | 'failed';

type Props = {
  state: ActivityState;
  /** Plain language, in the user's terms: "Reading your Figma file". Never a
   *  tool name, never "Working…" on its own. */
  label: string;
  /** Optional second half of the same thought: "12 frames, 3 with variants". */
  detail?: string;
  /** How long it took, said the way a person would say it: "4s", "under a minute". */
  meta?: string;
  /**
   * The real thing behind this step — the command, the path, the operation —
   * shown only when "Show me" is on (BACKLOG D1, src/lib/showme.ts).
   *
   * Deliberately the last thing in the line and the quietest: it hangs under a
   * sentence that already said what happened, and it never replaces it. The
   * moment the machinery becomes the primary surface, this stops being an
   * escape hatch and starts being the product.
   */
  real?: string;
};

/** One thing the agent did, as a read-only feed item.
 *
 * Never an input: no button, no checkbox, no affordance suggesting the user is
 * being asked to approve anything. Confirmations are a different component with
 * a different shape, and blurring the two is how people learn to click without
 * reading.
 *
 * The running state pairs its spinner with a sentence, always — "Working…" is an
 * apology, "Reading your Figma file" is information (notes/strategy/UI-DESIGN.md). The
 * state is carried by icon shape as well as colour, so nothing here depends on
 * colour alone. */
export default function ActivityLine({ state, label, detail, meta, real }: Props) {
  return (
    <div className={`activity activity--${state}`}>
      <span className="activity__icon" aria-hidden="true">
        {state === 'running' ? <span className="activity__spinner" /> : null}
        {state === 'done' ? (
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
            <path
              d="M3 7.4 5.7 10 11 4.4"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ) : null}
        {state === 'failed' ? (
          <svg viewBox="0 0 14 14" width="14" height="14" fill="none">
            <path
              d="M3.9 3.9l6.2 6.2M10.1 3.9l-6.2 6.2"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
            />
          </svg>
        ) : null}
      </span>

      <span className="activity__text">
        <span className="activity__label">{label}</span>
        {detail ? <span className="activity__detail">{detail}</span> : null}
        {real ? <code className="activity__real">{real}</code> : null}
      </span>

      {meta ? <span className="activity__meta">{meta}</span> : null}

      <span className="activity__sr">
        {state === 'running' ? 'in progress' : state === 'done' ? 'done' : 'did not work'}
      </span>
    </div>
  );
}
