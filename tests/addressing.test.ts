/** Two conversations in one project, and the address that tells them apart.
 *
 * BACKLOG D1. The shell used to hold exactly one live conversation per project,
 * so "which one" was never a question anybody could ask. Now it holds several,
 * and four claims have to hold or the tabs above them are a lie:
 *
 * 1. Two are live at once and neither hears the other.
 * 2. The one nobody has come back to is the one put down, and it is said out
 *    loud — never silently, and never the one in front.
 * 3. Putting one down keeps it: opening it again picks it up rather than
 *    starting over.
 * 4. An event names the conversation it came from, so switching while a reply
 *    is arriving cannot land it in the wrong thread.
 *
 * The shell's own file cannot be imported here — it is an Electron entry point —
 * so what is tested is every piece it is assembled from: the addressing, the
 * store that holds the conversations, and the decision about how one is opened.
 */

import { describe, expect, it } from 'vitest';

import { openingFor } from '../src/agent/pi/conversations';
import { setDownWords, whereIn, type AgentNotice, type Where } from '../src/lib/ipc';
import { addressed, Workspaces } from '../src/projects/workspaces';

/* ------------------------------------------------------------ scaffolding */

/** Stands in for a live conversation. What it has been told is enough: the
 *  claim is that one thread's words are never another's. */
type Thread = { heard: string[]; file: string | null };

/** The shell's own conversation store: three live at once, the oldest put down,
 *  and a sentence about it where it happened. */
function conversations(said: { at: string; text: string }[]): Workspaces<Thread> {
  return new Workspaces<Thread>({
    limit: 3,
    close: (thread) => thread.heard.push('(put down)'),
    evicted: (one) => said.push({ at: one.path, text: setDownWords.said }),
  });
}

function open(store: Workspaces<Thread>, address: string, file: string | null = null): Thread {
  const thread: Thread = { heard: [], file };
  store.adopt({ path: address, name: address, held: thread });
  return thread;
}

/** What the shell does with an event: find the conversation the envelope names
 *  and fold it in there, never into whichever one happens to be in front. */
function receive(store: Workspaces<Thread>, notice: AgentNotice): void {
  const found = addressed(store, notice.conversation ?? undefined, (thread) => thread.file);
  if (found === null) return;
  if (notice.event.type === 'message-delta') found.held.heard.push(notice.event.text);
}

function saying(text: string, conversation?: string): AgentNotice {
  return {
    project: '/a/one',
    ...(conversation === undefined ? {} : { conversation }),
    event: { type: 'message-delta', text },
  };
}

/* ========================================================================== */
/* D-01 the address                                                            */
/* ========================================================================== */

describe('D-01 which project, which conversation', () => {
  it('reads an address off the end of the arguments', () => {
    expect(whereIn(['a version', { project: '/a/one', conversation: 'talk.jsonl' }])).toEqual({
      project: '/a/one',
      conversation: 'talk.jsonl',
    });
  });

  it('takes half an address, because half of it is still an address', () => {
    expect(whereIn([{ conversation: 'talk.jsonl' }])).toEqual({ conversation: 'talk.jsonl' });
    expect(whereIn([{ project: '/a/one' }])).toEqual({ project: '/a/one' });
  });

  /* The whole of backwards compatibility: every call the window makes today
     names nothing, and nothing named has to keep meaning the one in front. */
  it('finds no address in the calls that name nothing', () => {
    const asked: readonly unknown[][] = [
      [],
      ['Make the header darker.', undefined, { lookFirst: false }],
      ['a-version-id', true],
      [{ minor: 2000, currency: 'USD' }],
      [{ providerId: 'anthropic', modelId: 'claude-sonnet-4-5' }],
      [['one', 'two'], { duration: 200 }],
      [null],
    ];
    for (const args of asked) expect(whereIn(args)).toEqual({});
  });

  /** A child project is named by its folder name. Spaces belong to real folder
   *  names; separators and control characters never do. */
  it('keeps a project name a name, and never a path', () => {
    expect(whereIn([{ project: '/a/one', repo: 'my app' }]).repo).toBe('my app');
    expect(whereIn([{ repo: '../../etc' }]).repo).toBe('....etc');
    expect(whereIn([{ repo: 'a/b' }]).repo).toBe('ab');
    expect(whereIn([{ repo: '   ' }]).repo).toBeUndefined();
    expect(whereIn([{ repo: 'x'.repeat(200) }]).repo).toHaveLength(80);
  });

  it('never mistakes a payload for an address', () => {
    expect(whereIn([{ project: '/a/one', doing: 'something else' }])).toEqual({});
    expect(whereIn([['/a/one']])).toEqual({});
  });

  it('ignores an address made of blanks', () => {
    expect(whereIn([{ project: '  ', conversation: '' }])).toEqual({});
  });

  it('hands back the one in front when nothing is named, and only then', () => {
    const store = conversations([]);
    open(store, 'hero');
    open(store, 'pricing');

    const where: Where = {};
    expect(addressed(store, where.conversation)?.path).toBe('pricing');
    expect(addressed(store, 'hero')?.path).toBe('hero');
    // Never the nearest one. A conversation that is not live is nothing.
    expect(addressed(store, 'auth')).toBeNull();
  });

  it('answers to the file it is written down in as well as the name it was opened under', () => {
    const store = conversations([]);
    open(store, 'new-1', 'talk-3.jsonl');

    const byName = addressed(store, 'new-1', (thread) => thread.file);
    const byFile = addressed(store, 'talk-3.jsonl', (thread) => thread.file);
    expect(byName).not.toBeNull();
    expect(byFile).toBe(byName);
  });
});

/* ========================================================================== */
/* D-02 two live at once                                                       */
/* ========================================================================== */

