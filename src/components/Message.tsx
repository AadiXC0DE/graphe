import { memo, useState, type ReactNode } from 'react';
import type { SentPicture } from '../lib/thread';
import { useCopying } from '../lib/copying';
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
  /** True when this is the last turn in the thread — it starts unclipped, and
   *  the reader can fold it once they are done with it. */
  isLast?: boolean;
  /** Pictures that went with this message, drawn above the words. */
  pictures?: readonly SentPicture[];
  /** The turn's own words, for the copy control. Nothing is drawn without it. */
  copy?: string;
};

/** A clipboard until it lands, then a tick — one 12px box either way, so the
 *  confirmation never resizes the control. */
function CopyMark({ done }: { done: boolean }) {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      {done ? (
        <path
          d="M1.6 6.3 4.5 9.2l5.9-6.4"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ) : (
        <>
          <rect x="3.9" y="3.9" width="6.7" height="6.7" rx="1.6" stroke="currentColor" strokeWidth="1.2" />
          <path
            d="M8.3 1.4H3c-.88 0-1.6.72-1.6 1.6v5.3"
            stroke="currentColor"
            strokeWidth="1.2"
            strokeLinecap="round"
          />
        </>
      )}
    </svg>
  );
}

/** One picture as it was sent: small, and full size when asked for.
 *
 * A picture that will not draw leaves nothing behind — a broken-image icon says
 * less than the message beside it already does. */
function Sent({ picture }: { picture: SentPicture }) {
  const [broken, setBroken] = useState(false);
  const [open, setOpen] = useState(false);
  /* A document has no thumbnail to grow — it is a row with its name, and the
     press opens it rather than enlarging it. Without this a PDF attached to a
     message left nothing behind at all, so a file somebody sent looked lost. */
  if (picture.kind === 'document') {
    return (
      <a className="message__paper" href={picture.src} target="_blank" rel="noreferrer" title={picture.name}>
        <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
          <path d="M4 2h5l3 3v9H4z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M9 2v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
        <span className="message__papername">{picture.name}</span>
      </a>
    );
  }
  if (broken) return null;
  return (
    <button
      type="button"
      className={`message__shot ${open ? 'message__shot--open' : ''}`}
      onClick={() => setOpen((was) => !was)}
      aria-expanded={open}
      aria-label={open ? `Shrink ${picture.name}` : `Show ${picture.name} full size`}
      title={picture.name}
    >
      <img src={picture.src} alt={picture.name} onError={() => setBroken(true)} />
    </button>
  );
}

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
function Message({ from, children, streaming, aside, isLast, pictures, copy }: Props) {
  const mine = from === 'you';
  // Named for what it copies: one message, not the conversation.
  const copying = useCopying({ idle: 'Copy this message' });
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
      {pictures === undefined || pictures.length === 0 ? null : (
        <div className="message__pictures">
          {pictures.map((picture, at) => (
            <Sent key={`${picture.src}-${String(at)}`} picture={picture} />
          ))}
        </div>
      )}
      <div
        className={`message__body ${formatted ? 'message__body--rich' : ''}`}
        aria-live={!mine && streaming ? 'polite' : undefined}
        aria-busy={streaming || undefined}
      >
        {streaming || text === null ? (
          body
        ) : (
          /* The newest answer starts open — but as a starting position, not a
             rule. Clipped holds its own state from there, so when the next
             turn arrives and this one stops being last, nothing snaps: it
             stays however the reader left it, still foldable. */
          <Clipped how={howMuch(text)} label="Show the rest" defaultOpen={isLast}>
            {body}
          </Clipped>
        )}
      </div>
      {aside ? <p className="message__aside">{aside}</p> : null}
      {/* The room is kept from the first token so the turn does not hop when
          the reply finishes; the control itself waits until there is a whole
          answer to take. It stays out while it is copying, so the confirmation
          survives the cursor leaving. */}
      {copy === undefined || copy === '' ? null : (
        <div className="message__foot">
          {streaming ? null : (
            <button
              type="button"
              className={`message__copy ${copying.copied || copying.failed ? 'message__copy--held' : ''}`}
              onClick={() => copying.copy(copy)}
              aria-label={copying.label}
              title={copying.label}
            >
              <CopyMark done={copying.copied} />
              {/* Beside the icon and out of flow, so saying it landed cannot
                  widen the control or push what is under it. */}
              {copying.copied || copying.failed ? (
                <span className="message__copysaid" aria-hidden="true">
                  {copying.label}
                </span>
              ) : null}
            </button>
          )}
        </div>
      )}
    </article>
  );
}

/* The most frequent thing in the app, and a reply arriving is a state change
   per commit — so without this every token relaid out every turn in the
   conversation, Markdown and all. Every prop here is a value or a reference the
   turn already owns, so React's own comparison is the right one: a hand-written
   list of fields would go quietly stale the first time this takes another. */
export default memo(Message);
