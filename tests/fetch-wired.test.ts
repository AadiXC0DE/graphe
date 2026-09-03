/** The panel's way to origin.
 *
 * The sentences are the feature: "up to date" is a real answer and has to be
 * said, and a refusal has to say which of the two reasons it was — a dirty tree
 * or a divergence — because the next move is different for each.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { saysFound, saysStanding } from '../src/components/Overview';
import type { Fetched } from '../src/lib/ipc';

const MAIN = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const APP = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const BRIDGE = readFileSync(fileURLToPath(new URL('../src/lib/bridge.ts', import.meta.url)), 'utf8');
const OVERVIEW = readFileSync(
  fileURLToPath(new URL('../src/components/Overview.tsx', import.meta.url)),
  'utf8',
);

function stands(over: Partial<Fetched>): Fetched {
  return {
    branch: 'main',
    upstream: 'origin/main',
    ahead: 0,
    behind: 0,
    dirty: false,
    moved: 0,
    state: 'up-to-date',
    ...over,
  };
}

describe('the panel says what the fetch found', () => {
  it('says up to date, which is an answer and not silence', () => {
    expect(saysStanding(stands({}))).toBe('Up to date with origin/main.');
  });

  it('counts, and counts one commit as one commit', () => {
    expect(saysStanding(stands({ state: 'behind', behind: 3 }))).toBe('3 commits behind origin/main.');
    expect(saysStanding(stands({ state: 'behind', behind: 1 }))).toBe('1 commit behind origin/main.');
    expect(saysStanding(stands({ state: 'ahead', ahead: 2 }))).toContain('2 commits ahead of origin/main');
  });

  it('leaves a divergence to the person, in those words', () => {
    const said = saysStanding(stands({ state: 'diverged', ahead: 2, behind: 1 }));
    expect(said).toContain('Diverged from origin/main');
    expect(said).toContain('merge or a rebase is yours to make');
  });

  it('says why nothing moved when the tree is dirty', () => {
    const said = saysFound(stands({ state: 'behind', behind: 2, dirty: true }));
    expect(said).toContain('2 commits behind origin/main');
    expect(said).toContain('Uncommitted changes here, so nothing has moved');
  });

  it('reports a fast-forward as what it took in', () => {
    expect(saysFound(stands({ moved: 4 }))).toBe('Fast-forwarded main to origin/main, 4 commits in.');
  });

  it('treats no remote, no upstream and a detached HEAD as ordinary days', () => {
    expect(saysStanding(stands({ state: 'no-remote', upstream: null }))).toContain('No remote named origin');
    expect(saysStanding(stands({ state: 'no-upstream', upstream: null, branch: 'side' }))).toBe(
      'side tracks nothing on origin.',
    );
    expect(saysStanding(stands({ state: 'detached', branch: null, upstream: null }))).toContain(
      'Detached HEAD',
    );
  });
});

describe('the press reaches the project it came from', () => {
  it('names both operations as themselves, and neither as the other', () => {
    expect(OVERVIEW).toContain("fetch: 'Fetch'");
    expect(OVERVIEW).toContain("forward: 'Fast-forward'");
  });

  it('only offers the fast-forward where it can lose nothing', () => {
    const at = OVERVIEW.indexOf('function canFastForward');
    expect(at).toBeGreaterThan(-1);
    expect(OVERVIEW.slice(at, at + 220)).toContain("found.state === 'behind' && !found.dirty");
  });

  it('says it is working while the press is away', () => {
    expect(OVERVIEW).toContain("fetching: 'Fetching…'");
    expect(OVERVIEW).toContain("forwarding: 'Fast-forwarding…'");
    expect(OVERVIEW).toContain("aria-busy={working === ''}");
    expect(OVERVIEW).toContain('aria-busy={working === one.name}');
  });

  it('carries the named project through the window', () => {
    expect(APP).toContain('onFetch={(repo) => fromOrigin((where) => bridge.fetchOrigin(where), repo)}');
    expect(APP).toContain(
      'onFastForward={(repo) => fromOrigin((where) => bridge.fastForward(where), repo)}',
    );
    expect(BRIDGE).toContain('fetchOrigin: (where) => api.fetchOrigin(where)');
    expect(BRIDGE).toContain('fastForward: (where) => api.fastForward(where)');
  });

  it('runs git through the timeline layer, in the folder the call names', () => {
    for (const channel of ['CHANNEL.fetchOrigin', 'CHANNEL.fastForward']) {
      const at = MAIN.indexOf(`handle<Fetched>(${channel}`);
      expect(at, channel).toBeGreaterThan(-1);
      const block = MAIN.slice(at, at + 1200);
      expect(block, channel).toContain('await timelineFor(open, where)');
      expect(block, channel).toContain('return fail(SEVERAL_PROJECTS)');
      expect(block, channel).toContain('new ProjectHistory(folderFor(open, where))');
      expect(block, channel).toContain('historyTrouble(cause)');
    }
  });

  it('will not fast-forward under files that are still being written', () => {
    const at = MAIN.indexOf('handle<Fetched>(CHANNEL.fastForward');
    expect(MAIN.slice(at, at + 1200)).toContain('stillWriting(open.held)');
  });
});
