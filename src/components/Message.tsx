import type { ReactNode } from 'react';
import Clipped, { howMuch } from './Clipped';
import Markdown from './Markdown';
import './Message.css';

export type MessageAuthor = 'you' | 'graphe';

type Props = {
  from: MessageAuthor;
  /** The turn's text. Graphe's is read as Markdown; yours is left exactly as
   *  you typed it. Anything that is not a plain string is rendered as given. */
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
 * away from the words themselves.
 *
 * **Only Graphe's turns are read as Markdown.** A designer who writes
 * `*roughly* 40px` means the asterisks — they are describing a value, not
 * emphasising a word — and a composer that quietly eats punctuation is a
 * composer people stop trusting with anything technical. What you typed is what
 * is shown.
 */
export default function Message({ from, children, streaming, aside }: Props) {
  const mine = from === 'you';
  const caret = streaming ? <span className="message__caret" aria-hidden="true" /> : null;
  const formatted = !mine && typeof children === 'string';

  /* A wall of text takes the thread over. Cut it while it is still readable,
     and offer the rest — whether it is something somebody pasted or a long
     reply. Streaming stays open so the cut does not fight the caret. */
  const text = typeof children === 'string' ? children : null;
  const body = formatted ? (
    <Markdown text={children as string} caret={caret} />
  ) : (
    <>
      {children}
      {caret}
    </>
  );

  return (
    <article className={`message message--${from}`} aria-label={mine ? 'You' : 'Graphe'}>
      <div className="message__who">{mine ? 'You' : 'Graphe'}</div>
      <div
        className={`message__body ${formatted ? 'message__body--rich' : ''}`}
        aria-live={!mine && streaming ? 'polite' : undefined}
        aria-busy={streaming || undefined}
      >
        {streaming || text === null ? (
          body
        ) : (
          <Clipped how={howMuch(text)} label="Show the rest">
            {body}
          </Clipped>
        )}
      </div>
      {aside ? <p className="message__aside">{aside}</p> : null}
    </article>
  );
}
