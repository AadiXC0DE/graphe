/** Accepted attachments, kept under the profile by what is in them.
 *
 * The window holds a File for as long as the chip is on screen, and a File is
 * a temporary thing: an object URL over bytes the page owns, gone on reload,
 * gone when the tab changes, useless to anything that wants to send the same
 * picture again tomorrow. So the bytes are written down here, once, under a
 * name that is the hash of the content itself. The same file dropped twice,
 * retried after a failed send, or sent from two conversations is one copy on
 * disk and one id in every row that holds it.
 *
 * Metadata and the small copy live beside the bytes, not inside them: an
 * attachment list is drawn from `<id>.json` and `<id>.thumb.jpg` without ever
 * reading the megabyte the person actually attached. That is the whole point of
 * the split — a row of twelve pictures should not cost twelve decodes.
 *
 * Nothing here empties itself. Bytes are content-addressed, so two rows can
 * share one copy and no single conversation can decide it is done with it;
 * deciding what to throw away is a storage decision somebody should be shown,
 * which is the same rule the trash keeps.
 */

import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import { writeAtomically } from '../../src/lib/atomic';
import { MAX_BYTES, readableSize } from '../../src/lib/attachments';
import type {
  AttachmentCopy,
  KeptAttachment,
  KeptAttachments,
  RefusedAttachment,
} from '../../src/lib/ipc';

/** What one kept attachment may weigh: the ceiling the box already refuses
 *  above, because a copy the app keeps is worth exactly as much as one it can
 *  send. Two numbers, one rule — `tests/attachment-store.test.ts` fails if they
 *  drift apart. */
export const MAX_KEPT_BYTES = MAX_BYTES;

/** How many attachments one conversation may hold. Twelve, because that is what
 *  one drag brings in (`MAX_AT_ONCE`), and past it a message stops being a
 *  message with pictures on it and becomes a list somebody has to scroll. */
export const MAX_PER_CONVERSATION = 12;

/** What arrives from the window, already decoded out of base64 and no longer a
 *  File. `thumb` is the small copy when the shell could make one — this file
 *  does not know how to read a PNG, it only knows where to put one. */
export type Incoming = {
  name: string;
  kind: 'image' | 'document';
  mimeType: string;
  bytes: Uint8Array;
  thumb?: Uint8Array | null;
  thumbType?: string;
};

/** Where kept attachments live, beside the sessions they belong to. */
export function attachmentsFolder(userData: string): string {
  return join(userData, 'attachments');
}

/** The name the content has, which is the identity of the attachment.
 *
 * A hash of the bytes and not of the name: renaming a file does not make it a
 * different picture, and the same picture attached under two names is one thing
 * to store. */
