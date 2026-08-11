/** Ask for anything — the matcher on its own. Strings and lists in, a ranked
 *  list out; nothing here touches a clock or a bridge. */

import { describe, expect, it } from 'vitest';
import { MOST_WE_SHOW, findAnything, hitOf } from '../src/lib/anything';
import type { Found, Things } from '../src/lib/anything';
import type { Conversation, Page, RecentProject, SavedVersion } from '../src/lib/ipc';

const NOW = 1_700_000_000_000;
const MINUTE = 60_000;

function project(name: string, minutesAgo: number, path = `/work/${name}`): RecentProject {
  return {
    path,
    name,
    lastOpenedAt: NOW - minutesAgo * MINUTE,
    lastSpend: null,
    missing: false,
  };
}

function conversation(title: string, minutesAgo: number, messages = 4): Conversation {
  return {
    id: `c-${title}`,
    path: `/work/threads/${title}.jsonl`,
    title,
    at: NOW - minutesAgo * MINUTE,
    messages,
  };
}

function page(name: string, route: string, file = `src/pages${route}.tsx`): Page {
  return { route, file, name };
}

function version(title: string, minutesAgo: number, current = false): SavedVersion {
  return {
    id: `v-${title}`,
    at: NOW - minutesAgo * MINUTE,
    title,
    by: 'graphe',
    named: false,
    current,
  };
}

function labels(found: readonly Found[]): string[] {
  return found.map((one) => one.label);
}

function kinds(found: readonly Found[]): string[] {
  return found.map((one) => one.kind);
}

const ask = { now: NOW };

describe('ask for anything — an empty box', () => {
  it('answers with the most recent things, newest first', () => {
    const things: Things = {
      projects: [project('Atlas', 90), project('Beacon', 3)],
      conversations: [conversation('The header', 30)],
    };
    expect(labels(findAnything('', things, ask))).toEqual(['Beacon', 'The header', 'Atlas']);
  });

  it('has nothing to say when nothing has been typed', () => {
    const things: Things = { projects: [project('Atlas', 1)] };
    expect(kinds(findAnything('', things, ask))).not.toContain('say');
  });

  it('answers with nothing at all when there is nothing on hand', () => {
    expect(findAnything('   ', {}, ask)).toEqual([]);
  });
});

describe('ask for anything — talking is always an answer', () => {
  it('puts the sentence first when nothing matches it', () => {
    const things: Things = { projects: [project('Atlas', 1)], pages: [page('Pricing', '/pricing')] };
    const found = findAnything('make the footer quieter', things, ask);
    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe('say');
    expect(found[0]?.label).toBe('make the footer quieter');
  });

  it('carries the trimmed sentence as its payload', () => {
    const found = findAnything('  tidy the spacing  ', {}, ask);
    const only = found[0];
    expect(only?.kind).toBe('say');
    expect(only?.kind === 'say' ? only.say : null).toBe('tidy the spacing');
  });

  it('still offers it last when there are matches', () => {
    const things: Things = { pages: [page('Pricing', '/pricing')] };
    expect(kinds(findAnything('pricing', things, ask))).toEqual(['page', 'say']);
  });
});

describe('ask for anything — how it ranks', () => {
  it('puts an exact name above a prefix above a word above scattered letters', () => {
    const things: Things = {
      pages: [
        page('Reprint pictures', '/reprint-pictures'),
        page('New pricing', '/new-pricing'),
        page('Price', '/price'),
        page('Pricing plans', '/pricing-plans'),
      ],
    };
    expect(labels(findAnything('pric', things, ask))).toEqual([
      // The front of the name, shortest first — least left over to be wrong about.
      'Price',
      'Pricing plans',
      // The word, but not at the front.
      'New pricing',
      // Only the letters, in order.
      'Reprint pictures',
      'pric',
    ]);
  });

  it('puts an exact match above a longer one that merely starts the same way', () => {
    const things: Things = {
      pages: [page('Pricing plans', '/pricing-plans'), page('Pricing', '/pricing')],
    };
    expect(labels(findAnything('pricing', things, ask))[0]).toBe('Pricing');
  });

  it('prefers a name to a path', () => {
    const things: Things = {
      projects: [project('Beacon', 1, '/work/atlas/beacon'), project('Atlas', 1, '/work/atlas')],
    };
    expect(labels(findAnything('atlas', things, ask)).slice(0, 2)).toEqual(['Atlas', 'Beacon']);
  });

  it('prefers letters that sit close together', () => {
    const things: Things = {
      conversations: [
        conversation('Have the dining room redrawn', 1),
        conversation('Header row', 1),
      ],
    };
    expect(labels(findAnything('hdr', things, ask))[0]).toBe('Header row');
  });
});

