/** Reading the documents people actually hand over.
 *
 * A PDF, a Word file, a deck, a spreadsheet. Every one of them is a file the
 * ordinary read tool answers with a screenful of binary, so the agent goes
 * looking for a way round — and writing a throwaway Python script to read a
 * PDF is a way round that happens to work, which is worse than one that does
 * not.
 *
 * Office files are zip archives holding XML, so this is a small zip reader and
 * a smaller tag stripper. No dependency: `zlib` is Node's, and a library for
 * this would be a second copy of what is already in the runtime. PDFs go
 * through `unpdf`, as they already did for attachments and `webfetch`.
 *
 * Pure but for `readDocument`, which is the one thing here that touches a disk.
 */

import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

import { readPdfPages, slicePages } from './pdf';

/** What a document turns into. `pages` is slides for a deck, sheets for a
 *  spreadsheet, pages for a paper — whatever that format divides itself into. */
export type Document = { kind: DocumentKind; pages: readonly string[] };

export type DocumentKind = 'pdf' | 'word' | 'slides' | 'sheet';

/** As much of one document as is worth putting in a reply. Past this it is not
 *  being read, it is being pasted. */
export const MOST_CHARACTERS = 40_000;

/** Which extensions this can answer for, and what each one is. The old formats
 *  (`.doc`, `.ppt`, `.xls`) are not zip archives and are deliberately absent —
 *  saying so is better than half-reading one. */
const BY_EXTENSION: Readonly<Record<string, DocumentKind>> = {
  '.pdf': 'pdf',
  '.docx': 'word',
  '.pptx': 'slides',
  '.xlsx': 'sheet',
};

export function documentKind(path: string): DocumentKind | null {
  return BY_EXTENSION[extname(path).toLowerCase()] ?? null;
}

export const READABLE = Object.keys(BY_EXTENSION).join(', ');

/* -------------------------------------------------------------------------- */
/* The zip inside an Office file                                              */
/* -------------------------------------------------------------------------- */

/** Read through the central directory rather than scanning for local headers:
 *  a local header may leave its sizes until after the data, and the directory
 *  never does. */
export function unzip(bytes: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  const end = findEndOfDirectory(bytes);
  if (end === null) return out;
  const count = bytes.readUInt16LE(end + 10);
  let at = bytes.readUInt32LE(end + 16);
  if (at === 0xffff_ffff) return out; // zip64, which an Office file is not
  for (let entry = 0; entry < count; entry += 1) {
    if (at + 46 > bytes.length || bytes.readUInt32LE(at) !== 0x0201_4b50) break;
    const method = bytes.readUInt16LE(at + 10);
    const compressed = bytes.readUInt32LE(at + 20);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localAt = bytes.readUInt32LE(at + 42);
    const name = bytes.toString('utf8', at + 46, at + 46 + nameLength);
    at += 46 + nameLength + extraLength + commentLength;

    if (localAt + 30 > bytes.length || bytes.readUInt32LE(localAt) !== 0x0403_4b50) continue;
    const localName = bytes.readUInt16LE(localAt + 26);
    const localExtra = bytes.readUInt16LE(localAt + 28);
    const from = localAt + 30 + localName + localExtra;
    const raw = bytes.subarray(from, from + compressed);
    try {
      out.set(name, method === 0 ? Buffer.from(raw) : inflateRawSync(raw));
    } catch {
      // One unreadable part is not an unreadable document.
    }
  }
  return out;
}

function findEndOfDirectory(bytes: Buffer): number | null {
  // The record is last, after a comment that is almost always empty.
  const earliest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let at = bytes.length - 22; at >= earliest; at -= 1) {
    if (bytes.readUInt32LE(at) === 0x0605_4b50) return at;
  }
  return null;
}

/* -------------------------------------------------------------------------- */
/* XML to words                                                               */
/* -------------------------------------------------------------------------- */

const ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&apos;': "'",
  '&#39;': "'",
};

/** Tags out, entities back, whitespace tidied. `breaks` are the tags that mean
 *  a new line — a paragraph in Word, a row in a sheet — so a document does not
 *  come back as one endless sentence. */
