import { useCallback, useEffect, useRef, useState } from 'react';
import type { AttachmentKind } from '../lib/attachments';
import { usePrefersReducedMotion } from '../lib/motion';
import './Attachments.css';

/** How long a chip takes to leave. Kept in step with --dur-exit in tokens.css,
 *  which is the "exits run about 20% faster than entrances" rule from
 *  notes/strategy/UI-DESIGN.md written down as a number. */
const LEAVING_MS = 160;

/**
 * One thing brought into the conversation.
 *
 * A Figma link is deliberately not a file. It has no bytes, it cannot have a
 * thumbnail, and calling it "figma.com-Landing-v4.url" would be a lie about what
 * it is — so it keeps its own kind, its own mark and its own chip, and the name
 * on it is the frame's name rather than a filename.
 */
export type Attachment = {
  id: string;
  kind: AttachmentKind;
  /** What it is called, in the fewest words that identify it. */
  name: string;
  /** The second line: "PNG · 820 KB", or "Figma file". */
  note: string;
  /** An object URL, for images only. Revoked when the chip is removed. */
  preview?: string;
  /** Where a link points. Nothing follows it yet. */
  url?: string;
  /** The bytes themselves, held for whoever ends up sending them. */
  file?: File;
};

function Mark({ kind }: { kind: AttachmentKind }) {
  if (kind === 'figma') {
    return (
      <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
        <rect x="3" y="2.5" width="10" height="11" rx="2" stroke="currentColor" strokeWidth="1.5" />
        <path d="M3 6.2h10M6.6 6.2v7.3" stroke="currentColor" strokeWidth="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5l3 3v8h-8z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  );
}

/** The thumbnail, or the mark if the picture will not draw.
 *
 * A file that says it is a PNG and cannot be shown is not worth a broken-image
 * icon and a question. The chip quietly becomes the same chip a PDF gets: the
 * name is still right, and the name is what somebody reads. */
function Thumbnail({ kind, preview }: { kind: AttachmentKind; preview: string | undefined }) {
  const [broken, setBroken] = useState(false);
  if (preview === undefined || broken) return <Mark kind={kind} />;
  return (
    <img className="chip__thumb" src={preview} alt="" onError={() => setBroken(true)} />
  );
}

/**
 * The row of chips above the input.
 *
 * Small, removable, and above rather than below: they are part of what is about
 * to be said, so they sit with the message and not with the controls.
 */
export default function Attachments({
  items,
  onRemove,
}: {
  items: readonly Attachment[];
  onRemove: (id: string) => void;
}) {
  /**
   * Chips on their way out.
   *
   * A chip arrives with a small rise, and until now it left by ceasing to
   * exist between two frames — which reads as a glitch rather than as a thing
   * you removed, and leaves you unsure whether you clicked the right one. So
   * the press marks it, it shrinks and fades over --dur-exit, and only then is
   * it actually taken off the list. Rare and deliberate, which is the test for
   * whether motion is allowed at all.
   */
  const [leaving, setLeaving] = useState<readonly string[]>([]);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(
    () => () => {
      for (const timer of timers.current) clearTimeout(timer);
    },
    [],
  );

  const remove = useCallback(
    (id: string) => {
      if (reducedMotion) {
        onRemove(id);
        return;
      }
      setLeaving((was) => (was.includes(id) ? was : [...was, id]));
      timers.current.push(
        setTimeout(() => {
          setLeaving((was) => was.filter((one) => one !== id));
          onRemove(id);
        }, LEAVING_MS),
      );
    },
    [onRemove, reducedMotion],
  );

  if (items.length === 0) return null;

  return (
    <ul className="chips" aria-label="Attached">
      {items.map((item) => {
        const going = leaving.includes(item.id);
        return (
          <li className={`chip chip--${item.kind} ${going ? 'chip--leaving' : ''}`} key={item.id}>
            <span className="chip__mark" aria-hidden="true">
              <Thumbnail kind={item.kind} preview={item.preview} />
            </span>

            <span className="chip__text">
              <span className="chip__name">{item.name}</span>
              <span className="chip__note">{item.note}</span>
            </span>

            <button
              type="button"
              className="chip__remove"
              onClick={() => remove(item.id)}
              disabled={going}
              aria-label={`Remove ${item.name}`}
            >
              <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
                <path
                  d="M4.2 4.2l5.6 5.6M9.8 4.2l-5.6 5.6"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
