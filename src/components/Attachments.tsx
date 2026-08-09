import { useState } from 'react';
import type { AttachmentKind } from '../lib/attachments';
import './Attachments.css';

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
        <rect x="3" y="2.5" width="10" height="11" rx="2" stroke="currentColor" strokeWidth="1.4" />
        <path d="M3 6.2h10M6.6 6.2v7.3" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" aria-hidden="true">
      <path
        d="M4 2.5h5l3 3v8h-8z"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinejoin="round"
      />
      <path d="M9 2.5v3h3" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
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
  if (items.length === 0) return null;

  return (
    <ul className="chips" aria-label="Attached">
      {items.map((item) => (
        <li className={`chip chip--${item.kind}`} key={item.id}>
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
            onClick={() => onRemove(item.id)}
            aria-label={`Remove ${item.name}`}
          >
            <svg viewBox="0 0 14 14" width="11" height="11" fill="none" aria-hidden="true">
              <path d="M4 4l6 6M10 4l-6 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </li>
      ))}
    </ul>
  );
}
