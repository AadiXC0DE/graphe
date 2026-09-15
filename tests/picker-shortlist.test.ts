// @vitest-environment jsdom
/** The first screen shows the recent few, not everything remembered.
 *
 *  Source text, not behaviour: the App's undecided and picking branches, and the list's own height; no behavioural test can reach it — nothing renders `App`, and jsdom never applies a stylesheet.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ProjectPicker, { MOST_SHOWN } from '../src/components/ProjectPicker';
import type { RecentProject } from '../src/lib/ipc';
import { MOST_REMEMBERED } from '../src/projects/recents';

/** Read from the root: this file runs under jsdom, where `import.meta.url` is
 *  not a file URL. */
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

/** `act` only runs when this is set, and jsdom here does not set it. */
const reactGlobals = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeAll(() => {
  reactGlobals.IS_REACT_ACT_ENVIRONMENT = true;
});

/** A folder remembered once, in the order the picker is given them. */
function remembered(name: string, at: number): RecentProject {
  return {
    path: `/w/${name}`,
    name,
    lastOpenedAt: at,
    lastSpend: null,
    missing: false,
    branch: 'main',
  };
}

/** The picker as it really draws. */
async function draw(projects: readonly RecentProject[]): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(
      createElement(ProjectPicker, {
        projects,
        onOpen: () => undefined,
        onForget: () => undefined,
        onBrowse: () => undefined,
      }),
    );
  });
  return host;
}

describe('the recents list is a shortlist', () => {
  it('shows fewer than the store keeps, so it never needs a scrollbar', () => {
    expect(MOST_SHOWN).toBeLessThan(MOST_REMEMBERED);
    expect(MOST_SHOWN).toBeLessThanOrEqual(5);
  });

  it('renders the slice rather than every project', async () => {
    const many = Array.from({ length: MOST_REMEMBERED }, (_, at) => remembered(`project-${String(at)}`, at));
    expect(many.length).toBeGreaterThan(MOST_SHOWN);
    const host = await draw(many);
    expect([...host.querySelectorAll('.pickerrow__name')].map((one) => one.textContent)).toEqual(
      many.slice(0, MOST_SHOWN).map((one) => one.name),
    );
  });

  it('leaves no bounded scroll box behind on the list', () => {
    const css = read('src/components/ProjectPicker.css');
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
  const app = (): string => read('src/App.tsx');

  it('tells "nothing was open" apart from "nobody has said yet"', () => {
    // `recent` is null until the answer lands and an array afterwards. Reading
    // null as "none" is the bug: it draws the empty conversation for a moment.
    // The second half is the launch that is already on its way to a folder:
    // the list used to appear, be read, and be taken away a second later.
    expect(app()).toContain(
      'const undecided = desk === null && (recent === null || openingOnLaunch);',
    );
    expect(app()).toContain(
      'const picking = desk === null && !openingOnLaunch && recent !== null && recent.length > 0;',
    );
    expect(app()).toContain('void open(path).finally(() => setOpeningOnLaunch(false));');
  });

  it('draws neither first screen until it knows which', () => {
    const source = app();
    expect(source).toContain('undecided ? null : desk === null || desk.turns.length === 0 ?');
    // And no composer under a screen that is not there yet.
    expect(source).toContain('picking || undecided ? null : (');
  });
});
