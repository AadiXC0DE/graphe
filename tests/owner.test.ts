/** One conversation, one key, one way back out of it.
 *
 * The point of this file is that no path can be written that breaks the round
 * trip — a project folder is allowed to contain anything a filesystem allows.
 */

import { describe, expect, it } from 'vitest';

import { frontKey, isFront, keyOf, ownerOf, sameOwner } from '../src/work/owner';

describe('OW-01 a key round-trips', () => {
  it('gives back the project and address it was made from', () => {
    const key = keyOf('/Users/someone/Desktop/graphe', 'conversation-2');
    expect(ownerOf(key)).toEqual({
      project: '/Users/someone/Desktop/graphe',
      address: 'conversation-2',
    });
  });

  it('round-trips a path with spaces in it', () => {
    const project = '/Users/someone/My Projects/the site';
    expect(ownerOf(keyOf(project, 'a')).project).toBe(project);
  });

  it('round-trips a path with the characters that break naive joins', () => {
    for (const project of [
      '/a:b/c',
      '/a,b/c',
      '/a|b/c',
      '/a\tb/c',
      '/a\nb/c',
      '/a"b"/c',
      "/a'b'/c",
      '/emoji 🎈/c',
      '/dots.../c',
      '/a\\b/c',
    ]) {
      const back = ownerOf(keyOf(project, 'x'));
      expect(back.project).toBe(project);
      expect(back.address).toBe('x');
    }
  });

  it('round-trips an address that looks like a path itself', () => {
    const back = ownerOf(keyOf('/one/two', '/three/four five'));
    expect(back).toEqual({ project: '/one/two', address: '/three/four five' });
  });

  it('is stable — the same pair always gives the same key', () => {
    expect(keyOf('/p', 'a')).toBe(keyOf('/p', 'a'));
  });

  it('keeps two conversations in one project apart', () => {
    expect(keyOf('/p', 'a')).not.toBe(keyOf('/p', 'b'));
  });

  it('keeps the same address in two projects apart', () => {
    expect(keyOf('/one', 'a')).not.toBe(keyOf('/two', 'a'));
  });

  it('cannot be confused by a project ending where an address begins', () => {
    expect(keyOf('/p/a', '')).not.toBe(keyOf('/p', 'a'));
  });
});

describe('OW-02 the front conversation', () => {
  it('has an empty address', () => {
    expect(ownerOf(frontKey('/p'))).toEqual({ project: '/p', address: '' });
  });

  it('is what keyOf with no address makes', () => {
    expect(keyOf('/p', '')).toBe(frontKey('/p'));
  });

  it('is not the same key as any addressed conversation', () => {
    expect(frontKey('/p')).not.toBe(keyOf('/p', 'front'));
  });

  it('is recognisable without parsing by hand', () => {
    expect(isFront(frontKey('/p'))).toBe(true);
    expect(isFront(keyOf('/p', 'a'))).toBe(false);
  });
});

describe('OW-03 odd input still parses', () => {
  it('reads a bare project as the front conversation', () => {
    expect(ownerOf('/p')).toEqual({ project: '/p', address: '' });
  });

  it('reads an empty key without throwing', () => {
    expect(ownerOf('')).toEqual({ project: '', address: '' });
  });

  it('takes an empty project', () => {
    expect(ownerOf(keyOf('', 'a'))).toEqual({ project: '', address: 'a' });
  });

  it('holds a very long path whole', () => {
    const project = `/${'deep/'.repeat(400)}end`;
    expect(ownerOf(keyOf(project, 'a')).project).toBe(project);
  });
});

describe('OW-04 sameOwner', () => {
  it('is true for the same conversation written twice', () => {
    expect(sameOwner({ project: '/p', address: 'a' }, { project: '/p', address: 'a' })).toBe(true);
  });

  it('is false across addresses and across projects', () => {
    expect(sameOwner({ project: '/p', address: 'a' }, { project: '/p', address: 'b' })).toBe(false);
    expect(sameOwner({ project: '/p', address: 'a' }, { project: '/q', address: 'a' })).toBe(false);
  });

  it('does not mistake the front conversation for an addressed one', () => {
    expect(sameOwner(ownerOf(frontKey('/p')), { project: '/p', address: 'front' })).toBe(false);
  });

  it('agrees with the keys themselves', () => {
    const a = ownerOf(keyOf('/p', 'a'));
    const b = ownerOf(keyOf('/p', 'a'));
    expect(sameOwner(a, b)).toBe(keyOf(a.project, a.address) === keyOf(b.project, b.address));
  });
});

describe('OW-05 a key works as a map key', () => {
  it('files and finds one conversation among many', () => {
    const map = new Map<string, number>();
    const pairs: readonly (readonly [string, string])[] = [
      ['/p', ''],
      ['/p', 'a'],
      ['/p', 'b'],
      ['/q', ''],
      ['/q with space', 'a b'],
    ];
    pairs.forEach(([project, address], at) => map.set(keyOf(project, address), at));
    expect(map.size).toBe(pairs.length);
    pairs.forEach(([project, address], at) => {
      expect(map.get(keyOf(project, address))).toBe(at);
    });
  });
});
