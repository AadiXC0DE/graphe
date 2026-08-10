import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
} from 'react';
import Attachments, { type Attachment } from './Attachments';
import { checkFile, extensionOf, figmaLink, readableSize } from '../lib/attachments';
import './Composer.css';

type Props = {
  onSend: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  busy?: boolean;
  /** What is currently attached. Held by whoever owns the conversation, because
   *  an attachment outlives the keystroke that produced it. */
  attachments?: readonly Attachment[];
  onAttachmentsChange?: (next: readonly Attachment[]) => void;
  /**
   * A sentence put into the box from outside it — one of the examples on the
   * first screen.
   *
   * It seeds the field and focuses it, and then it is an ordinary draft: it can
   * be edited, cleared, or ignored. It is never sent on somebody's behalf. An
   * example is a starting point, and a click that spends money on a sentence
   * the user did not write is the exact surprise this product exists not to
   * have.
   */
  draft?: string;
};

/** What the file picker offers, in the same order a designer would think of
 *  them. The drop and paste paths accept the same things and say so themselves
 *  — see src/lib/attachments.ts. */
const ACCEPT = 'image/*,application/pdf,.fig,.sketch,.xd,.ai,.psd,.eps';

let counter = 0;
function newId(): string {
  counter += 1;
  return `attachment-${counter}`;
}

/**
 * The one thing on the first screen.
 *
 * It takes a Figma link, a screenshot or a photo of a sketch, which is what its
 * own hint has always claimed and what, until now, it could not do. Four ways
 * in, because people reach for different ones and none of them is obscure:
 * drag a file onto it, paste a screenshot straight out of the clipboard, paste
 * a Figma URL, or press the paperclip and pick something.
 *
 * A pasted Figma link becomes a link chip rather than a file, because it is a
 * place and not a copy — and because turning your URL into text you then have
 * to look at is the sort of small dishonesty this composer has already been
 * guilty of once.
 */
