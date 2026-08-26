/** Whether a project's browser keeps what it is signed in to.
 *
 *  Off where nobody has said, and off for a folder that is not open — the
 *  reading has to agree in the window and in the shell, so both read it here.
 */

import { describe, expect, it } from 'vitest';

import { keepsLogins } from '../src/projects/logins';

describe('staying signed in', () => {
  it('is off until somebody turns it on for that project', () => {
    expect(keepsLogins({}, '/Users/mira/Projects/shop')).toBe(false);
    expect(keepsLogins({ '/Users/mira/Projects/shop': true }, '/Users/mira/Projects/shop')).toBe(true);
    expect(keepsLogins({ '/Users/mira/Projects/shop': false }, '/Users/mira/Projects/shop')).toBe(false);
  });

  it("is one project’s answer and never another’s", () => {
    const kept = { '/Users/mira/Projects/shop': true };
    expect(keepsLogins(kept, '/Users/mira/Projects/site')).toBe(false);
  });

  it('is off where there is no project at all', () => {
    for (const nowhere of [null, undefined, '']) {
      expect(keepsLogins({ '/a': true }, nowhere)).toBe(false);
    }
  });
});
