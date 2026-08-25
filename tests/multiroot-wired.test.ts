/** The several-projects folder, wired end to end.
 *
 *  A folder holding `backend/` and `frontend/` beside each other is not one
 *  repository, and everything that assumed it was has to either stand down or
 *  say where it stands. These read the wiring out of the source the way the
 *  other wired tests do: they are the tripwire that catches somebody removing
 *  the guard while renaming things.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
const CHILDREN = readFileSync(new URL('../electron/childRepos.ts', import.meta.url), 'utf8');
const IPC = readFileSync(new URL('../src/lib/ipc.ts', import.meta.url), 'utf8');
const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
const OVERVIEW = readFileSync(new URL('../src/components/Overview.tsx', import.meta.url), 'utf8');
const ADAPTER = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');

describe('the parent never becomes a repository', () => {
  it('looks for children before any history is opened', () => {
    const at = MAIN.indexOf('async function openTheProject');
    const block = MAIN.slice(at, at + 2200);
    expect(block).toContain('await childRepos(path)');
    expect(block).toContain('children.length < SEVERAL_CHILDREN');
    // The git-init lives inside Timeline.open; for a several-projects folder
    // it must never run.
    expect(block).toContain('timeline = await Timeline.open(path)');
  });

  it('carries the detection on the project, empty for an ordinary folder', () => {
    expect(MAIN).toContain('childRepos: children,');
    expect(MAIN).toContain('timeline: Timeline | null;');
  });

  it('tells the agent where the projects are, since git from the parent lands nowhere', () => {
    const at = MAIN.indexOf('childRepoNotes(held.childRepos)');
    expect(at).toBeGreaterThan(-1);
    const notes = MAIN.slice(MAIN.indexOf('async function childRepoNotes'), at);
    expect(notes).toContain('not a repository');
    expect(notes).toContain('git -C backend status');
    expect(ADAPTER).toContain('appendSystemPrompt: [...options.contextNotes]');
  });
});

describe('what reads and what refuses', () => {
  it('answers the overview per child, with no folder-level branch of its own', () => {
    const start = MAIN.indexOf('handle<Overview>(CHANNEL.overview');
    const block = MAIN.slice(start, start + 1700);
    expect(block).toContain('repos');
    expect(block).toContain('readRepoOverview');
  });

  it('marks changed files under their project name', () => {
    const start = MAIN.indexOf('handle<readonly FileEntry[]>(CHANNEL.projectFiles');
    const block = MAIN.slice(start, MAIN.indexOf("handle<{ looks: readonly Look[]"));
    expect(block).toContain('changedAcross(');
    expect(CHILDREN).toContain('${one.rel}/${file.path}');
  });

  it('refuses the verbs that need one repository, in the same words everywhere', () => {
    const refusals = [
      'CHANNEL.designCommit',
      'CHANNEL.putBack',
      'CHANNEL.nameVersion',
      'CHANNEL.saveVersion',
      'CHANNEL.handToDeveloper',
      'CHANNEL.putOnline',
      'CHANNEL.branchSwitch',
      'CHANNEL.branchCreate',
      'CHANNEL.worktreeLand',
      'CHANNEL.show',
    ];
    for (const channel of refusals) {
      const at = channel === 'CHANNEL.show' ? MAIN.indexOf('handle<ShowOutcome>(CHANNEL.show') : MAIN.indexOf(channel);
      expect(at, channel).toBeGreaterThan(-1);
      const window = MAIN.slice(at, at + 1500);
      expect(window, `${channel} never answers for several projects`).toContain(
        'return fail(SEVERAL_PROJECTS)',
      );
    }
  });
});

describe('the window hears about the projects', () => {
  it('carries them as an optional field nothing old can trip on', () => {
    expect(IPC).toContain('repos?: readonly RepoOverview[]');
    expect(IPC).toContain('repo?: string');
  });

  it('shows where each project stands instead of branch controls', () => {
    expect(OVERVIEW).toContain('view.repos.length >= 2');
    expect(OVERVIEW).toContain('SEVERAL.heading');
  });

  it('waits on the preview pill, and says why', () => {
    expect(APP).toContain('severalProjects');
    expect(APP).toContain('Open one directly to see it running.');
  });
});
