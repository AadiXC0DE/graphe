/** The command palette: what a typed word finds, and in what order.
 *
 * The failure this guards against is a palette that makes somebody read it.
 * Type three letters of a name and that name has to be first — if the ranking
 * ever flattens, the list still looks right and is useless, because the thing
 * you asked for is fourth. The rest guards the other quiet failure: an action
 * that cannot run right now disappearing instead of saying why.
 */

import { describe, expect, it } from 'vitest';

import { KEY_WORDS, grouped, isReady, matches, type Command } from '../src/lib/commands';

const command = (id: string, name: string, where?: string, rest: Partial<Command> = {}): Command => ({
  id,
  name,
  where,
  run: () => {},
  ...rest,
});

/* ========================================================================== */
/* CP-01 the order things come back in                                         */
/* ========================================================================== */

describe('CP-01 the best answer first', () => {
  /* The three ways people search, in the order they expect them answered. */
  const three = [
    command('loose', 'Bring in a picture'), // holds b, r, a in order
    command('word', 'New branch'), // a word starts with it
    command('prefix', 'Branch from here'), // the name starts with it
  ];

  it('puts the name that starts with what was typed above one where a word does', () => {
    expect(matches(three, 'bra').map((one) => one.id)).toEqual(['prefix', 'word', 'loose']);
  });

  it('still finds a name when only the letters are there, in order', () => {
    expect(matches(three, 'bri').map((one) => one.id)).toEqual(['loose']);
  });

  /* Abbreviating by initials is how people type a two-word name they know. */
  it('answers to the initials of a name', () => {
    const found = matches([command('copy', 'Copy path'), command('open', 'Open a folder')], 'cp');
    expect(found.map((one) => one.id)).toEqual(['copy']);
  });

  it('leaves out what does not match at all', () => {
    expect(matches(three, 'zzz')).toEqual([]);
  });

  /* Two commands that match equally well have to come back in the same order
     every keystroke, or the list reshuffles under the hand about to click it. */
  it('settles an even match by the order they were registered', () => {
    const same = [command('first', 'Rename it'), command('second', 'Rename this')];
    expect(matches(same, 'rename').map((one) => one.id)).toEqual(['first', 'second']);
    expect(matches(same, 'rename')).toEqual(matches(same, 'rename'));
  });

  it('is the whole list, in its own order, when nothing has been typed', () => {
    expect(matches(three, '').map((one) => one.id)).toEqual(['loose', 'word', 'prefix']);
    expect(matches(three, '   ').map((one) => one.id)).toEqual(['loose', 'word', 'prefix']);
  });

  it('has an answer for a palette with nothing in it', () => {
    expect(matches([], 'anything')).toEqual([]);
  });
});

/* ========================================================================== */
/* CP-02 the band a command sits under                                         */
/* ========================================================================== */

describe('CP-02 typing the band instead of the name', () => {
  const list = [
    command('rename', 'Rename', 'Conversation'),
    command('open', 'Open a folder', 'Project'),
  ];

  it('finds a command by the band it sits under', () => {
    expect(matches(list, 'project').map((one) => one.id)).toEqual(['open']);
  });

  /* The name is what somebody meant; the band is a fallback. A command whose
     band matches must never outrank one whose name does. */
  it('never lets a band beat a name', () => {
    const both = [command('band', 'Rename', 'Open questions'), command('name', 'Open a folder', 'Project')];
    expect(matches(both, 'open').map((one) => one.id)).toEqual(['name', 'band']);
  });
});

/* ========================================================================== */
/* CP-03 an action that cannot run yet                                         */
/* ========================================================================== */

describe('CP-03 saying no out loud', () => {
  const list = [
    command('ready', 'Save the work'),
    command('waiting', 'Review the change', 'Project', {
      ready: false,
      whyNot: 'Nothing has changed yet.',
    }),
  ];

  /* A disabled action that vanishes reads as a missing feature. It stays, and
     it carries the reason with it. */
  it('keeps an unrunnable command in the list, with its reason', () => {
    const found = matches(list, 'review');
    expect(found.map((one) => one.id)).toEqual(['waiting']);
    const waiting = found[0];
    expect(waiting?.whyNot).toBe('Nothing has changed yet.');
    expect(waiting !== undefined && isReady(waiting)).toBe(false);
  });

  it('takes a command at its word only when it says it is not ready', () => {
    expect(isReady(command('a', 'A'))).toBe(true);
    expect(isReady(command('b', 'B', undefined, { ready: true }))).toBe(true);
    expect(isReady(command('c', 'C', undefined, { ready: false }))).toBe(false);
  });
});

/* ========================================================================== */
/* CP-04 the bands                                                             */
/* ========================================================================== */

describe('CP-04 how the list is cut up', () => {
  it('keeps the bands and their contents in the order they came in', () => {
    const bands = grouped([
      command('a', 'A', 'Conversation'),
      command('b', 'B', 'Project'),
      command('c', 'C', 'Conversation'),
    ]);
    expect(bands.map((one) => one.where)).toEqual(['Conversation', 'Project']);
    expect(bands[0]?.commands.map((one) => one.id)).toEqual(['a', 'c']);
  });

  it('has somewhere to put a command that belongs to no band', () => {
    const bands = grouped([command('a', 'A'), command('b', 'B', 'Project')]);
    expect(bands.map((one) => one.where)).toEqual([KEY_WORDS.ungrouped, 'Project']);
  });

  it('has an answer for nothing at all', () => {
    expect(grouped([])).toEqual([]);
  });
});

/* ========================================================================== */
/* CP-05 the words                                                             */
/* ========================================================================== */

describe('CP-05 what it says', () => {
  it('has a sentence for every state the palette can be in', () => {
    for (const said of Object.values(KEY_WORDS)) expect(said.length).toBeGreaterThan(0);
  });

  /* Plain words only: nothing in this list is a term somebody has to be told. */
  it('names nothing after the machinery', () => {
    const all = Object.values(KEY_WORDS).join(' ').toLowerCase();
    for (const word of ['command palette', 'query', 'filter', 'registry']) {
      expect(all).not.toContain(word);
    }
  });
});
