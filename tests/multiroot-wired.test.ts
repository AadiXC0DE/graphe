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
const PRELOAD = readFileSync(new URL('../electron/preload.ts', import.meta.url), 'utf8');

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
    expect(ADAPTER).toContain('appendSystemPrompt');
    expect(ADAPTER).toContain('options.contextNotes');
    expect(ADAPTER).toContain('agentsMdNote');
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

  it('resolves the folder a call means, without any path arithmetic to get wrong', () => {
    const at = MAIN.indexOf('function childRepoFor');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, MAIN.indexOf('async function timelineFor'));
    // Matched against what was found on disk. A name off the wire can only ever
    // be one of the projects already there.
    expect(block).toContain('childNamed(open.held.childRepos, where.repo)');
    expect(block).toContain('checkoutEntryFor(open, where)?.folder ?? childRepoFor(open, where)?.path ?? open.path');
  });

  it('keeps each project’s saved work its own, opened once and remembered', () => {
    const at = MAIN.indexOf('async function timelineFor');
    const block = MAIN.slice(at, at + 900);
    expect(block).toContain('open.held.childTimelines.get(child.path)');
    expect(block).toContain('open.held.childTimelines.set(child.path, made)');
    // The promise, so two calls at once share one opening rather than racing.
    expect(MAIN).toContain('childTimelines: Map<string, Promise<Timeline>>;');
    expect(MAIN).toContain('childTimelines: new Map(),');
  });

  it('answers each verb for the project the call names', () => {
    for (const channel of ['CHANNEL.putBack', 'CHANNEL.nameVersion', 'CHANNEL.saveVersion', 'CHANNEL.designCommit']) {
      const at = MAIN.indexOf(`handle<`, MAIN.indexOf(channel) - 200);
      const block = MAIN.slice(MAIN.indexOf(channel), MAIN.indexOf(channel) + 1500);
      expect(at, channel).toBeGreaterThan(-1);
      expect(block, channel).toContain('await timelineFor(open, where)');
    }
    for (const channel of ['CHANNEL.branchSwitch', 'CHANNEL.branchCreate']) {
      const block = MAIN.slice(MAIN.indexOf(`handle<null>(${channel}`), MAIN.indexOf(`handle<null>(${channel}`) + 1500);
      expect(block, channel).toContain('folderFor(open, where)');
      expect(block, channel).toContain('timelineFor(open, where)');
    }
    for (const marker of ['handle<ShowOutcome>(CHANNEL.show', 'handle<HandedOver>(CHANNEL.handToDeveloper', 'handle<WentOnline>(CHANNEL.putOnline']) {
      const block = MAIN.slice(MAIN.indexOf(marker), MAIN.indexOf(marker) + 1200);
      expect(block, marker).toContain('folderFor(open, where)');
    }
  });

  /** The timeline was per project and the folder was not, so saving the design
   *  view read one project's stylesheets and wrote into the folder above it. */
  it('saves the design view into the project it is saving, not the folder above', () => {
    const at = MAIN.indexOf('handle<readonly SavedVersion[]>(CHANNEL.designCommit');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, MAIN.indexOf('handle<PutBack>(CHANNEL.putBack'));
    expect(block).toContain('const folder = folderFor(open, where)');
    expect(block).toContain('styleTokens(folder)');
    expect(block).not.toContain('open.path');
  });

  /** The panel names the project on every one of these; the window has to pass
   *  it on, or going back from the strip answers "this folder holds several". */
  it('passes the project the panel named all the way to the shell', () => {
    expect(APP).toContain('onPutBack={(versionId, repo) => void putBack(versionId, repo)}');
    expect(APP).toContain('onName={(versionId, name, repo) => void nameVersion(versionId, name, repo)}');
    expect(APP).toContain('historyRepo === null ? desk.versions : (desk.repoVersions[historyRepo]');
    expect(OVERVIEW).toContain('onOpenGraph={() => onOpenGraph(whose?.name)}');
  });

  it('carries the named project across the bridge rather than dropping it', () => {
    const at = PRELOAD.indexOf('function named(');
    expect(at).toBeGreaterThan(-1);
    expect(PRELOAD.slice(at, at + 900)).toContain('asked.repo = where.repo;');
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
      const window = MAIN.slice(at, at + 2500);
      expect(window, `${channel} never answers for several projects unasked`).toContain(
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

  it('gives every project the same line-of-work control a lone project gets', () => {
    const at = OVERVIEW.indexOf('{several ? (');
    expect(at).toBeGreaterThan(-1);
    const block = OVERVIEW.slice(at, at + 2200);
    expect(block).toContain('onSwitch={(name) => onSwitchBranch(name, one.name)}');
    expect(block).toContain('onCreate={(name) => onCreateBranch(name, one.name)}');
    expect(block).toContain('onSave(one.name)');
    expect(block).toContain('onSeeProject(one.name)');
  });

  it('shows one project’s history at a time, and says whose', () => {
    const at = OVERVIEW.indexOf('className="overview__timeline"');
    const block = OVERVIEW.slice(at, at + 2200);
    expect(block).toContain('projects__strip');
    expect(block).toContain('view.repoVersions[whose.name]');
    expect(block).toContain('onPutBack(versionId, whose?.name)');
    expect(block).toContain('git={whose === null ? git : whose.git}');
  });

  it('asks each project for its own timeline', () => {
    expect(APP).toContain("bridge.versions({ project: path, repo: one.name })");
    expect(APP).toContain('repoVersions: desk.repoVersions,');
  });

  /** Starting a preview needs a project, so it is a press on the project's own
   *  row. The pill stays a way back to the page already being served — never a
   *  disabled control behind a hint nobody can reach. */
  it('leaves starting a preview to the project’s own row', () => {
    expect(APP).toContain('severalProjects');
    expect(APP).toContain("onClick={() => (severalProjects ? movePane('split') : void seeIt())}");
    expect(OVERVIEW).toContain('onSeeProject(one.name)');
  });
});
