// @vitest-environment jsdom
/** The panel's bands, in the two places they were worst.
 *
 * Where the project is and what is uncommitted were three stacked bands, so
 * learning one thing meant reading all three. And the goal had four numbers in
 * four places and no band at all: the objective was written to disk, the steps
 * were on the composer, the time was nowhere and the rounds were in the log.
 *
 *  Source text, not behaviour: the panel's markup, the App's review-queue and diff wiring, the shell's line reading and two stylesheets; no behavioural test can reach it — nothing renders the panel, jsdom never applies a stylesheet, and the shell only runs under Electron.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ReactElement, act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import ActivityLine from '../src/components/ActivityLine';
import Steps from '../src/components/Steps';
import type { StepTurn } from '../src/lib/steps';
import { parseNumstat } from '../src/lib/gitstatus';

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

/** A component as it really draws. */
async function draw(element: ReactElement): Promise<HTMLElement> {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(element);
  });
  return host;
}

/** The press. */
async function press(where: HTMLElement, selector: string): Promise<void> {
  const button = where.querySelector<HTMLElement>(selector);
  expect(button, `no ${selector}`).toBeDefined();
  await act(async () => button?.click());
}

/** The band's own wording for the two totals, read out of the panel so the
 *  test and the screen cannot say different things. */
const GIT_LINES = (added: number, removed: number): string | null =>
  added === 0 && removed === 0 ? null : `+${String(added)} \u2212${String(removed)}`;

const panel = read('src/components/Overview.tsx');
const styles = read('src/components/Overview.css');
const progress = read('src/components/BuildProgress.css');

/** One band's markup, from its heading to the end of its section. */
function band(heading: string): string {
  const at = panel.indexOf(`{${heading}.heading}`);
  expect(at, `no ${heading} band`).toBeGreaterThan(-1);
  return panel.slice(at, panel.indexOf('</section>', at));
}

describe('the Git band', () => {
  it('is one band rather than three', () => {
    // Branch, origin and commit each had a heading of their own.
    expect(panel).toContain('{GIT.heading}');
    expect(panel.split('{ORIGIN.heading}')).toHaveLength(1);
  });

  it('holds the branch, the fetch and what is uncommitted', () => {
    const git = band('GIT');
    expect(git).toContain('<Lines');
    expect(git).toContain('gitband__act');
    expect(git).toContain('{GIT.files(changedCount)}');
    expect(git).toContain('{COMMITTING.heading}');
  });

  /* A button is one line and its label is at most three words. The branch name
     is already in the chip above; in the button it made both rows two lines
     tall on any branch longer than about twelve characters. */
  it('keeps the branch name out of the button', () => {
    const git = band('GIT');
    expect(git).toContain('title={COMMITTING.what(git.branch)}');
  });

  it('makes what changed a press rather than a number', () => {
    expect(band('GIT')).toContain('onClick={() => onOpenChanges?.()}');
  });

  it('says so plainly when nothing is uncommitted, rather than drawing a press', () => {
    const git = band('GIT');
    expect(git).toContain('{GIT.nothing}');
    expect(git.indexOf('{GIT.nothing}')).toBeLessThan(git.indexOf('gitband__changes'));
  });

  /* Three counts summed counted a file that is both staged and modified twice. */
  it('counts paths rather than adding three numbers up', () => {
    expect(panel).toContain('const changedCount = git === null ? 0 : git.changedPaths;');
  });

  it('still says where the branch stands against origin', () => {
    expect(band('GIT')).toContain('saysStanding(standingOf(git))');
  });

  it('keeps the commit press for a folder holding several projects', () => {
    expect(panel).toContain('{git !== null && several && changedCount > 0 ? (');
  });
});

describe('the Goal band', () => {
  it('says the objective, a status word and one line of numbers', () => {
    const goal = band('GOAL');
    expect(goal).toContain('{view.goal.objective}');
    expect(goal).toContain('GOAL.states[view.goal.status]');
    expect(goal).toContain('GOAL.line(');
  });

  it('is not drawn at all when nobody set one', () => {
    expect(panel).toContain('{view.goal == null ? null : (');
  });

  it('says the state in a word, so the panel can be read out loud', () => {
    expect(panel).toContain("states: { active: 'Working', paused: 'Paused', done: 'Complete' }");
    expect(styles).toContain('.goalband__state {');
  });
});

describe('the checklist', () => {
  it('strikes a step through once it is done', () => {
    expect(progress).toContain('.buildprogress__row--done .buildprogress__title,');
    expect(progress).toContain('text-decoration: line-through;');
  });
});

