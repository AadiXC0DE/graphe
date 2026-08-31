/** Reading papers: a PDF becomes words, one page at a time.
 *
 * The `webfetch` tool used to refuse anything that was not a page of HTML.
 * Papers are the biggest gap in that refusal — an arxiv address is the most
 * common thing a designer is handed and the least readable. This module turns
 * PDF bytes into pages and pulls a paper's front matter from the arXiv export
 * API, so a paper reads like a file: title and authors first, then the body,
 * a page range at a time.
 *
 * Pi-free on purpose: the tools module imports it, tests import it, and it
 * never touches a Pi type. The extraction is unpdf — Mozilla's PDF.js built
 * for Node, which is what makes the text uncorrupted where older extractors
 * garble it.
 */

import { extractText } from 'unpdf';

/** One name the arxiv API knows us by, and the reader its pages expect. */
export const ARXIV_USER_AGENT = 'graphe/0.1 (a design workspace; contact: the user)';

/** The id inside an arxiv address: /abs/2401.01234 or /pdf/2401.01234, with or
 *  without a version suffix. Anything else is not a paper to us — yet. */
export function arxivId(address: string): string | null {
  const match = /arxiv\.org\/(?:abs|pdf)\/([0-9]{4}\.[0-9]{4,5})(?:v[0-9]+)?/.exec(address);
  return match?.[1] ?? null;
}

/** A paper's front matter, as the export API hands it over: an Atom feed with
 *  one entry. Read with a regex — an XML parser for one `<entry>` is a
 *  dependency with a job description this file is too small to need. */
export type ArxivMeta = {
  title: string;
  authors: string;
  abstract: string;
  pdf: string;
};

export function parseArxivMeta(xml: string, id: string): ArxivMeta | null {
  const entry = /<entry>([\s\S]*?)<\/entry>/i.exec(xml)?.[1];
  if (entry === undefined) return null;
  const inside = (tag: string): string =>
    new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, 'i').exec(entry)?.[1] ?? '';
  const authors = [...entry.matchAll(/<name>([\s\S]*?)<\/name>/gi)].map((m) =>
    (m[1] ?? '').replace(/\s+/g, ' ').trim(),
  );
  return {
    title: inside('title').replace(/\s+/g, ' ').trim(),
    authors: authors.join(', '),
    abstract: inside('summary').replace(/\s+/g, ' ').trim(),
    pdf: `https://arxiv.org/pdf/${id}`,
  };
}

export async function arxivMeta(
  id: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<ArxivMeta | null> {
  try {
    const response = await fetchFn(`https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}`, {
      signal,
      headers: { 'User-Agent': ARXIV_USER_AGENT },
    });
    if (!response.ok) return null;
    return parseArxivMeta(await response.text(), id);
  } catch {
    return null;
  }
}

/** A PDF read off the wire: its pages as words, and how many pages it had —
 *  including pages that were pictures and so contributed nothing. */
export type PdfPages = { totalPages: number; pages: readonly string[] };

export async function readPdfPages(buffer: ArrayBuffer | Uint8Array): Promise<PdfPages> {
  const { totalPages, text } = await extractText(buffer);
  const pages = text.map((page) => page.trim()).filter((page) => page !== '');
  return { totalPages, pages };
}

/** The pages worth returning, and the note that tells the reader how much was
 *  left out. A page range is 1-indexed and inclusive; no range means "as many
 *  as fit the reading cap, from the top". */
export function slicePages(
  pages: readonly string[],
  cap: number,
  range: { fromPage?: number; toPage?: number } = {},
): { text: string; note: string } {
  const from = Math.max(1, range.fromPage ?? 1);
  const to = Math.min(pages.length, range.toPage ?? pages.length);
  const notes: string[] = [];

  let kept = '';
  let endedEarly = false;
  for (let i = from - 1; i < to; i++) {
    const page = pages[i];
    if (page === undefined) break;
    const marker = pages.length > 1 ? `\n\npage ${i + 1} of ${pages.length}\n\n` : '\n\n';
    if (kept.length + page.length > cap) {
      endedEarly = true;
      break;
    }
    kept += marker + page;
  }
  if (range.fromPage !== undefined && range.fromPage > 1) {
    notes.push(`the pages before ${range.fromPage} are not here`);
  }
  if (range.toPage !== undefined && range.toPage < pages.length) {
    notes.push(`the pages after ${range.toPage} are not here`);
  } else if (endedEarly) {
    notes.push(`the rest of the paper is not here`);
  }
  return {
    text: kept.trim(),
    note: notes.length > 0 ? `\n\n(You have the first pages, one at a time: ${notes.join(', and ')}. Ask again for a later page to keep reading.)` : '',
  };
}

/** Characters of an attached PDF carried into the message. The same ceiling a
 *  fetched paper gets: everything here is paid for again in every later turn. */
export const MAX_ATTACHED_CHARACTERS = 20_000;

/** An attached PDF, as the words that go with the message.
 *
 *  A scan with no text in it still gets a block. A paper that arrives and then
 *  means nothing reads as the app having lost it, which is the one ending this
 *  must not have. */
export function attachedPaper(name: string, pages: readonly string[]): string {
  const called = name.replace(/["<>]/g, '').trim() || 'attachment.pdf';
  if (pages.length === 0) {
    return `<attached-pdf name="${called}">This PDF is pictures rather than words, so there is no text in it to read. A screenshot of the pages that matter would work.</attached-pdf>`;
  }
  const { text, note } = slicePages(pages, MAX_ATTACHED_CHARACTERS);
  return `<attached-pdf name="${called}">\n${text}${note}\n</attached-pdf>`;
}
