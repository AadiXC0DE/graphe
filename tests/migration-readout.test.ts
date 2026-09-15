/** What the Storage page says about the move of older chats.
 *
 * The record the move writes reached the log and nowhere else, so what is
 * guarded here is the reading of it: a real marker file becomes the counts and
 * the sentences somebody sees, a re-run says the same thing, and a computer
 * that has never been through the move is told nothing at all.
 *
 * The two halves are read off a file this test writes and reads back through
 * the same call the shell makes, so the marker's own shape is proven here
 * rather than assumed.
 */

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { readoutOf } from '../electron/services/migration-readout';
import { commit, discover } from '../electron/services/migration-service';
import { emptyIndex } from '../electron/services/workspace-registry';
import type { MigrationNow } from '../src/lib/ipc';
import { saysMigration } from '../src/work/migration';

const made: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-readout-'));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

const NOW = Date.parse('2026-09-15T12:00:00Z');
/** What the record says it finished, and the clock the sentences are read
 *  against: three hours apart, so "when" is a phrase rather than "just now". */
const MOVED_AT = NOW - 3 * 60 * 60 * 1000;
const MARKER = 'workspace-migration.json';

/** A profile with one project and one chat whose folder is where it says. */
function profile(): { userData: string; root: string; one: string } {
  const userData = scratch();
  const root = join(userData, 'site');
  const managed = join(userData, 'worktrees', 'site');
  const one = join(managed, 'one');
  mkdirSync(join(root, '.git'), { recursive: true });
  mkdirSync(join(one, '.git'), { recursive: true });
  // The legacy index lives here, so this is where its copy goes beside it.
  mkdirSync(join(userData, 'conversation-checkouts'), { recursive: true });
  return { userData, root, one };
}

/**
 * Run the move as the shell runs it, and hand back what it left on the disk.
 *
 * The marker is written the way `runWorkspaceMigration` writes it, copies and
 * all, and read back from the file rather than from the value — the reading is
 * the thing under test.
 */
async function moved(where: { userData: string; root: string; one: string }): Promise<string> {
  const probe = {
    exists: async (path: string) => existsSync(path),
    isRepo: async (path: string) => existsSync(join(path, '.git')),
    branchOf: async (path: string) => (path === where.one ? 'graphe/one' : null),
    worktreeList: async () => [where.one],
  };
  const manifest = discover({
    projects: [
      {
        path: where.root,
        checkoutFile: join(where.userData, 'conversation-checkouts', 'aa.json'),
        checkouts: { 'chat-one': { folder: where.one, branch: 'graphe/one' } },
        chats: [{ conversationId: 'chat-local' }],
        managedRoot: join(where.userData, 'worktrees', 'site'),
      },
    ],
    recentsFile: join(where.userData, 'projects.json'),
    exists: (path: string) => existsSync(path),
  });
  const indexFile = join(where.userData, 'workspaces.json');
  const run = await commit(manifest, { index: emptyIndex(), probe, now: MOVED_AT, indexFile });
  // The copies, then the record of which ones were really kept. The record
  // names the file each copy is of, the way the shell writes it.
  const kept: string[] = [];
  for (const one of run.backups) {
    writeFileSync(`${one.path}.bak`, 'the file as it was');
    kept.push(one.path);
  }
  const file = join(where.userData, MARKER);
  writeFileSync(
    file,
    `${JSON.stringify({ ...run.marker, unlinked: run.unlinked, quarantined: run.quarantined, backups: kept }, null, 2)}\n`,
  );
  return file;
}

/** The readout as the shell asks for it: the file, the two things the record
 *  cannot know about itself, and the copies that are still there. */
function readoutOfFile(file: string): MigrationNow {
  const userData = join(file, '..');
  return readoutOf({
    marker: existsSync(file) ? readFileSync(file, 'utf8') : null,
    newer: false,
    backupFolder: userData,
    keptBackups: (paths) => paths.filter((one) => existsSync(one)).length,
  });
}

/* ========================================================================== */

