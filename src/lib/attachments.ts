/** What may be attached to a message, and what to say when something may not.
 *
 * Kept free of the DOM so the rules can be read — and tested — on their own.
 * The component decides what a chip looks like; this file decides what is
 * allowed on one, and every sentence it can produce is written for a designer
 * who has just dragged a file in and been told no. None of them blame the
 * person, none of them use the word "invalid", and all of them say what would
 * work instead.
 */

/** The size where a file stops being an attachment and starts being a problem
 *  for everything downstream. Generous on purpose: designers export big. */
export const MAX_BYTES = 25 * 1024 * 1024;

export type AttachmentKind = 'image' | 'document' | 'figma';

/** Pictures. Anything here gets a thumbnail on its chip. */
const IMAGES: readonly string[] = [
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'avif',
  'heic',
  'heif',
  'bmp',
  'tiff',
  'tif',
  'svg',
];

/** The exports that come out of a design tool at the end of a day's work. */
const DOCUMENTS: readonly string[] = ['pdf', 'fig', 'sketch', 'xd', 'ai', 'psd', 'eps'];

export function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot === -1 ? '' : name.slice(dot + 1).toLowerCase();
}

/** Bytes, said the way a person says them. */
export function readableSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1000) return `${Math.round(bytes)} bytes`;
  if (bytes < 1000 * 1000) return `${Math.round(bytes / 1000)} KB`;
  const mb = bytes / (1000 * 1000);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

export type FileFacts = { name: string; type?: string; size: number };

export type Verdict =
  | { ok: true; kind: 'image' | 'document' }
  | { ok: false; because: string };

/**
 * Whether this file can come along, and what to say if not.
 *
 * Two refusals, both of them explanations. The size one names the number and
 * the ceiling, because "too large" without a figure leaves somebody guessing at
 * what would fit. The kind one names what does work, because a list of what is
 * accepted is more use than a verdict on what was not.
 */
export function checkFile(file: FileFacts): Verdict {
  const extension = extensionOf(file.name);
  const type = file.type ?? '';
  const kind: 'image' | 'document' | null = IMAGES.includes(extension)
    ? 'image'
    : DOCUMENTS.includes(extension)
      ? 'document'
      : type.startsWith('image/')
        ? 'image'
        : type === 'application/pdf'
          ? 'document'
          : null;

  if (kind === null) {
    return {
      ok: false,
      because: `I can look at pictures, PDFs and design exports${
        extension === '' ? '' : `, and this one is a .${extension}`
      }. A screenshot of it would work.`,
    };
  }

  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      because: `That one is ${readableSize(file.size)}, and I can hold up to ${readableSize(
        MAX_BYTES,
      )}. A smaller export or a JPEG usually gets there.`,
    };
  }

  if (file.size === 0) {
    return {
      ok: false,
      because: 'That file came through empty, so there is nothing in it for me to look at yet.',
    };
  }

  return { ok: true, kind };
}

/* -------------------------------------------------------------------------- */
/* Figma links                                                                 */
/* -------------------------------------------------------------------------- */