export function contentId(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** Only a content id names a file here. Anything else — a path, a name with a
 *  separator in it, a truncated hash — resolves to nothing rather than to some
 *  other file's bytes. */
function lookedUp(id: unknown): string | null {
  return typeof id === 'string' && /^[0-9a-f]{64}$/.test(id) ? id : null;
}

const binOf = (userData: string, id: string): string =>
  join(attachmentsFolder(userData), `${id}.bin`);
const metaOf = (userData: string, id: string): string =>
  join(attachmentsFolder(userData), `${id}.json`);

/** Everything written down about one attachment except the original bytes.
 *  The window is handed this from the metadata file alone, so drawing a row
 *  never reads a megabyte. Whether these bytes were already here is a fact
 *  about the call, not about the file, and is not written down. */
type Meta = Omit<KeptAttachment, 'thumb' | 'twice'> & {
  thumbName?: string;
  thumbType?: string;
  keptAt: string;
};

async function readMeta(userData: string, id: string): Promise<Meta | null> {
  const raw = await readFile(metaOf(userData, id), 'utf8').catch(() => null);
  if (raw === null) return null;
  try {
    const one = JSON.parse(raw) as Meta;
    if (
      one.id !== id ||
      typeof one.name !== 'string' ||
      one.name === '' ||
      (one.kind !== 'image' && one.kind !== 'document') ||
      typeof one.mimeType !== 'string' ||
      one.mimeType === '' ||
      typeof one.byteSize !== 'number' ||
      !Number.isSafeInteger(one.byteSize) ||
      one.byteSize < 0 ||
      typeof one.keptAt !== 'string' ||
      Number.isNaN(Date.parse(one.keptAt))
    ) {
      return null;
    }
    if (one.thumbName !== undefined && one.thumbName !== `${id}.thumb.jpg`) return null;
    if (one.thumbName !== undefined && typeof one.thumbType !== 'string') return null;
    return one;
  } catch {
    // A half-written metadata file is not a stored attachment. The bytes are
    // still there under their own name, which is what makes them findable.
    return null;
  }
}

/** One stored attachment as the window sees it: the metadata, the small copy as
 *  a data URL, and whether it was already here. Never the original. */
async function shown(userData: string, meta: Meta, twice: boolean): Promise<KeptAttachment> {
  const facts = {
    id: meta.id,
    name: meta.name,
    kind: meta.kind,
    mimeType: meta.mimeType,
    byteSize: meta.byteSize,
    twice,
  };
  if (meta.thumbName === undefined) return { ...facts, thumb: null };
  const bytes = await readFile(join(attachmentsFolder(userData), meta.thumbName)).catch(
    () => null,
  );
  // No small copy is a chip with a name on it, which is what a PDF gets anyway.
  if (bytes === null) return { ...facts, thumb: null };
  return {
    ...facts,
    thumb: `data:${meta.thumbType ?? 'image/jpeg'};base64,${bytes.toString('base64')}`,
  };
}

/** Why one file will not be kept, worded for somebody who has just dropped it
 *  in. Nothing here blames them, and each one says what would work instead. */
function whyNot(file: Incoming): string | null {
  if (file.bytes.length === 0) return 'It arrived with nothing in it.';
  if (file.bytes.length > MAX_KEPT_BYTES) {
    // The ceiling is said in whole megabytes rather than through
    // `readableSize`, which rounds to the nearest: at this size the file and
    // the ceiling it just passed both read as "26 MB", which is no answer.
    return `That one is ${readableSize(file.bytes.length)}, over the ${String(
      MAX_KEPT_BYTES / (1024 * 1024),
    )} MB I keep. A smaller export or a JPEG usually gets there.`;
  }
  return null;
}

/** The one sentence to show when only some of a drop arrived — which file did
 *  not, and that the rest did. Silence here would read as a bug in the app
 *  rather than as one file that would not come in. */
function partial(kept: number, refused: readonly RefusedAttachment[]): string {
  const names = refused.map((one) => one.name).join(', ');
  const why = refused[0]?.because ?? '';
  if (kept === 0) return `${names} did not come in. ${why}`;
  return `${names} did not come in, and the other ${kept === 1 ? 'one' : String(kept)} did. ${why}`;
}

/**
 * Write down what somebody attached, and say what did not arrive.
 *
 * Bytes are written once: a file already here under its own hash is left
 * exactly as it is, and the name it was first kept under is the one it answers
 * to — the same photograph sent under `hero.png` and `hero-final.png` is one
 * stored attachment, and every row that holds it holds the same id.
 *
 * `held` is what the conversation already has, by id. It is the caller's to
 * know because the conversation's attachment row lives in the window; passing
 * it back is what makes the ceiling a property of the conversation rather than
 * of one drop, and what stops a retry of something already held from counting
 * against it twice.
 *
 * One file failing does not take the others with it. Everything that could be
 * kept is kept, and the refusals come back named.
 */
export async function keep(
  userData: string,
  files: readonly Incoming[],
  held: readonly string[] = [],
): Promise<KeptAttachments> {
  const already = new Set(held.filter((one) => lookedUp(one) !== null));
  const kept: KeptAttachment[] = [];
  const refused: RefusedAttachment[] = [];

  for (const file of files) {
    const name = typeof file.name === 'string' && file.name !== '' ? file.name : 'attachment';
    const because = whyNot(file);
    if (because !== null) {
      refused.push({ name, because });
      continue;
    }
    const id = contentId(file.bytes);
    // The ceiling belongs to the conversation, and what it already holds does
    // not count twice: a retry after a failed send hands over the same twelve
    // and is not a thirteenth. Counted as each is taken, so one drop of
    // thirteen stops at twelve rather than at the first refusal.
    if (!already.has(id) && already.size >= MAX_PER_CONVERSATION) {
      refused.push({
        name,
        because: `This conversation is holding ${MAX_PER_CONVERSATION} attachments already. Send this one in a message of its own.`,
      });
      continue;
    }
    try {
      kept.push(await writtenOnce(userData, id, { ...file, name }));
      already.add(id);
    } catch {
      refused.push({
        name,
        because: 'This computer would not let me save it, so nothing was kept.',
      });
    }
  }

  return { kept, refused, because: refused.length === 0 ? null : partial(kept.length, refused) };
}

/** One attachment on disk: the bytes if they are not there yet, the small copy,
 *  and the metadata last, so a row is only ever drawn for something complete. */
async function writtenOnce(userData: string, id: string, file: Incoming): Promise<KeptAttachment> {
  const existing = await readMeta(userData, id);
  const bin = binOf(userData, id);
  const there = await stat(bin).then(
    (one) => one.isFile() && one.size === file.bytes.length,
    () => false,
  );
  if (!there) await writeAtomically(bin, file.bytes);

  if (existing !== null && existing.byteSize === file.bytes.length) {
    // Same content, so the same stored attachment: the name it was first kept
    // under stands, and nothing is written again.
    return shown(userData, existing, true);
  }

  let thumbName: string | undefined;
  let thumbType: string | undefined;
  if (file.thumb !== undefined && file.thumb !== null && file.thumb.length > 0) {
    thumbName = `${id}.thumb.jpg`;
    thumbType = file.thumbType ?? 'image/jpeg';
    await writeAtomically(join(attachmentsFolder(userData), thumbName), file.thumb);
  }

  const meta: Meta = {
    id,
    name: file.name,
    kind: file.kind,
    mimeType: file.mimeType,
    byteSize: file.bytes.length,
    keptAt: new Date().toISOString(),
    ...(thumbName === undefined ? {} : { thumbName, thumbType }),
  };
  await writeAtomically(metaOf(userData, id), JSON.stringify(meta));
  return shown(userData, meta, false);
}

/** The original bytes back, for sending the same attachment again or opening
 *  it. Null when nothing is stored under that id — a row from a profile
 *  somebody moved, most likely. */
export async function copyOf(userData: string, id: unknown): Promise<AttachmentCopy | null> {
  const named = lookedUp(id);
  if (named === null) return null;
  const meta = await readMeta(userData, named);
  if (meta === null) return null;
  const bytes = await readFile(binOf(userData, named)).catch(() => null);
  if (bytes === null) return null;
  return {
    id: named,
    name: meta.name,
    kind: meta.kind,
    mimeType: meta.mimeType,
    bytes: bytes.toString('base64'),
  };
}