describe('D-02 two conversations in one project', () => {
  it('keeps both live and lets neither hear the other', () => {
    const store = conversations([]);
    const hero = open(store, 'hero');
    const pricing = open(store, 'pricing');

    receive(store, saying('Working on the hero.', 'hero'));
    receive(store, saying('Working on the prices.', 'pricing'));

    expect(hero.heard).toEqual(['Working on the hero.']);
    expect(pricing.heard).toEqual(['Working on the prices.']);
    expect(store.open.map((one) => one.path)).toEqual(['pricing', 'hero']);
  });

  it('puts a reply where it started, however many times somebody has switched', () => {
    const store = conversations([]);
    const hero = open(store, 'hero');
    const pricing = open(store, 'pricing');

    // The reply began in the hero conversation. While it is arriving, somebody
    // moves to the other one, twice.
    receive(store, saying('Looking at ', 'hero'));
    store.resume('pricing');
    receive(store, saying('the header', 'hero'));
    store.resume('hero');
    store.resume('pricing');
    receive(store, saying(' now.', 'hero'));

    expect(hero.heard.join('')).toBe('Looking at the header now.');
    expect(pricing.heard).toEqual([]);
  });

  it('falls back to the one in front for anything that names no conversation', () => {
    const store = conversations([]);
    open(store, 'hero');
    const pricing = open(store, 'pricing');

    receive(store, saying('Anything at all.'));

    expect(pricing.heard).toEqual(['Anything at all.']);
  });
});

/* ========================================================================== */
/* D-03 the limit, said out loud                                               */
/* ========================================================================== */

describe('D-03 three at a time', () => {
  it('puts down the one nobody has come back to, and says which', () => {
    const said: { at: string; text: string }[] = [];
    const store = conversations(said);
    open(store, 'hero');
    open(store, 'pricing');
    open(store, 'auth');
    open(store, 'docs');

    expect(said).toEqual([{ at: 'hero', text: setDownWords.said }]);
    expect(store.open.map((one) => one.path)).toEqual(['docs', 'auth', 'pricing']);
  });

  it('never puts down the one somebody is looking at', () => {
    const said: { at: string; text: string }[] = [];
    const store = conversations(said);
    open(store, 'hero');
    open(store, 'pricing');
    open(store, 'auth');
    open(store, 'docs');

    expect(said.map((one) => one.at)).not.toContain('docs');
    expect(store.current?.path).toBe('docs');
  });

  it('counts coming back to one, so the one you keep returning to stays', () => {
    const said: { at: string; text: string }[] = [];
    const store = conversations(said);
    open(store, 'hero');
    open(store, 'pricing');
    open(store, 'auth');
    store.resume('hero');
    open(store, 'docs');

    expect(said.map((one) => one.at)).toEqual(['pricing']);
    expect(addressed(store, 'hero')).not.toBeNull();
  });

  it('says something, rather than nothing, whenever one goes', () => {
    const said: { at: string; text: string }[] = [];
    const store = conversations(said);
    for (const name of ['a', 'b', 'c', 'd', 'e']) open(store, name);

    expect(said).toHaveLength(2);
    for (const one of said) expect(one.text.trim()).not.toBe('');
  });

  /* Plain words: nothing here may name the machinery. */
  it('says it in words a designer already has', () => {
    expect(setDownWords.said).not.toMatch(/session|token|context|memory|evict/i);
    expect(setDownWords.said).toMatch(/open it again/i);
  });
});

/* ========================================================================== */
/* D-04 closing keeps it                                                       */
/* ========================================================================== */

describe('D-04 putting one down and picking it up', () => {
  it('picks a conversation up where it was left, never begins it again', () => {
    expect(openingFor('/sessions/talk-3.jsonl')).toEqual({
      kind: 'carry-on',
      path: '/sessions/talk-3.jsonl',
    });
    // And that stays true when the caller is the "start a new one" door.
    expect(openingFor('/sessions/talk-3.jsonl', true)).toEqual({
      kind: 'carry-on',
      path: '/sessions/talk-3.jsonl',
    });
  });

  it('starts one only when there is nothing to pick up and somebody asked', () => {
    expect(openingFor(null, true)).toEqual({ kind: 'fresh' });
    expect(openingFor('   ', true)).toEqual({ kind: 'fresh' });
  });

  it('carries on the most recent when nobody asked for a new one', () => {
    expect(openingFor(null)).toEqual({ kind: 'most-recent' });
    expect(openingFor(undefined)).toEqual({ kind: 'most-recent' });
    expect(openingFor(42)).toEqual({ kind: 'most-recent' });
  });

  it('takes a closed conversation out of the live ones and leaves the rest alone', () => {
    const store = conversations([]);
    const hero = open(store, 'hero', 'hero.jsonl');
    const pricing = open(store, 'pricing', 'pricing.jsonl');

    store.close('hero');

    expect(addressed(store, 'hero', (thread) => thread.file)).toBeNull();
    expect(hero.heard).toEqual(['(put down)']);
    expect(store.open.map((one) => one.path)).toEqual(['pricing']);
    expect(pricing.heard).toEqual([]);
  });

  it('reaches the same conversation again by the file it was written down in', () => {
    const store = conversations([]);
    open(store, 'hero', 'hero.jsonl');
    store.close('hero');

    // What the shelf hands back is the file, and that is what opens it again.
    const again = openingFor('hero.jsonl');
    expect(again).toEqual({ kind: 'carry-on', path: 'hero.jsonl' });

    const reopened = open(store, again.kind === 'carry-on' ? again.path : '', 'hero.jsonl');
    receive(store, saying('Still here.', 'hero.jsonl'));
    expect(reopened.heard).toEqual(['Still here.']);
  });
});