export function textFromXml(xml: string, breaks: readonly string[] = []): string {
  let said = xml;
  for (const tag of breaks) said = said.split(tag).join('\n');
  said = said.replace(/<[^>]*>/g, '');
  said = said.replace(/&#(\d+);/g, (_all, code: string) => String.fromCodePoint(Number(code)));
  for (const [entity, character] of Object.entries(ENTITIES)) {
    said = said.split(entity).join(character);
  }
  return said
    .split('\n')
    .map((line) => line.replace(/[ \t\u00a0]+/g, ' ').trim())
    .filter((line) => line !== '')
    .join('\n');
}

/** Names like `ppt/slides/slide10.xml` in the order a person sees them, not the
 *  order the alphabet puts slide10 before slide2 in. */
export function inNumberOrder(names: readonly string[]): readonly string[] {
  const numberIn = (name: string): number => Number(/(\d+)\D*$/.exec(name)?.[1] ?? 0);
  return [...names].sort((one, other) => numberIn(one) - numberIn(other) || one.localeCompare(other));
}

/* -------------------------------------------------------------------------- */
/* Each format                                                                */
/* -------------------------------------------------------------------------- */

/** Word keeps the body in one part, paragraph by paragraph. */
export function wordText(parts: Map<string, Buffer>): readonly string[] {
  const body = parts.get('word/document.xml');
  if (body === undefined) return [];
  const said = textFromXml(body.toString('utf8'), ['</w:p>', '<w:br/>', '<w:br />']);
  return said === '' ? [] : [said];
}

/** A deck keeps one part per slide, and the slide number is in the name. */
export function slidesText(parts: Map<string, Buffer>): readonly string[] {
  const names = inNumberOrder(
    [...parts.keys()].filter((one) => /^ppt\/slides\/slide\d+\.xml$/.test(one)),
  );
  return names
    .map((name, index) => {
      const said = textFromXml(parts.get(name)?.toString('utf8') ?? '', ['</a:p>', '</a:br>']);
      return said === '' ? '' : `Slide ${String(index + 1)}\n${said}`;
    })
    .filter((one) => one !== '');
}

/**
 * A spreadsheet keeps its words in one shared table and its cells point at it.
 *
 * Reading the shared table gives the text of the book without the grid, which
 * is what somebody asking "what does this say" wants. A cell-by-cell read would
 * need the whole relationship graph for a worse answer.
 */
export function sheetText(parts: Map<string, Buffer>): readonly string[] {
  const shared = parts.get('xl/sharedStrings.xml');
  const words = shared === undefined ? '' : textFromXml(shared.toString('utf8'), ['</si>']);
  const inline = inNumberOrder([...parts.keys()].filter((one) => /^xl\/worksheets\/sheet\d+\.xml$/.test(one)))
    .map((name) => textFromXml(parts.get(name)?.toString('utf8') ?? '', ['</row>']))
    .filter((one) => one !== '');
  return [words, ...inline].filter((one) => one !== '');
}

/* -------------------------------------------------------------------------- */
/* The one thing that reads a disk                                            */
/* -------------------------------------------------------------------------- */

export async function readDocument(path: string): Promise<Document> {
  const kind = documentKind(path);
  if (kind === null) throw new Error(`I can read ${READABLE}. That is not one of them.`);
  const bytes = await readFile(path);
  if (kind === 'pdf') {
    const { pages } = await readPdfPages(new Uint8Array(bytes));
    return { kind, pages };
  }
  const parts = unzip(bytes);
  if (parts.size === 0) {
    throw new Error('That file is not readable as a document — it may be the older format, or damaged.');
  }
  const pages =
    kind === 'word' ? wordText(parts) : kind === 'slides' ? slidesText(parts) : sheetText(parts);
  return { kind, pages };
}

/** What one document says, as the tool answers with it. */
export function documentSaid(path: string, document: Document): string {
  if (document.pages.length === 0) {
    return `“${path}” has no text in it to read — it is likely pictures rather than words. A screenshot of the part that matters would work.`;
  }
  const { text, note } = slicePages(document.pages, MOST_CHARACTERS);
  return `<document name="${path.replace(/["<>]/g, '')}" kind="${document.kind}">\n${text}${note}\n</document>`;
}
