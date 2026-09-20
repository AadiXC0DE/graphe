/** One panel, one workspace.
 *
 * W10. `CHANNEL.overview` answered per field: the branch and the status came
 * from the folder the call named, while the artifacts, the palette and the
 * preview address came from the project's own folder — so one panel could
 * describe two different folders at once, and a chat working in its own copy
 * was shown the project's files under its own branch.
 *
 * The shell's own file cannot be imported here — it is an Electron entry point
 * — so the resolver, the git readers and the two pieces that follow a root are
 * lifted out of `electron/main.ts` and run: the lift fails loudly if any of them
 * is renamed or moved, and a copy cannot drift from the original. Everything
 * the lift needs is handed to it, so what runs is the real code.
 *
 *  Source text, not behaviour: the registry join inside the resolver and the handler that reads every root out of the one folder it resolved; no behavioural test can reach it — the lift hands the registry in, and the handler only ever runs under Electron.
 */

import { execFileSync, spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';
import ts from 'typescript';

import { artifactsAmong } from '../src/design/artifacts';
import { parseGitStatus, parseNumstat } from '../src/lib/gitstatus';

const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

/* ------------------------------------------------------------ the lift ---- */

/** The source of what starts at one line, up to what is written after it. */
function sliceFrom(opening: string, until: string): string {
  const at = MAIN.indexOf(opening);
  if (at === -1) throw new Error(`${opening} is no longer in electron/main.ts`);
  const end = MAIN.indexOf(until, at);
  if (end === -1) throw new Error(`${until} no longer follows ${opening} in electron/main.ts`);
  return MAIN.slice(at, end);
}

/** One lifted piece, run with the names it expects handed to it. */
function lift<T>(code: string, names: readonly string[], values: readonly unknown[], give: string): T {
  const plain = ts.transpileModule(`${code}\nreturn ${give};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...names, plain)(...values) as T;
}

/* ------------------------------------------------------- what it resolves -- */

type Choices = {
  copy: string | null;
  child: string | null;
  recorded: string | null;
  project: string;
};

/** The real resolver, with the three folders it could find handed to it: a
 *  conversation's own copy, a named child project, and the folder the registry
 *  wrote down. */
function resolved(choices: Choices): string {
  const asked = lift<(open: unknown, where: unknown) => string>(
    sliceFrom('function folderFor(', 'async function timelineFor'),
    ['checkoutEntryFor', 'childRepoFor', 'recordedFolderNow'],
    [
      () => (choices.copy === null ? null : { folder: choices.copy }),
      () => (choices.child === null ? null : { path: choices.child }),
      () => choices.recorded,
    ],
    'folderFor',
  );
  return asked({ path: choices.project, name: 'one', held: {} }, { conversation: 'chat' });
}

describe('the folder one call is about', () => {
  it('is the one it named, in the order it means them', () => {
    expect(resolved({ copy: '/w/copy', child: '/w/backend', recorded: '/w/said', project: '/w/project' })).toBe(
      '/w/copy',
    );
    expect(resolved({ copy: null, child: '/w/backend', recorded: '/w/said', project: '/w/project' })).toBe(
      '/w/backend',
    );
    expect(resolved({ copy: null, child: null, recorded: '/w/said', project: '/w/project' })).toBe('/w/said');
    expect(resolved({ copy: null, child: null, recorded: null, project: '/w/project' })).toBe('/w/project');
  });

  it('is the registry’s answer for a conversation nobody has open', () => {
    // Put down, evicted, or asked about before it was resumed: the folder is
    // still the one that chat works in, not whichever folder is in front.
    expect(resolved({ copy: null, child: null, recorded: '/w/chat-b', project: '/w/chat-a' })).toBe('/w/chat-b');
  });

  it('carries the resolver in the shell, not a second one beside it', () => {
    expect(MAIN).toContain('function folderFor(open: Workspace<Held>, where: Where): string {');
    expect(MAIN).toContain('recordedFolderNow(open, where) ??');
    expect(MAIN).toContain('workspaceForConversation(workspaceIndex, where.conversation)');
  });
});

/* --------------------------------------------------------- the real git --- */

const ROOT = mkdtempSync(join(tmpdir(), 'graphe-overview-roots-'));
afterAll(() => rmSync(ROOT, { recursive: true, force: true }));

/** A repository with one commit on a branch of its own, and whatever is changed
 *  in it since. */
function repository(name: string, branch: string, changed: readonly string[]): string {
  const folder = join(ROOT, name);
  mkdirSync(folder, { recursive: true });
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.email=nobody@example.com', '-c', 'user.name=Nobody', ...args], {
      cwd: folder,
      stdio: 'ignore',
    });
  };
  git('init', '-q', `--initial-branch=${branch}`);
  writeFileSync(join(folder, 'README.md'), '# one\n');
  git('add', '-A');
  git('commit', '-qm', 'first');
  for (const file of changed) {
    writeFileSync(join(folder, file), 'changed\n');
  }
  return folder;
}

const COPY = repository('copy-a', 'alpha', ['notes.md']);
const PROJECT = repository('project', 'main', ['notes.md', 'hero.css']);

async function realGitRun(cwd: string, args: string[]): Promise<{ code: number; out?: string }> {
  try {
    return { code: 0, out: execFileSync('git', args, { cwd, encoding: 'utf8' }) };
  } catch {
    return { code: 1, out: '' };
  }
}

/** The shell's own status reading, lifted whole: the spawn and the parse it
 *  uses are handed to it, and the git it runs is the real one. */
const readGitStatusWithLines = lift<(cwd: string) => Promise<GitSnapshotLike | null>>(
  sliceFrom('function readGitStatus(', 'async function readBranches('),
  ['spawn', 'parseGitStatus', 'parseNumstat', 'gitRun'],
  [spawn, parseGitStatus, parseNumstat, realGitRun],
  'readGitStatusWithLines',
);

type GitSnapshotLike = {
  branch: string | null;
  changedPaths: number;
  files: readonly { path: string; kind: string }[];
};

describe('the status a panel is shown', () => {
  it('is the one read in the folder the call named, and nobody else’s', async () => {
    const mine = await readGitStatusWithLines(resolved({ copy: COPY, child: null, recorded: COPY, project: PROJECT }));
    const theirs = await readGitStatusWithLines(
      resolved({ copy: null, child: null, recorded: PROJECT, project: PROJECT }),
    );

    expect(mine?.branch).toBe('alpha');
    expect(mine?.changedPaths).toBe(1);
    expect(mine?.files.map((one) => one.path)).toEqual(['notes.md']);

    // The other workspace's work is nowhere in this answer, and its branch is
    // not this one's.
    expect(theirs?.branch).toBe('main');
    expect(theirs?.branch).not.toBe('alpha');
    expect(theirs?.files.map((one) => one.path)).toEqual(['hero.css', 'notes.md']);
    expect(mine?.files.map((one) => one.path)).not.toContain('hero.css');
  });
});

/* ------------------------------------------------ following that one root -- */

const artifactsIn = lift<(folder: string, files: Iterable<string>) => Promise<readonly ArtifactLike[]>>(
  sliceFrom('async function artifactsIn(', 'function previewForPanel('),
  ['stat', 'resolve', 'artifactsAmong'],
  [stat, resolve, artifactsAmong],
  'artifactsIn',
);

type ArtifactLike = { path: string; kind: string };

const previewForPanel = lift<
  (serving: { folder: string; address: string } | null, folder: string, named: readonly { path: string }[] | undefined) => string | null
>(
  sliceFrom('function previewForPanel(', 'async function childRepoNotes('),
  [],
  [],
  'previewForPanel',
);

describe('what follows that folder', () => {
  it('offers only the files a turn made in it', async () => {
    const here = join(ROOT, 'made');
    mkdirSync(join(here, 'public'), { recursive: true });
    writeFileSync(join(here, 'public', 'hero.png'), 'png');
    writeFileSync(join(here, 'theme.css'), ':root { --brand: #ff0000; }\n');

    // A file written in another workspace, whose path is spelled the same: it
    // is not in this folder, so it is not this panel's to offer.
    const made = await artifactsIn(here, ['public/hero.png', 'theme.css', 'elsewhere/logo.png']);
    expect(made.map((one) => one.path).sort()).toEqual(['public/hero.png', 'theme.css']);
  });

  it('shows the preview served for that folder, and nobody else’s', () => {
    const mine = { folder: '/w/copy', address: 'http://127.0.0.1:1/' };
    expect(previewForPanel(mine, '/w/copy', undefined)).toBe('http://127.0.0.1:1/');
    // Another conversation's own copy, served while this panel looks at the
    // project: not this panel's page to open.
    expect(previewForPanel(mine, '/w/project', undefined)).toBeNull();
    expect(previewForPanel(null, '/w/project', undefined)).toBeNull();
    // A folder holding several projects: the repositories it names are where a
    // preview of it can be served from, and that one is this panel's.
    const named = [{ path: '/w/backend' }, { path: '/w/frontend' }];
    expect(previewForPanel({ folder: '/w/backend', address: 'http://127.0.0.1:2/' }, '/w', named)).toBe(
      'http://127.0.0.1:2/',
    );
    expect(previewForPanel({ folder: '/w/elsewhere', address: 'http://127.0.0.1:3/' }, '/w', named)).toBeNull();
  });
});

/* ------------------------------------------------------ and in the handler -- */

describe('the overview handler', () => {
  const handler = (() => {
    const at = MAIN.indexOf('handle<Overview>(CHANNEL.overview');
    const end = MAIN.indexOf('handle<PutBack>', at);
    if (at === -1 || end === -1) throw new Error('the overview handler has moved');
    return MAIN.slice(at, end);
  })();

  it('reads every root it reports out of the one folder it resolved', () => {
    expect(handler).toContain('const cwd = folderFor(open, where);');
    expect(handler).toContain('const made = await artifactsIn(cwd, open.held.looking.files);');
    expect(handler).toContain('paletteFrom(await readFile(join(cwd, palette.path)');
    expect(handler).toContain('readGitStatusWithLines(cwd)');
    expect(handler).toContain('readBranches(cwd)');
    expect(handler).toContain('preview: previewForPanel(open.held.serving, cwd, repos),');
  });

  it('lists the repositories a folder holds, and reads its own roots in that folder', () => {
    expect(handler).toContain('open.held.childRepos.map(readRepoOverview)');
  });
});
