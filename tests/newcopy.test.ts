/** What a fresh copy of a project needs before work can run in it.
 *
 *  The claim under test: a copy arrives with the private files it cannot work
 *  without, and with nothing it should not have — not the pieces under
 *  node_modules, not anything reached through a shortcut pointing out of the
 *  project, and never over the top of what the history already put there.
 */

import { mkdtemp, mkdir, readFile, realpath, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import {
  CARRIED_BY_DEFAULT,
  CARRY_LIST,
  carryOver,
  getReady,
  piecesCommand,
  readCarryList,
  whatToCarry,
} from '../src/history/newcopy';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-copy-')));
  made.push(folder);
  return folder;
}

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}

async function there(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

describe('the list a project can write', () => {
  it('reads one name a line, and ignores notes and blanks', () => {
    expect(readCarryList('# keys\n.env\n\n  .env.local  \n')).toEqual(['.env', '.env.local']);
  });

  it('drops anything that reaches outside the project', () => {
    expect(readCarryList('../secrets\n/etc/passwd\nC:\\keys\nsrc/../../out\n')).toEqual([]);
    expect(readCarryList('.env\n../secrets\n')).toEqual(['.env']);
  });

  it('says the same name once', () => {
    expect(readCarryList('.env\n./.env\n.env\n')).toEqual(['.env']);
  });

  it('falls back to something sensible when a project says nothing', async () => {
    const root = await newFolder();
    expect(await whatToCarry(root)).toEqual([...CARRIED_BY_DEFAULT]);
    expect(CARRIED_BY_DEFAULT).toContain('.env');
  });

  it('lets a project say for itself', async () => {
    const root = await newFolder();
    await put(root, CARRY_LIST, '# ours\nconfig/local.json\n.env\n');
    expect(await whatToCarry(root)).toEqual(['config/local.json', '.env']);
  });
});

describe('carrying the private files into a copy', () => {
  it('brings the keys across without being asked', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(from, '.env', 'API_KEY=abc\n');
    await put(from, '.env.local', 'LOCAL=1\n');
    await put(from, 'src/App.tsx', 'export const a = 1;\n');

    const carried = await carryOver(from, to);
    expect(carried).toContain('.env');
    expect(carried).toContain('.env.local');
    expect(await readFile(path.join(to, '.env'), 'utf8')).toBe('API_KEY=abc\n');
    // Everything the history keeps is already in the copy; this is not a sync.
    expect(await there(path.join(to, 'src/App.tsx'))).toBe(false);
  });

  it('never writes over what the copy already has', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(from, '.env', 'API_KEY=theirs\n');
    await put(to, '.env', 'API_KEY=already here\n');

    expect(await carryOver(from, to)).toEqual([]);
    expect(await readFile(path.join(to, '.env'), 'utf8')).toBe('API_KEY=already here\n');
  });

  it('follows no shortcut, in either the name or the folder above it', async () => {
    const from = await newFolder();
    const to = await newFolder();
    const outside = await newFolder();
    await put(outside, 'stolen.txt', 'somebody else\n');
    await put(from, CARRY_LIST, 'linked\nby-folder/x.txt\n');
    await symlink(path.join(outside, 'stolen.txt'), path.join(from, 'linked'));
    await symlink(outside, path.join(from, 'by-folder'));

    expect(await carryOver(from, to)).toEqual([]);
    expect(await there(path.join(to, 'linked'))).toBe(false);
    expect(await there(path.join(to, 'by-folder'))).toBe(false);
  });

  it('leaves the installed pieces alone however hard a list asks', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(from, CARRY_LIST, 'node_modules\nnode_modules/left-pad/index.js\n.git/config\n');
    await put(from, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');
    await put(from, '.git/config', '[core]\n');

    expect(await carryOver(from, to)).toEqual([]);
    expect(await there(path.join(to, 'node_modules'))).toBe(false);
    expect(await there(path.join(to, '.git'))).toBe(false);
  });

  it('carries a folder a project names, and makes the folders it needs', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(from, CARRY_LIST, 'private\n');
    await put(from, 'private/keys.json', '{"k":1}\n');
    await put(from, 'private/deeper/more.json', '{"k":2}\n');

    const carried = await carryOver(from, to);
    expect(carried.sort()).toEqual(['private/deeper/more.json', 'private/keys.json']);
    expect(await readFile(path.join(to, 'private/deeper/more.json'), 'utf8')).toBe('{"k":2}\n');
  });

  it('says nothing and breaks nothing when there is nothing to carry', async () => {
    const from = await newFolder();
    const to = await newFolder();
    expect(await carryOver(from, to)).toEqual([]);
    expect(await carryOver(from, from)).toEqual([]);
    expect(await carryOver(path.join(from, 'not-here'), to)).toEqual([]);
  });
});

describe('putting the pieces back', () => {
  it('asks for the exact versions the project already had', async () => {
    const root = await newFolder();
    await put(root, 'package.json', '{"name":"x"}\n');
    expect(await piecesCommand(root)).toEqual(['npm', 'install']);

    await put(root, 'package-lock.json', '{}\n');
    expect(await piecesCommand(root)).toEqual(['npm', 'ci']);

    await put(root, 'pnpm-lock.yaml', '\n');
    expect(await piecesCommand(root)).toEqual(['pnpm', 'install', '--frozen-lockfile']);
  });

  it('has nothing to say about a project with nothing to install', async () => {
    const root = await newFolder();
    await put(root, 'index.html', '<h1>hello</h1>\n');
    expect(await piecesCommand(root)).toBeNull();
  });

  it('gets a copy ready in one call, and installs nothing it does not have to', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(from, '.env', 'API_KEY=abc\n');
    await put(to, 'index.html', '<h1>hello</h1>\n');

    const fresh = await getReady(from, to);
    expect(fresh.carried).toEqual(['.env']);
    expect(fresh.installed).toBeNull();
    expect(fresh.ready).toBe(true);
    expect(fresh.trouble).toBeNull();
  });

  it('does not pay for the pieces twice when a copy already has them', async () => {
    const from = await newFolder();
    const to = await newFolder();
    await put(to, 'package.json', '{"name":"x"}\n');
    await put(to, 'node_modules/left-pad/index.js', 'module.exports = 1;\n');

    const fresh = await getReady(from, to);
    expect(fresh.installed).toBeNull();
    expect(fresh.ready).toBe(true);
  });
});