export default function Composer({
  onSend,
  placeholder,
  autoFocus,
  busy,
  attachments = [],
  onAttachmentsChange,
  draft,
}: Props) {
  const [value, setValue] = useState('');
  const [dropping, setDropping] = useState(false);
  /** Why the last thing was turned away. One sentence, and never the user's
   *  fault. Cleared as soon as anything else happens. */
  const [refused, setRefused] = useState<string | null>(null);

  const areaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* Drag events fire for every child element the pointer crosses, so a depth
     count is the difference between a calm drop state and one that flickers on
     and off as the cursor moves over the placeholder text. */
  const depth = useRef(0);

  const attachedRef = useRef(attachments);
  attachedRef.current = attachments;

  const change = useCallback(
    (next: readonly Attachment[]) => {
      onAttachmentsChange?.(next);
    },
    [onAttachmentsChange],
  );

  /* Dropping a file on a window that is not expecting one makes the browser
     open it — in a desktop app, that replaces the interface with a photograph
     and there is no back button. Nothing outside the composer accepts a drop,
     so everything outside the composer refuses one. */
  useEffect(() => {
    const swallow = (event: globalThis.DragEvent) => {
      if (event.dataTransfer?.types.includes('Files')) event.preventDefault();
    };
    window.addEventListener('dragover', swallow);
    window.addEventListener('drop', swallow);
    return () => {
      window.removeEventListener('dragover', swallow);
      window.removeEventListener('drop', swallow);
    };
  }, []);

  /* Seeded from outside, with the cursor left at the end of it so the next
     keystroke continues the sentence rather than landing in the middle of it. */
  useEffect(() => {
    if (draft === undefined || draft === '') return;
    setValue(draft);
    const field = areaRef.current;
    if (field === null) return;
    field.focus();
    field.setSelectionRange(draft.length, draft.length);
    field.style.height = 'auto';
    field.style.height = `${Math.min(field.scrollHeight, 220)}px`;
  }, [draft]);

  const take = useCallback(
    (files: readonly File[]) => {
      if (files.length === 0) return;
      const added: Attachment[] = [];
      let turnedAway: string | null = null;

      for (const file of files) {
        const verdict = checkFile({ name: file.name, type: file.type, size: file.size });
        if (!verdict.ok) {
          turnedAway ??= verdict.because;
          continue;
        }
        const extension = extensionOf(file.name);
        added.push({
          id: newId(),
          kind: verdict.kind,
          name: file.name,
          note: [extension.toUpperCase(), readableSize(file.size)].filter(Boolean).join(' · '),
          preview: verdict.kind === 'image' ? URL.createObjectURL(file) : undefined,
          file,
        });
      }

      setRefused(turnedAway);
      if (added.length > 0) change([...attachedRef.current, ...added]);
    },
    [change],
  );

  const takeLink = useCallback(
    (text: string): boolean => {
      const link = figmaLink(text);
      if (link === null) return false;
      if (attachedRef.current.some((item) => item.url === link.url)) return true;
      setRefused(null);
      change([
        ...attachedRef.current,
        { id: newId(), kind: 'figma', name: link.name, note: link.what, url: link.url },
      ]);
      return true;
    },
    [change],
  );

  const remove = useCallback(
    (id: string) => {
      const going = attachedRef.current.find((item) => item.id === id);
      if (going?.preview !== undefined) URL.revokeObjectURL(going.preview);
      setRefused(null);
      change(attachedRef.current.filter((item) => item.id !== id));
    },
    [change],
  );

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue('');
    setRefused(null);
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  /* A screenshot on the clipboard arrives as a file with no name worth reading;
     a Figma URL arrives as text. Both are things somebody meant to attach, and
     neither should land in the middle of a sentence as characters. */
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData.files);
    if (files.length > 0) {
      e.preventDefault();
      take(files);
      return;
    }
    if (takeLink(e.clipboardData.getData('text/plain'))) e.preventDefault();
  };

  const carriesFiles = (e: DragEvent) => e.dataTransfer.types.includes('Files');

  const onDragEnter = (e: DragEvent) => {
    if (!carriesFiles(e) && !e.dataTransfer.types.includes('text/uri-list')) return;
    e.preventDefault();
    depth.current += 1;
    setDropping(true);
  };

  const onDragOver = (e: DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const onDragLeave = () => {
    depth.current = Math.max(0, depth.current - 1);
    if (depth.current === 0) setDropping(false);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    depth.current = 0;
    setDropping(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      take(files);
    } else {
      const dragged = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      if (!takeLink(dragged) && dragged.trim() !== '') {
        setRefused('That link is not one I recognise yet. A Figma link or a file will work.');
      }
    }
    areaRef.current?.focus();
  };

  // Grow with content rather than scrolling a fixed box.
  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  return (
    <div
      className={`composer ${dropping ? 'composer--dropping' : ''}`}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <Attachments items={attachments} onRemove={remove} />

      <textarea
        ref={areaRef}
        className="composer__input"
        value={value}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Describe what you want, or drop in a Figma link or a screenshot'}
        onChange={(e) => {
          setValue(e.target.value);
          resize(e.target);
        }}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        aria-label="What do you want to make?"
      />

      <div className="composer__row">
        <button
          type="button"
          className="composer__attach"
          onClick={() => fileRef.current?.click()}
          aria-label="Add a picture or a file"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M9.6 4.2 5.2 8.6a1.9 1.9 0 0 0 2.7 2.7l4.7-4.7a3.2 3.2 0 0 0-4.5-4.5L3.3 6.9a4.5 4.5 0 0 0 6.4 6.4l3.6-3.6"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        {/* One line, one job. It used to repeat the placeholder back at you in
            smaller grey type — two strings saying the same thing, in the one
            place the composer has to teach something. Now it says the thing the
            placeholder cannot: how to send, and how not to. Once there is
            anything in the box it goes quiet (see Composer.css), because a hint
            you have already acted on is furniture. */}
        <span className="composer__hint">
          {attachments.length > 0
            ? 'Held here for now — I can’t open these yet.'
            : 'Enter to send · Shift + Enter for a new line'}
        </span>

        <button
          className="composer__send"
          onClick={submit}
          disabled={!value.trim() || busy}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 12.75V3.5M8 3.5 4 7.5M8 3.5l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {/* Always in the document, empty most of the time. A live region that is
          added at the same moment as its first sentence is a live region a
          screen reader has no reason to be listening to yet. */}
      <p className="composer__refused" role="status">
        {refused}
      </p>

      <input
        ref={fileRef}
        className="composer__file"
        type="file"
        multiple
        accept={ACCEPT}
        tabIndex={-1}
        onChange={(e) => {
          take(Array.from(e.target.files ?? []));
          // So the same file can be picked twice in a row.
          e.target.value = '';
          areaRef.current?.focus();
        }}
      />

      {/* Calm: the box it is already in becomes the target, rather than a
          dashed rectangle appearing to say what a rectangle already said.
          Nothing moves, nothing bounces. */}
      <div className="composer__drop" aria-hidden="true">
        <span className="composer__droptext">Drop it here</span>
      </div>
    </div>
  );
}
