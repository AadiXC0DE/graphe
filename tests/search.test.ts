/** Searching the web, with the chain it is built on.
 *
 *  No network here: the parsers are exercised against the HTML shapes the two
 *  DuckDuckGo pages actually return, and the chain is exercised with stub
 *  providers so every path — first provider wins, blocked provider, empty
 *  provider, all failed — is decided in code, not on the day's connectivity. */

import { describe, expect, it } from 'vitest';

import {
  chainSearch,
  formatSearch,
  parseDuckDuckGo,
  parseDuckDuckGoLite,
  type SearchProvider,
} from '../src/agent/pi/search';

const signal = new AbortController().signal;

function provider(name: string, hits: unknown): SearchProvider {
  return {
    name,
    run: async () => {
      if (hits === 'throw') throw new Error('it answered with 403');
      return hits as never;
    },
  };
}

describe('the chain', () => {
  it('stops at the first provider that answers with results', async () => {
    const outcome = await chainSearch(
      [
        provider('first', [{ title: 'a', address: 'https://a.example/', words: 'words' }]),
        provider('second', [{ title: 'b', address: 'https://b.example/', words: 'words' }]),
      ],
      'query',
      signal,
    );
    expect(outcome.used).toBe('first');
    expect(outcome.hits.map((h) => h.address)).toEqual(['https://a.example/']);
    expect(outcome.failures).toEqual([]);
  });

  it('falls through a blocked provider and says it failed', async () => {
    const outcome = await chainSearch(
      [provider('a', 'throw'), provider('b', [{ title: 'b', address: 'https://b.example/', words: 'w' }])],
      'query',
      signal,
    );
    expect(outcome.used).toBe('b');
    expect(outcome.failures).toEqual([{ provider: 'a', reason: 'it answered with 403' }]);
  });

  it('falls through a provider that turned up nothing', async () => {
    const outcome = await chainSearch(
      [provider('a', []), provider('b', [{ title: 'b', address: 'https://b.example/', words: 'w' }])],
      'query',
      signal,
    );
    expect(outcome.used).toBe('b');
    expect(outcome.failures).toEqual([{ provider: 'a', reason: 'it turned up nothing relevant' }]);
  });

  it('keeps only the first sighting of an address from one provider', async () => {
    const outcome = await chainSearch(
      [
        provider('a', []),
        provider('b', [
          { title: 'x', address: 'https://same.example/', words: 'w' },
          { title: 'x', address: 'https://same.example/', words: 'w' },
          { title: 'y', address: 'https://other.example/', words: 'w' },
        ]),
      ],
      'query',
      signal,
    );
    expect(outcome.used).toBe('b');
    expect(outcome.hits.length).toBe(2);
  });

  it('names the failures in the reply when it fell back', () => {
    const text = formatSearch('coffee', {
      hits: [{ title: 'Coffee', address: 'https://coffee.example/', words: 'The good stuff.' }],
      failures: [{ provider: 'DuckDuckGo', reason: 'it answered with 403' }],
      used: "DuckDuckGo's light page",
    });
    expect(text).toContain('Coffee');
    expect(text).toContain('other source');
    expect(text).toContain('DuckDuckGo');
    expect(text).toContain('light page');
  });
});

describe('the DuckDuckGo parsers', () => {
  it('reads the main page: title, real address behind the redirect, and the snippet', () => {
    const html = `<div class="result results_links">
      <a class="result__a" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fcoffee.example%2F&amp;rut=1">Coffee machines</a>
      <a class="result__snippet">The best machines, reviewed every year.</a>
    </div>`;
    const hits = parseDuckDuckGo(html);
    expect(hits).toEqual([
      { title: 'Coffee machines', address: 'https://coffee.example/', words: 'The best machines, reviewed every year.' },
    ]);
  });

  it('reads the light page: links and snippets in their own rows', () => {
    const html = `<table><tr><td><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Ftea.example%2F" class='result-link'>Tea time</a></td></tr>
      <tr><td class='result-snippet'>A calm cup, done properly.</td></tr></table>`;
    const hits = parseDuckDuckGoLite(html);
    expect(hits).toEqual([
      { title: 'Tea time', address: 'https://tea.example/', words: 'A calm cup, done properly.' },
    ]);
  });
});