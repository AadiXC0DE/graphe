/** The panel's bands, in the two places they were worst.
 *
 * Where the project is and what is uncommitted were three stacked bands, so
 * learning one thing meant reading all three. And the goal had four numbers in
 * four places and no band at all: the objective was written to disk, the steps
 * were on the composer, the time was nowhere and the rounds were in the log.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { parseNumstat } from '../src/lib/gitstatus';

/** The band's own wording for the two totals, read out of the panel so the
 *  test and the screen cannot say different things. */
const GIT_LINES = (added: number, removed: number): string | null =>
  added === 0 && removed === 0 ? null : `+${String(added)} \u2212${String(removed)}`;

const panel = readFileSync(
  fileURLToPath(new URL('../src/components/Overview.tsx', import.meta.url)),
  'utf8',
);
const styles = readFileSync(
  fileURLToPath(new URL('../src/components/Overview.css', import.meta.url)),
  'utf8',
);
const progress = readFileSync(
  fileURLToPath(new URL('../src/components/BuildProgress.css', import.meta.url)),
  'utf8',
);

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
    expect(git).not.toContain('gitband__onto');
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
  it('has a row on the shelf, with what is waiting on it', () => {
    const shelf = readFileSync(
      fileURLToPath(new URL('../src/components/Sidebar.tsx', import.meta.url)),
      'utf8',
    );
    // One list for both states now; `tests/sidebar.test.ts` renders it.
    expect(shelf).toContain("on: p.onReviewQueue,");
    expect(shelf).toContain("id: 'review'");
    expect(shelf).toContain('one.count === undefined || one.count === 0 ? null : (');
  });

  it('is fed from the queue rather than from a count kept beside it', () => {
    const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
    expect(app).toContain('reviewsWaiting={waitingToReview(reviewQ)}');
  });
});

describe('the Changes press opens the change', () => {
  it('reads the diff and hands it to the sheet', () => {
    const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
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
    const main = readFileSync(
      fileURLToPath(new URL('../electron/main.ts', import.meta.url)),
      'utf8',
    );
    const at = main.indexOf('async function readGitStatusWithLines(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('if (git === null || !git.dirty) return git;');
    expect(block).toContain("gitRun(cwd, ['diff', '--numstat', 'HEAD'])");
    expect(main).toContain('const git = many ? null : await readGitStatusWithLines(cwd);');
  });
});

describe('the two textures in the thread', () => {
  const line = readFileSync(
    fileURLToPath(new URL('../src/components/ActivityLine.tsx', import.meta.url)),
    'utf8',
  );
  const steps = readFileSync(
    fileURLToPath(new URL('../src/components/Steps.tsx', import.meta.url)),
    'utf8',
  );

  /* Both audiences get the same row shape. Which of the two texts is on it is
     the whole difference. */
  it('leads with the command where "Show me" is on, and keeps the sentence as the tooltip', () => {
    expect(line).toContain("const machinery = lead && real !== undefined && real !== '';");
    expect(line).toContain('title={machinery ? label : undefined}');
    expect(line).toContain('<code className="activity__lead">{real}</code>');
    expect(steps).toContain('lead={showMe}');
  });

  it('never draws the command twice', () => {
    expect(line).toContain("real !== undefined && real !== '' && !machinery ?");
  });

  it('says a step failed in a word rather than a card', () => {
    expect(line).toContain("{state === 'failed' ? <span className=\"activity__failed\">Failed</span> : null}");
  });
});