const FIGMA =
  /^https?:\/\/(?:www\.)?figma\.com\/(file|design|proto|board|slides|deck|community\/file)\/([\w-]+)(?:\/([^/?#]+))?/i;

export type FigmaLink = { url: string; name: string; what: string };

/**
 * A Figma link, recognised as a place rather than as a string.
 *
 * This is the half of attachments that is ours rather than the browser's: a
 * pasted Figma URL is not a file and should not pretend to be one, so it gets
 * its own chip with the frame's own name on it. The name is sitting right there
 * in the path — `.../design/8Kx2/Landing-v4` — and reading it means the chip
 * says "Landing v4" at the moment of the paste, without asking Figma anything.
 */
export function figmaLink(text: string): FigmaLink | null {
  const trimmed = text.trim();
  const match = FIGMA.exec(trimmed);
  if (match === null) return null;

  const kind = (match[1] ?? '').toLowerCase();
  const slug = match[3] ?? '';
  let name = 'Figma file';
  if (slug !== '') {
    try {
      name = decodeURIComponent(slug).replace(/-+/g, ' ').trim() || name;
    } catch {
      name = slug.replace(/-+/g, ' ');
    }
  }

  const what =
    kind === 'proto'
      ? 'Figma prototype'
      : kind === 'board'
        ? 'FigJam board'
        : kind === 'slides'
          ? 'Figma slides'
          : 'Figma file';

  return { url: trimmed, name, what };
}

/* -------------------------------------------------------------------------- */
/* Being dropped on                                                            */
/* -------------------------------------------------------------------------- */

/** How many things can arrive in one gesture. Somebody dragging a whole export
 *  folder in means "look at my work", not "read three hundred files". */
export const MAX_AT_ONCE = 12;

/** Whether a drag is worth lighting the window up for.
 *
 *  Files and links only. Plain dragged text is left alone: moving a word from
 *  one box to another is not an attempt to attach anything, and a screen that
 *  dims for it is a screen that dims at nothing. */
export function carriesSomething(types: readonly string[] | null | undefined): boolean {
  if (!Array.isArray(types)) return false;
  return types.some((one) => one === 'Files' || one === 'text/uri-list');
}

/** One thing that may come in, already sorted into what it is. */
export type Taken<F extends FileFacts = FileFacts> = {
  file: F;
  kind: 'image' | 'document';
};

/** What was dropped, once the parts that cannot come in are set aside. */
export type Landed<F extends FileFacts = FileFacts> = {
  taken: readonly Taken<F>[];
  link: FigmaLink | null;
  /** The one sentence to show, or nothing to say. */
  because: string | null;
};

export type Dropped<F extends FileFacts = FileFacts> = {
  files?: readonly F[] | null;
  /** Whatever text came with the drag: a link, most of the time. */
  text?: string | null;
} | null | undefined;

function looksLikeAFile(one: unknown): boolean {
  if (one === null || typeof one !== 'object') return false;
  const facts = one as Partial<FileFacts>;
  return typeof facts.name === 'string' && typeof facts.size === 'number';
}

/**
 * Reading a dropped payload.
 *
 * The window accepts a drop anywhere, which means it also has to answer for
 * everything that can be dragged onto a screen — a folder, a browser tab, a
 * half-finished download, a drag that arrives carrying nothing at all. Every
 * one of those ends in a sentence rather than in silence, because a picture
 * that vanishes on landing reads as a bug in the app and not as a limit.
 */
export function readDropped<F extends FileFacts>(payload: Dropped<F>): Landed<F> {
  const given: readonly F[] = Array.isArray(payload?.files)
    ? payload.files.filter((one): one is F => looksLikeAFile(one))
    : [];
  const text = typeof payload?.text === 'string' ? payload.text : '';

  if (given.length > 0) {
    const taken: Taken<F>[] = [];
    let because: string | null = null;

    for (const file of given.slice(0, MAX_AT_ONCE)) {
      const verdict = checkFile(file);
      if (verdict.ok) taken.push({ file, kind: verdict.kind });
      else because ??= verdict.because;
    }

    if (given.length > MAX_AT_ONCE) {
      because ??= `I took the first ${MAX_AT_ONCE} — that is as many as I can look at in one go.`;
    }

    return { taken, link: null, because };
  }

  const link = figmaLink(text);
  if (link !== null) return { taken: [], link, because: null };

  return {
    taken: [],
    link: null,
    because:
      text.trim() === ''
        ? 'Nothing came through with that. A picture, a PDF or a Figma link will work.'
        : 'That link is not one I recognise yet. A picture, a PDF or a Figma link will work.',
  };
}

/* -------------------------------------------------------------------------- */
/* The drag counter                                                            */
/* -------------------------------------------------------------------------- */

/** Dragging over a window fires enter and leave for every child the pointer
 *  crosses. Counting depth instead of trusting the last event is the whole
 *  difference between one calm state and a screen that strobes. */
export const NOT_DRAGGING = 0;

export function deeper(depth: number): number {
  return Math.max(NOT_DRAGGING, Number.isFinite(depth) ? depth : NOT_DRAGGING) + 1;
}

export function shallower(depth: number): number {
  return Math.max(NOT_DRAGGING, (Number.isFinite(depth) ? depth : NOT_DRAGGING) - 1);
}

export function dragging(depth: number): boolean {
  return Number.isFinite(depth) && depth > NOT_DRAGGING;
}
