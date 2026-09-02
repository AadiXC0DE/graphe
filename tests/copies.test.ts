/** Where a copy of a project lives, decided once.
 *
 * Three kinds of copy each worked out their own name for one, and two of them
 * flattened every awkward character to a dash — which maps `/x/a-b`, `/x/a.b`
 * and `/x/a b` onto one folder. Two projects sharing a root is one
 * conversation's checkout landing on another's, and clearing one project's
 * copies taking another's with it.
 */

import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { copiesFolder, copyFolder, keyFor, scratchFolder } from '../src/work/copies';

const base = '/data';

describe('the one name a project is filed under', () => {
  /* The failure this exists for. */
  it('tells apart paths that flatten to the same dashes', () => {
    const same = ['/x/a-b', '/x/a.b', '/x/a b', '/x/a_b'];
    expect(new Set(same.map(keyFor)).size).toBe(same.length);
  });

  it('tells apart folders of the same name in different places', () => {
    expect(keyFor('/one/site')).not.toBe(keyFor('/another/site'));
  });

  it('is the same answer every time it is asked', () => {
    expect(keyFor('/work/my site')).toBe(keyFor('/work/my site'));
  });

  /* A symlink and its target are one project, not two, or work carried out of
     one would be invisible from the other. */
  it('reads through a relative path to the same answer', () => {
    expect(keyFor('/work/site')).toBe(keyFor('/work/here/../site'));
  });

  it('stays readable, so somebody opening the folder can tell what it is', () => {
    expect(keyFor('/work/my-site')).toMatch(/^my-site-[0-9a-f]{8}$/);
  });

  it('has something to say about a folder with no usable name at all', () => {
    expect(keyFor('/work/....')).toMatch(/^project-[0-9a-f]{8}$/);
  });
});

describe('where the copies go', () => {
  it('keeps each kind apart, so clearing one never reaches another', () => {
    const project = '/work/site';
    const kinds = ['worktrees', 'copies', 'kept-aside', 'builders', 'builds'] as const;
    const all = kinds.map((kind) => copiesFolder(base, kind, project));
    expect(new Set(all).size).toBe(kinds.length);
    for (const [at, kind] of kinds.entries()) {
      expect(all[at]).toBe(join(base, kind, keyFor(project)));
    }
  });

  it('gives each copy its own folder inside its project’s', () => {
    const one = copyFolder(base, 'worktrees', '/work/site', 'conversation-1');
    const other = copyFolder(base, 'worktrees', '/work/site', 'conversation-2');
    expect(one).not.toBe(other);
    expect(one.startsWith(copiesFolder(base, 'worktrees', '/work/site'))).toBe(true);
  });

  /* Anything under the system's temp folder sits beside every other program's
     scratch, so it has to say whose it is. */
  it('says whose scratch it is when it is in a folder shared with the machine', () => {
    const one = scratchFolder('/tmp', '/work/site', 'call-1');
    expect(one).toContain('graphe-builders');
    expect(one).toContain(keyFor('/work/site'));
    expect(one.startsWith('/work/')).toBe(false);
  });

  it('never lets a copy’s own name climb out of the folder it belongs in', () => {
    const escaped = copyFolder(base, 'builders', '/work/site', '../../../etc');
    expect(escaped.startsWith(copiesFolder(base, 'builders', '/work/site'))).toBe(true);
    expect(escaped).not.toContain('..');
    expect(scratchFolder('/tmp', '/work/site', '../../etc')).not.toContain('..');
  });
});
