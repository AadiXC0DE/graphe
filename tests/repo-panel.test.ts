/** Nothing there, or nothing read.
 *
 * The panel used to be handed an empty list whichever it was: asking github
 * timed out, the empty list came back, and the screen said the project had no
 * pull requests to somebody looking at several. Pressing Refresh asked again,
 * failed again, and drew the same sentence — so there was no way to tell from
 * inside the app that anything had gone wrong, and restarting it was the only
 * thing that ever helped.
 *
 * The distinction is the whole fix, so it is pinned here: an empty list means
 * there are none only when github actually answered.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SAYS } from '../src/components/ReviewsView';

const MAIN = readFileSync(
  fileURLToPath(new URL('../electron/main.ts', import.meta.url)),
  'utf8',
);
const VIEW = readFileSync(
  fileURLToPath(new URL('../src/components/ReviewsView.tsx', import.meta.url)),
  'utf8',
);

describe('a list that could not be read is not an empty list', () => {
  it('never turns a failed reading into an empty one', () => {
    // `?? []` on the answer is exactly what made a failure indistinguishable
    // from a project with nothing in it.
    expect(MAIN).not.toMatch(/\(issues \?\? \[\]\)/);
    expect(MAIN).not.toMatch(/\(prs \?\? \[\]\)/);
  });

  it('carries a reason back with the lists', () => {
    expect(MAIN).toContain('trouble');
    expect(MAIN).toMatch(/!prs\.ok \? prs\.because/);
  });

  it('keeps what github said, rather than dropping it', () => {
    // stderr used to be thrown away here, so a refusal could not be reported.
    const from = MAIN.indexOf('function ghJSON(');
    const body = MAIN.slice(from, MAIN.indexOf('\nconst GH_WORDS', from));
    expect(from).toBeGreaterThan(-1);
    expect(body).not.toContain('stderr.resume()');
    expect(body).toContain("child.stderr.on('data'");
  });

  it('waits long enough for a network call on a busy machine', () => {
    const patience = /GH_PATIENCE_MS = ([\d_]+)/.exec(MAIN);
    expect(patience).not.toBeNull();
    expect(Number((patience?.[1] ?? '0').replace(/_/g, ''))).toBeGreaterThanOrEqual(20_000);
  });
});

describe('the panel says which it is', () => {
  it('has words for a reading that failed, separate from an empty project', () => {
    expect(SAYS.couldNotAsk).toBeTruthy();
    expect(SAYS.couldNotAsk).not.toMatch(/no pull requests|none/i);
    expect(SAYS.empty).toMatch(/no pull requests/i);
  });

  it('shows the reason and offers the press again, rather than a blank', () => {
    expect(VIEW).toContain('repo.trouble === null');
    expect(VIEW).toContain('SAYS.couldNotAsk');
    expect(VIEW).toContain('SAYS.tryAgain');
  });

  it('does not blame the folder when the reading is what failed', () => {
    // "not a github repository" is for a folder that is not one, never for a
    // question github did not answer.
    expect(SAYS.noRepo).toMatch(/not a github repository/i);
    expect(SAYS.couldNotAsk).not.toMatch(/not a github repository/i);
  });
});