describe('the record a move leaves behind', () => {
  it('is read back as the counts the move made', async () => {
    const where = profile();
    const file = await moved(where);
    const now = readoutOfFile(file);

    expect(now.completedAt).toBe(MOVED_AT);
    expect(now.sources).toBe(2);
    expect(now.verdicts).toEqual({ verified: 2, missing: 0, gone: 0, foreign: 0 });
    expect(now.connected).toBe(2);
    expect(now.unlinked).toBe(0);
    expect(now.unreadable).toBe(0);
    // Two source files and the index it replaced: the copies are named by the
    // record and the count comes from what is on the disk.
    expect(now.backups).toBe(3);
    expect(now.backupFolder).toBe(where.userData);
    expect(now.newer).toBe(false);
    expect(saysMigration(now, NOW).length).toBeGreaterThan(0);
  });

  it('says the same thing when the check is run again', async () => {
    const where = profile();
    const file = await moved(where);
    const first = readoutOfFile(file);
    // A second run writes the same counts, decided by what is on the disk.
    await moved(where);
    expect(readoutOfFile(file)).toEqual(first);
    expect(saysMigration(readoutOfFile(file), NOW)).toEqual(saysMigration(first, NOW));
  });

  /* Zero would be a claim that the move kept no copies, which is not what a
     record that names none is saying. */
  it('leaves the copies unknown when the record names none', async () => {
    const where = profile();
    const file = await moved(where);
    const held = JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;
    delete held['backups'];
    writeFileSync(file, JSON.stringify(held));
    expect(readoutOfFile(file).backups).toBeNull();

    const named: readonly string[] = saysMigration(readoutOfFile(file), NOW);
    expect(named.some((one) => one.includes('did not write down the copies'))).toBe(true);
  });

  /* A copy somebody has already thrown away is not one to offer. */
  it('counts only the copies that are still beside their file', async () => {
    const where = profile();
    const file = await moved(where);
    const held = JSON.parse(readFileSync(file, 'utf8')) as { backups: readonly string[] };
    const [first] = held.backups;
    if (first === undefined) throw new Error('the move kept nothing');
    rmSync(`${first}.bak`);
    expect(readoutOfFile(file).backups).toBe(held.backups.length - 1);
  });
});

describe('a computer that has never been through it', () => {
  it('is told nothing at all', () => {
    const now = readoutOf({ marker: null, newer: false, backupFolder: '/data', keptBackups: () => 0 });
    expect(now.completedAt).toBeNull();
    expect(now.sources).toBe(0);
    expect(now.backups).toBeNull();
    expect(saysMigration(now, NOW)).toEqual([]);
  });

  /* Every install that has run this build has a record, and on a fresh one it
     is empty. An empty record is not something that happened. */
  it('is told nothing for a record with nothing in it', () => {
    const now = readoutOf({
      marker: JSON.stringify({
        version: 1,
        completedAt: NOW,
        sources: 0,
        verdicts: { verified: 0, missing: 0, gone: 0, foreign: 0 },
        workspaces: [],
        conversations: [],
        unlinked: [],
        quarantined: [],
        backups: [],
      }),
      newer: false,
      backupFolder: '/data',
      keptBackups: () => 0,
    });
    expect(now.sources).toBe(0);
    expect(saysMigration(now, NOW)).toEqual([]);
  });

  it('is told nothing for a marker that will not read', () => {
    const now = readoutOf({
      marker: '{"version":',
      newer: false,
      backupFolder: '/data',
      keptBackups: () => 0,
    });
    expect(now.completedAt).toBeNull();
    // Not "there was no move": a file that will not read is not a file that
    // says nothing happened, and the shell says which by not saying anything.
    expect(saysMigration(now, NOW)).toEqual([]);
  });
});

describe('the sentences the screen is built from', () => {
  it('says what was found without naming a count that is zero', () => {
    const said = saysMigration(
      {
        completedAt: MOVED_AT,
        sources: 3,
        verdicts: { verified: 2, missing: 1, gone: 0, foreign: 0 },
        connected: 2,
        unlinked: 0,
        unreadable: 0,
        backups: 3,
        backupFolder: '/Users/somebody/profile',
        newer: false,
      },
      NOW,
    );
    expect(said[0]).toBe('Moved 3 hours ago.');
    expect(said.some((one) => one.includes('3 chats'))).toBe(true);
    expect(said.some((one) => one.includes('lost their folder'))).toBe(true);
    // Nobody is told about nothing: a zero-count line is a worry about nothing.
    expect(said.filter((one) => one.includes('nowhere to point them'))).toEqual([]);
    expect(said.filter((one) => one.includes('could not be placed'))).toEqual([]);
    expect(said.filter((one) => one.includes('could not be read'))).toEqual([]);
    expect(said.some((one) => one.includes('still beside them'))).toBe(true);
  });

  /* The one case worth saying with no record at hand: the move was deliberately
     not run, and why is not silence. */
  it('says so, and what to do, when the record is from a newer app', () => {
    const said = saysMigration(
      readoutOf({
        marker: null,
        newer: true,
        backupFolder: '/Users/somebody/profile',
        keptBackups: () => 0,
      }),
      NOW,
    );
    expect(said.some((one) => one.includes('newer version'))).toBe(true);
    expect(said.some((one) => one.includes('not writing to it'))).toBe(true);
    expect(said.some((one) => one.includes('put a copy back'))).toBe(true);
    expect(said.some((one) => one.includes('Do not delete it by hand'))).toBe(true);
  });

  it('counts one chat as one', () => {
    const said = saysMigration(
      {
        completedAt: NOW,
        sources: 1,
        verdicts: { verified: 1, missing: 0, gone: 0, foreign: 0 },
        connected: 1,
        unlinked: 0,
        unreadable: 0,
        backups: 0,
        backupFolder: '/data',
        newer: false,
      },
      NOW,
    );
    expect(said.join(' ')).toContain('1 chat had been working');
    expect(said.join(' ')).toContain('One of them now opens');
    expect(said.join(' ')).not.toContain('1 chats');
  });
});
