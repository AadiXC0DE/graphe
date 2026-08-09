import type { ReactNode } from 'react';
import './Message.css';

export type MessageAuthor = 'you' | 'graphe';

type Props = {
  from: MessageAuthor;
  /** The turn's text. Rendered as-is; newlines are preserved. */
  children: ReactNode;
  /** True while the reply is still arriving. Adds no motion — see below. */
  streaming?: boolean;
  /** A quiet aside under a Graphe turn, e.g. "This one's small, so I kept it Quick." */
  aside?: string;
};

/** One turn in the conversation.
 *
 * The single most frequent thing in the app, so by the frequency rule in
 * notes/strategy/UI-DESIGN.md it does not animate at all — no fade in, no typewriter, no
 * per-token reveal. Text simply appears. Anything else adds perceived latency to
 * the interaction the user has a hundred times a day.
 *
 * `streaming` therefore changes nothing visual except a static caret that marks
 * where the text is still growing, and the live region politeness that lets a
 * screen reader follow along. The caret does not blink: a blinking or pulsing
 * element is decoration standing in for substance, and it would draw the eye
 * away from the words themselves. */
export default function Message({ from, children, streaming, aside }: Props) {
  const mine = from === 'you';

  return (
    <article className={`message message--${from}`} aria-label={mine ? 'You' : 'Graphe'}>
      <div className="message__who">{mine ? 'You' : 'Graphe'}</div>
      <div
        className="message__body"
        aria-live={!mine && streaming ? 'polite' : undefined}
        aria-busy={streaming || undefined}
      >
        {children}
        {streaming ? <span className="message__caret" aria-hidden="true" /> : null}
      </div>
      {aside ? <p className="message__aside">{aside}</p> : null}
    </article>
  );
}