describe('ask for anything — ties go to whatever was touched most recently', () => {
  it('orders two identically named projects by when they were last open', () => {
    const things: Things = {
      projects: [project('Atlas', 500, '/old/atlas'), project('Atlas', 2, '/new/atlas')],
    };
    const found = findAnything('atlas', things, ask);
    expect(found.map((one) => one.id).slice(0, 2)).toEqual([
      'project:/new/atlas',
      'project:/old/atlas',
    ]);
  });

  it('orders two identically titled conversations the same way', () => {
    const things: Things = {
      conversations: [conversation('The header', 400), conversation('The header', 5)],
    };
    const found = findAnything('the header', things, ask);
    expect(found[0]?.kind === 'conversation' ? found[0].conversation.at : 0).toBe(NOW - 5 * MINUTE);
  });
});

describe('ask for anything — reading what was typed', () => {
  it('does not care about case, in either direction', () => {
    const things: Things = { projects: [project('Atlas', 1)], pages: [page('PRICING', '/pricing')] };
    expect(labels(findAnything('ATLAS', things, ask))).toContain('Atlas');
    expect(labels(findAnything('pricing', things, ask))).toContain('PRICING');
  });

  it('finds letters in order without them being together', () => {
    const things: Things = { conversations: [conversation('Check the contrast', 1)] };
    expect(labels(findAnything('cntrst', things, ask))).toContain('Check the contrast');
  });

  it('will not match letters that are out of order', () => {
    const things: Things = { conversations: [conversation('Check the contrast', 1)] };
    expect(kinds(findAnything('tsartnoc', things, ask))).toEqual(['say']);
  });

  it('reads a hump in a name as the start of a word', () => {
    expect(hitOf('heroBanner', 'banner')?.tier).toBe(2);
    expect(hitOf('rebanner', 'banner')?.tier).toBe(1);
  });

  it('finds a page by its address as readily as by its name', () => {
    const things: Things = { pages: [page('Case studies', '/case-studies/[slug]')] };
    expect(labels(findAnything('/case-studies', things, ask))[0]).toBe('Case studies');
  });

  it('finds a version by what it was called', () => {
    const things: Things = { versions: [version('Made the header sticky', 4, true)] };
    const found = findAnything('sticky', things, ask);
    expect(found[0]?.kind).toBe('version');
    expect(found[0]?.sub).toContain('What it looks like now');
  });

  it('ignores whitespace around what was typed', () => {
    const things: Things = { projects: [project('Atlas', 1)] };
    expect(labels(findAnything('  atlas  ', things, ask))[0]).toBe('Atlas');
  });
});

describe('ask for anything — how much it hands back', () => {
  const many: Things = {
    pages: Array.from({ length: 30 }, (_, index) => page(`Page ${index}`, `/page-${index}`)),
  };

  it('stops at eight rows by itself', () => {
    expect(findAnything('page', many, ask)).toHaveLength(MOST_WE_SHOW);
  });

  it('keeps the sentence inside whatever limit it is given', () => {
    const found = findAnything('page', many, { now: NOW, limit: 3 });
    expect(found).toHaveLength(3);
    expect(found[2]?.kind).toBe('say');
  });

  it('caps the empty box too', () => {
    const found = findAnything('', many, { now: NOW, limit: 4 });
    expect(found).toHaveLength(4);
  });

  it('hands back nothing at all when asked for nothing', () => {
    expect(findAnything('page', many, { now: NOW, limit: 0 })).toEqual([]);
  });
});

describe('ask for anything — what each row says', () => {
  it('names a project that is not where we left it', () => {
    const gone: RecentProject = { ...project('Atlas', 10), missing: true };
    const found = findAnything('atlas', { projects: [gone] }, ask);
    expect(found[0]?.sub).toBe('Not where we left it');
  });

  it('counts one message without a plural nobody would say', () => {
    const found = findAnything('header', { conversations: [conversation('Header', 1, 1)] }, ask);
    expect(found[0]?.sub).toContain('1 message ·');
  });

  it('gives every row an id of its own, so a list can be keyed by it', () => {
    const things: Things = {
      projects: [project('Atlas', 1)],
      conversations: [conversation('Atlas talk', 1)],
      pages: [page('Atlas', '/atlas')],
      versions: [version('Atlas rework', 1)],
    };
    const found = findAnything('atlas', things, ask);
    expect(new Set(found.map((one) => one.id)).size).toBe(found.length);
  });

  it('hands the thing itself back, not just a name for it', () => {
    const only = page('Pricing', '/pricing');
    const found = findAnything('pricing', { pages: [only] }, ask);
    expect(found[0]?.kind === 'page' ? found[0].page : null).toBe(only);
  });
});
