// @vitest-environment jsdom
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
 *
 *  Source text, not behaviour: the shell's own github reads — no failure becoming an empty list, a reason travelling with the lists, the PATH a Finder-launched app gets; no behavioural test can reach them — electron/main.ts cannot be imported.
 */

import { readFileSync } from 'node:fs';

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ReviewsView, { SAYS } from '../src/components/ReviewsView';
import type { RepoLook } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = '';
});

type Props = Parameters<typeof ReviewsView>[0];

/** The panel, drawn, with whatever github said about this folder. */
function draw(repo: RepoLook): Props {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.push(root);
  const props: Props = {
    repo,
    busy: false,
    onRefresh: vi.fn(),
    onClose: vi.fn(),
    onReview: vi.fn(),
  };
  act(() => root.render(createElement(ReviewsView, props)));
  return props;
}

// Read from the working directory: this file runs under jsdom, where
// `import.meta.url` is not a file URL.
const MAIN = readFileSync(`${process.cwd()}/electron/main.ts`, 'utf8');

describe('a list that could not be read is not an empty list', () => {
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
    const trouble = 'github did not answer in time.';
    const props = draw({
      full: 'mira/site',
      owner: 'mira',
      name: 'site',
      url: 'https://github.com/mira/site',
      issues: [],
      prs: [],
      here: null,
      trouble,
    });

    const panel = document.body.textContent ?? '';
    expect(panel).toContain(SAYS.couldNotAsk);
    expect(panel).toContain(trouble);
    // An empty list that could not be read is not "there are none".
    expect(panel).not.toContain(SAYS.empty);

    const again = [...document.body.querySelectorAll('button')].find(
      (one) => one.textContent?.trim() === SAYS.tryAgain,
    );
    expect(again, 'no way to ask again').toBeDefined();
    act(() => again?.click());
    expect(props.onRefresh).toHaveBeenCalled();
  });

  it('does not blame the folder when the reading is what failed', () => {
    // "not a github repository" is for a folder that is not one, never for a
    // question github did not answer.
    expect(SAYS.noRepo).toMatch(/not a github repository/i);
    expect(SAYS.couldNotAsk).not.toMatch(/not a github repository/i);
  });
});

describe('the tools an app opened from the dock has to find', () => {
  const WIDEN = MAIN.slice(MAIN.indexOf('function widenPath('), MAIN.indexOf('widenPath();'));

  it('adds where things are actually installed, without asking anything first', () => {
    // A Finder-launched app inherits /usr/bin:/bin:/usr/sbin:/sbin, which has
    // git and almost nothing else. gh lives in Homebrew.
    expect(WIDEN).toContain('/opt/homebrew/bin');
    expect(WIDEN).toContain('/usr/local/bin');
    // Before the shell is asked, so a shell that never answers cannot take the
    // common case down with it.
    expect(WIDEN.indexOf('add(known)')).toBeLessThan(WIDEN.indexOf('execFileAsync'));
  });

  it('does not give up on everything when the shell does not answer', () => {
    // The old shape: one probe, and `return` on an empty answer, which left
    // PATH narrow and gh unstartable until a launch where the timer won.
    const afterProbe = WIDEN.slice(WIDEN.indexOf('execFileAsync'));
    expect(afterProbe).toContain('add(found.split');
    expect(WIDEN).not.toMatch(/timeout:\s*4000/);
  });

  it('sends the question rather than sitting on the import line waiting for it', () => {
    // An interactive login shell sources the file people keep nvm and starship
    // in — a second or more, spent before the window has been asked for. It was
    // spawnSync here, so every launch paid it up front.
    expect(WIDEN).not.toContain('spawnSync');
    expect(WIDEN).toContain('asking = ask(');
  });

  it('waits on the cheap question and lets the dear one land late', () => {
    // -lc reads .zprofile in about a sixth of a second; -lic also reads .zshrc
    // and takes a second and a half. Waiting on the second one makes every
    // press of the first second of the app pay for it.
    expect(WIDEN).toContain("asking = ask(['-lc'])");
    expect(WIDEN).toContain("void ask(['-lic'])");
  });

  it('makes whoever starts a program by name wait for the answer instead', () => {
    // Every press arrives through the one wrapper, and work picked up from last
    // time does not arrive through it at all — so both say so.
    const wrapper = MAIN.slice(MAIN.indexOf('function handle<T>('), MAIN.indexOf('function handle<T>(') + 700);
    expect(wrapper).toContain('await pathIsWide()');
    expect(MAIN).toMatch(/await pathIsWide\(\);\n\s*await pickUpWhereWeLeftOff/);
  });

  it('says what to do when github cannot be started', () => {
    expect(MAIN).toMatch(/could not start the github command/);
    expect(MAIN).toMatch(/installed and logged in/);
  });
});