describe('the two ways into the review queue', () => {
  it('is fed from the queue rather than from a count kept beside it', () => {
    const app = read('src/App.tsx');
    expect(app).toContain('reviewsWaiting={waitingToReview(reviewQ)}');
  });
});

describe('the Changes press opens the change', () => {
  it('reads the diff and hands it to the sheet', () => {
    const app = read('src/App.tsx');
    const at = app.indexOf('onOpenChanges={() => {');
    expect(at).toBeGreaterThan(-1);
    const block = app.slice(at, app.indexOf('}}', app.indexOf('bridge.changesLook', at)));
    expect(block).toContain('setChangesOpen(true)');
    expect(block).toContain('bridge.changesLook(');
    expect(block).toContain('setChangeText(answer.value)');
  });
});

describe('what changed, in lines', () => {
  it('adds them up from git’s own numstat, binaries counted as files', () => {
    expect(parseNumstat('12\t3\tsrc/a.ts\n0\t7\tsrc/b.ts\n')).toEqual({ added: 12, removed: 10 });
    expect(parseNumstat('-\t-\tone.png\n')).toEqual({ added: 0, removed: 0 });
  });

  it('says nothing at all for a folder with only untracked files in it', () => {
    expect(parseNumstat('')).toEqual({ added: 0, removed: 0 });
    expect(GIT_LINES(0, 0)).toBeNull();
  });

  it('is read only when there is something to read', () => {
    const main = read('electron/main.ts');
    const at = main.indexOf('async function readGitStatusWithLines(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('if (git === null || !git.dirty) return git;');
    expect(block).toContain("gitRun(cwd, ['diff', '--numstat', 'HEAD'])");
    expect(main).toContain('const git = many ? null : await readGitStatusWithLines(cwd);');
  });
});

describe('the two textures in the thread', () => {
  /** One step of a run, with the command behind it recorded the way the
   *  conversation records it. */
  const A_STEP: StepTurn = {
    kind: 'did',
    id: 'c1',
    callId: 'k1',
    state: 'done',
    label: 'Reading hero.css',
    real: 'sed -n 1,40p src/hero.css',
  };

  /* Both audiences get the same row shape. Which of the two texts is on it is
     the whole difference. */
  it('leads with the command where "Show me" is on, and keeps the sentence as the tooltip', async () => {
    const line = await draw(
      createElement(ActivityLine, { state: 'done', label: A_STEP.label, real: A_STEP.real, lead: true }),
    );
    expect(line.querySelector('.activity__lead')?.textContent).toBe(A_STEP.real);
    expect(line.querySelector('.activity')?.getAttribute('title')).toBe(A_STEP.label);
    expect(line.querySelector('.activity__label')).toBeNull();

    // And the steps row is what hands "Show me" down to it: closed, the head
    // carries no command; opened, every step does.
    const run = await draw(createElement(Steps, { steps: [A_STEP], showMe: true }));
    await press(run, '.steps__head');
    const step = run.querySelector('.steps__list .activity');
    expect(step?.querySelector('.activity__lead')?.textContent).toBe(A_STEP.real);
    expect(step?.getAttribute('title')).toBe(A_STEP.label);
  });

  it('never draws the command twice', async () => {
    // Off, the command hangs under the sentence that already said what happened.
    const quiet = await draw(
      createElement(ActivityLine, { state: 'done', label: A_STEP.label, real: A_STEP.real }),
    );
    expect(quiet.querySelector('.activity__real')?.textContent).toBe(A_STEP.real);
    expect(quiet.querySelector('.activity__lead')).toBeNull();

    // On, it is the line, and the sentence is behind it: one command, once.
    const leading = await draw(
      createElement(ActivityLine, { state: 'done', label: A_STEP.label, real: A_STEP.real, lead: true }),
    );
    expect(leading.querySelectorAll('code')).toHaveLength(1);
    expect(leading.querySelector('.activity__real')).toBeNull();
  });

  /* "Failed" reads as the app announcing a disaster; a command that exited
     non-zero is usually the ordinary business of an afternoon. The row already
     names what was run, so the word only has to say how it went. */
  it('says a step failed in a word rather than a card, and calmly', async () => {
    const failed = await draw(createElement(ActivityLine, { state: 'failed', label: A_STEP.label }));
    expect(failed.querySelector('.activity')?.className).toContain('activity--failed');
    expect(failed.querySelector('.activity__failed')?.textContent).toBe('Did not work');
  });
});
