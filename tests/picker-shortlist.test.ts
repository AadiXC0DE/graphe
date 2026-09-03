/** The first screen shows the recent few, not everything remembered. */

import { describe, expect, it } from 'vitest';
import { MOST_SHOWN } from '../src/components/ProjectPicker';
import { MOST_REMEMBERED } from '../src/projects/recents';

describe('the recents list is a shortlist', () => {
  it('shows fewer than the store keeps, so it never needs a scrollbar', () => {
    expect(MOST_SHOWN).toBeLessThan(MOST_REMEMBERED);
    expect(MOST_SHOWN).toBeLessThanOrEqual(5);
  });

  it('renders the slice rather than every project', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../src/components/ProjectPicker.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('projects.slice(0, MOST_SHOWN)');
    expect(source).not.toContain('{projects.map(');
  });

  it('leaves no bounded scroll box behind on the list', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(
      fileURLToPath(new URL('../src/components/ProjectPicker.css', import.meta.url)),
      'utf8',
    );
    expect(css).not.toMatch(/overflow:\s*hidden auto/);
    expect(css).not.toMatch(/max-height:\s*min\(/);
  });
});

/** Which of the two first screens is right depends on whether anything was open
 *  last time, and that answer arrives over the wire. Until it does, the honest
 *  state is "not known" — and the window has to say nothing rather than guess,
 *  because a guess is a screen somebody starts reading and then has taken away.
 *
 *  This only became visible when the shell stopped blocking the launch: the
 *  window now draws well before the first answer comes back. */
describe('the first screen is not guessed at', () => {
  const app = async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    return readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
  };

  it('tells "nothing was open" apart from "nobody has said yet"', async () => {
    // `recent` is null until the answer lands and an array afterwards. Reading
    // null as "none" is the bug: it draws the empty conversation for a moment.
    // The second half is the launch that is already on its way to a folder:
    // the list used to appear, be read, and be taken away a second later.
    expect(await app()).toContain(
      'const undecided = desk === null && (recent === null || openingOnLaunch);',
    );
    expect(await app()).toContain(
      'const picking = desk === null && !openingOnLaunch && recent !== null && recent.length > 0;',
    );
    expect(await app()).toContain('void open(path).finally(() => setOpeningOnLaunch(false));');
  });

  it('draws neither first screen until it knows which', async () => {
    const source = await app();
    expect(source).toContain('undecided ? null : desk === null || desk.turns.length === 0 ?');
    // And no composer under a screen that is not there yet.
    expect(source).toContain('picking || undecided ? null : (');
  });
});
