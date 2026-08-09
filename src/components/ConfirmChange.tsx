import './ConfirmChange.css';

type Props = {
  /** The plain-language question. "Replace the colour styles in your design system?" */
  question: string;
  /** What is actually about to happen, if the question alone leaves it vague. */
  detail?: string;
  /** What it would mean afterwards. Usually the reassuring half. */
  consequence?: string;
  /**
   * The real thing being asked about — the command, the path, the operation —
   * present only when "Show me" is on (BACKLOG D1).
   *
   * This is the one moment where the machinery's own words earn their place
   * most: it is cheaper to read a command before approving it than to work out
   * afterwards what was approved. It still sits below the plain question and
   * still reads as a footnote to it.
   */
  technical?: string;
  /** The label on the option that does the risky thing. */
  confirmLabel: string;
  /** The label on the option that changes nothing. */
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
};

/** The card that asks before something risky happens.
 *
 * Not a modal, and not over the preview. Once there is something to look at, the
 * user's work stays the subject of the screen — a dimmed backdrop is the visual
 * grammar of an error, and being asked a question is an ordinary moment
 * (notes/strategy/UI-DESIGN.md). It slides up 12px with a fade over 200ms and then sits
 * there, beside the work, until it is answered.
 *
 * The safe option carries the visual weight. The risky one is a quiet button
 * with a full hit area and a real focus ring — reachable in one keystroke,
 * never the thing your eye lands on first. */
export default function ConfirmChange({
  question,
  detail,
  consequence,
  technical,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <section className="confirm" role="group" aria-label={question}>
      <h2 className="confirm__question">{question}</h2>
      {detail ? <p className="confirm__detail">{detail}</p> : null}
      {consequence ? <p className="confirm__consequence">{consequence}</p> : null}
      {technical ? <code className="confirm__real">{technical}</code> : null}

      <div className="confirm__actions">
        {/* Safe first in the DOM, so it is also first for the keyboard. */}
        <button type="button" className="confirm__button confirm__button--keep" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="confirm__button confirm__button--go" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </section>
  );
}
