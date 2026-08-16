/** Searching the web, with a fallback chain.
 *
 * One engine is a single point of failure: blocked, bot-challenged, or
 * momentarily broken and a search reports "nothing found" with no way to tell
 * whether the silence was real. So the search tool walks a small chain — the
 * first engine that answers with results wins, the ones that failed are named
 * in the reply, and a person reading sees where the answers came from.
 *
 * This module is deliberately free of Pi types so it can be tested in plain
 * Node. Parsers are pure functions over fetched HTML; the chain is pure over
 * the providers it is handed.
 */

/** How many results are worth returning. Ten results of five thousand characters
 *  is a wall of text; ten titles and their first two lines is a search. */
export const RESULT_COUNT = 8;

/** One result, as the model reads it: a title, the address, and the first two
 *  lines of what the page says — enough to know whether it is worth opening,
 *  never a copy of the page. */
export type SearchHit = { title: string; address: string; words: string };

/** One engine's failure, recorded so the reply can name it. */
export type SearchFailure = { provider: string; reason: string };

export type SearchProvider = {
  /** A name a person recognises from the reply. */
  name: string;
  run: (query: string, signal: AbortSignal) => Promise<readonly SearchHit[]>;
};

/** One name for both web tools, so a site that wants to refuse us can. */
export const USER_AGENT = 'graphe/0.1 (a design workspace; contact: the user)';

function stripTags(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&rarr;/g, '→')
    .replace(/\s+/g, ' ')
    .trim();
}

/** DuckDuckGo hands back its own redirect addresses. The real one is the
 *  `uddg=` query parameter, restored before it is shown. */
function realAddress(href: string): string {
  const uddg = /[?&]uddg=([^&]+)/.exec(href)?.[1];
  if (uddg === undefined) return href;
  let decoded: string;
  try {
    decoded = decodeURIComponent(uddg);
  } catch {
    return href;
  }
  return decoded.includes('://') ? decoded : href;
}

/** The address worth keeping, from any engine's anchor href. */
function usableAddress(href: string): string {
  const decoded = realAddress(href.trim());
  return decoded.includes('://') ? decoded : '';
}

/** DuckDuckGo's main HTML endpoint, scraped defensively. No key, no account,
 *  and the page is plain enough to read without a parser. */
export async function duckDuckGo(
  query: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<readonly SearchHit[]> {
  const response = await fetchFn(
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`,
    { signal, headers: { 'User-Agent': USER_AGENT } },
  );
  if (!response.ok) throw new Error(`it answered with ${String(response.status)}`);
  return parseDuckDuckGo(await response.text());
}

export function parseDuckDuckGo(html: string): readonly SearchHit[] {
  const blocks = [...html.matchAll(/<div[^>]*class="[^"]*result[^"]*"[^>]*>([\s\S]*?)<\/div>/g)];
  const hits: SearchHit[] = [];
  for (const block of blocks) {
    const body = block[1] ?? '';
    const link = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    const snippet = /<a[^>]*class="result__snippet"[^>]*>([\s\S]*?)<\/a>/i.exec(body);
    if (link === null) continue;
    const address = usableAddress(link[1] ?? '');
    const title = stripTags(link[2] ?? '');
    const words = stripTags(snippet?.[1] ?? '');
    if (title !== '' && address !== '') hits.push({ title, address, words });
  }
  return hits;
}

/** DuckDuckGo's light page — the same engine's sparer endpoint. It is the
 *  second rung of the chain: a different page, a different parser, and a real
 *  second chance when the main one is blocked. */
export async function duckDuckGoLite(
  query: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<readonly SearchHit[]> {
  const response = await fetchFn(
    `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`,
    { signal, headers: { 'User-Agent': USER_AGENT } },
  );
  if (!response.ok) throw new Error(`it answered with ${String(response.status)}`);
  return parseDuckDuckGoLite(await response.text());
}

/** The two rungs of the chain, in order. */
export const SEARCH_PROVIDERS: readonly SearchProvider[] = [
  {
    name: 'DuckDuckGo',
    run: (query, signal) => duckDuckGo(query, signal),
  },
  {
    name: "DuckDuckGo's light page",
    run: (query, signal) => duckDuckGoLite(query, signal),
  },
];

export function parseDuckDuckGoLite(html: string): readonly SearchHit[] {
  const anchors = [...html.matchAll(/<a([^>]*?)class=(["'])result-link\2[^>]*>([\s\S]*?)<\/a>/gi)];
  const snippets = [...html.matchAll(/<td[^>]*class=(["'])result-snippet\1[^>]*>([\s\S]*?)<\/td>/gi)];
  const hits: SearchHit[] = [];
  anchors.forEach((anchor, index) => {
    const tag = anchor[1] ?? '';
    const href = /href=(["'])([^"']+)\1/i.exec(tag)?.[2] ?? '';
    const address = usableAddress(href);
    const title = stripTags(anchor[3] ?? '');
    const words = stripTags(snippets[index]?.[2] ?? '');
    if (title !== '' && address !== '') hits.push({ title, address, words });
  });
  return hits;
}

/** Walk the chain. The first engine that returns results wins; failures are
 *  kept and named, so a search that fell back never looks like a search that
 *  could not happen. */
export async function chainSearch(
  providers: readonly SearchProvider[],
  query: string,
  signal: AbortSignal,
): Promise<{ hits: readonly SearchHit[]; failures: readonly SearchFailure[]; used: string }> {
  const failures: SearchFailure[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    let hits: readonly SearchHit[];
    try {
      hits = await provider.run(query, signal);
    } catch (cause) {
      const aborted = signal.aborted;
      if (aborted) throw new Error('Search stopped.');
      failures.push({
        provider: provider.name,
        reason: cause instanceof Error && cause.message !== '' ? cause.message : 'it did not answer',
      });
      continue;
    }
    // Results already seen by an earlier engine add nothing; the first engine
    // to contribute something fresh is the one that gets the say.
    const fresh = hits.filter((hit) => {
      if (seen.has(hit.address)) return false;
      seen.add(hit.address);
      return true;
    });
    if (fresh.length > 0) {
      return { hits: fresh.slice(0, RESULT_COUNT), failures, used: provider.name };
    }
    failures.push({ provider: provider.name, reason: 'it turned up nothing relevant' });
  }
  return { hits: [], failures, used: providers[providers.length - 1]?.name ?? '' };
}

/** The reply, in the shape the search tool has always returned: titles and
 *  addresses with the first two lines. When the chain fell back, the reply
 *  says so — silence dresses a blocked engine as an empty web. */
export function formatSearch(
  query: string,
  result: { hits: readonly SearchHit[]; failures: readonly SearchFailure[]; used: string },
): string {
  const lines: string[] = [];
  for (const hit of result.hits) {
    const words =
      hit.words.length > 180 ? `${hit.words.slice(0, 180)}…` : hit.words;
    lines.push(`- ${hit.title}\n  ${hit.address}\n  ${words}`);
  }
  if (lines.length === 0) return `I could not find anything for "${query}".`;
  const note =
    result.failures.length === 0
      ? ''
      : `\n\n(These came from ${result.used}; the other ${result.failures.length === 1 ? 'source' : 'sources'}, ${result.failures
          .map((f) => f.provider)
          .join(', ')}, did not answer.)`;
  return `${lines.join('\n\n')}${note}`;
}