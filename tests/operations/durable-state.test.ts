/** What a file on disk that cannot be read costs, and what it must never cost.
 *
 * 9.5 asks for atomic writes, schema versions, corruption quarantine, disk-full
 * handling and recovery, and one rule above all of them: a parse failure must
 * never become empty user data. The write half is proven in
 * `tests/atomic.test.ts` (a failed write leaves the old bytes and no scratch
 * file, in both the async and the sync form) and the migration round trip in
 * `tests/scenarios/migration.test.ts`; what is here is the reading half — the
 * moment a file is unreadable and something has to decide what to do about it.
 *
 * Disk-full is the one case not here: there is no ENOSPC branch anywhere in the
 * app, so a full volume takes exactly the throwing path `tests/atomic.test.ts`
 * already covers with EACCES. Proving it needs a real full volume, or a stubbed
 * filesystem, and neither is a thing this suite can do honestly.
 */

import { chmod, mkdtemp, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { writeAtomically } from '../../src/lib/atomic';
import {
  canonical,
  emptyIndex,
  INDEX_VERSION,
  parseIndex,
  serializeIndex,
  verdictOn,
} from '../../electron/services/workspace-registry';
import { discover, readMarker } from '../../electron/services/migration-service';

const made: string[] = [];

afterAll(async () => {
  await Promise.all(made.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function scratch(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-ops-durable-')));
  made.push(folder);
  return folder;
}

/** An index with one good workspace and its project. */
function goodIndex(): unknown {
  return {
    version: INDEX_VERSION,
    projects: { p1: { projectId: 'p1', name: 'Paper Street', root: '/tmp/paper', aliases: [] } },
    byRoot: { '/tmp/paper': 'p1' },
    workspaces: {
      w1: { workspaceId: 'w1', projectId: 'p1', kind: 'local', cwd: '/tmp/paper', path: '/tmp/paper' },
    },
    conversations: {},
  };
}

/* ========================================================================== */

describe('an index that cannot be read', () => {
  it('says so rather than reporting an empty profile', () => {
    const broken = parseIndex('{ half written');
    expect(broken.problem).toContain('not JSON');
    expect(broken.future).toBe(false);
    // Empty *and* told: nothing downstream may read `index` without looking at
    // `problem` first, and the two together are how it knows not to.
    expect(broken.index.workspaces).toEqual({});
  });

  it('tells a newer profile apart from a corrupt one', () => {
    const newer = parseIndex(JSON.stringify({ version: INDEX_VERSION + 1, workspaces: { w: {} } }));
    expect(newer.problem).toContain('newer');
    // Not corruption: an older build must leave the file alone rather than
    // move somebody's record of where their work was out of the way.
    expect(newer.future).toBe(true);

    const wrong = parseIndex(JSON.stringify({ version: 'one' }));
    expect(wrong.problem).toContain(`not a version ${String(INDEX_VERSION)}`);
    expect(wrong.future).toBe(false);
  });

  it('says what a reader does with it, which is not the same for every failure', () => {
    expect(verdictOn(parseIndex(serializeIndex(emptyIndex())))).toBe('use');
    expect(verdictOn(parseIndex('{ half written'))).toBe('quarantine');
    // A newer app's profile is not this build's to move or overwrite.
    expect(verdictOn(parseIndex(JSON.stringify({ version: INDEX_VERSION + 1 })))).toBe('leave-alone');
  });

  it('keeps the rows that did survive', () => {
    const half = { ...(goodIndex() as Record<string, unknown>) } as Record<string, unknown>;
    half['workspaces'] = {
      w1: (goodIndex() as { workspaces: Record<string, unknown> })['workspaces']['w1'],
      w2: { projectId: 'p1' }, // no id, no folder: not a workspace
    };
    const read = parseIndex(JSON.stringify(half));
    expect(read.problem).toBeNull();
    expect(Object.keys(read.index.workspaces)).toEqual(['w1']);
  });

  it('never throws, whatever is in the file', () => {
    const hostile = ['', 'null', '[]', '"a string"', '42', '{}', '{"version":null}', '{"version":1e999}'];
    for (const text of hostile) {
      const read = parseIndex(text);
      expect(read.index.version, text).toBe(INDEX_VERSION);
      expect(typeof read.future, text).toBe('boolean');
      if (read.problem !== null) expect(read.problem.length, text).toBeGreaterThan(0);
    }
  });

  it('round-trips a profile it wrote itself', () => {
    const read = parseIndex(serializeIndex(emptyIndex()));
    expect(read.problem).toBeNull();
    expect(read.index).toEqual(emptyIndex());

    const written = parseIndex(serializeIndex(parseIndex(JSON.stringify(goodIndex())).index));
    expect(written.problem).toBeNull();
    expect(written.index.workspaces['w1']?.cwd).toBe(canonical('/tmp/paper'));
  });
});

describe('a migration marker', () => {
  it('is nothing when it cannot be read', () => {
    // Null is the safe answer: it means "run the migration", not "believe a
    // file that says it already ran".
    for (const text of ['', '{', 'null', '[]', '{"version":2}', '{"version":1}']) {
      expect(readMarker(text), text).toBeNull();
    }
  });
});

describe('a legacy row that cannot be read', () => {
  it('is kept aside with why, and the other rows still arrive', () => {
    const manifest = discover({
      projects: [
        {
          path: '/tmp/paper',
          checkouts: {
            'conversation-1': { folder: '/tmp/paper-copies/one', branch: 'graphe/one' },
            'conversation-2': { folder: 'relative/not-absolute', branch: 'graphe/two' },
            '': { folder: '/tmp/paper-copies/three', branch: 'graphe/three' },
          },
        },
      ],
      exists: () => false,
    });

    expect(manifest.records).toHaveLength(1);
    expect(manifest.quarantined.map((one) => one.address).sort()).toEqual(['', 'conversation-2']);
    for (const row of manifest.quarantined) {
      expect(row.problem.length).toBeGreaterThan(0);
      expect(row.projectPath).toBe(canonical('/tmp/paper'));
    }
  });
});

describe('a write that cannot finish', () => {
  it('leaves the folder exactly as it was, scratch file included', async () => {
    const folder = await scratch();
    const file = join(folder, 'index.json');
    await writeFile(file, '{"version":1}\n', 'utf8');

    await chmod(folder, 0o555);
    await expect(writeAtomically(file, '{"version":2}\n')).rejects.toThrow();
    await chmod(folder, 0o755);

    expect(await readFile(file, 'utf8')).toBe('{"version":1}\n');
    expect(await readdir(folder)).toEqual(['index.json']);
  });

  it('does not write beside a path that is not a folder', async () => {
    const folder = await scratch();
    const notAFolder = join(folder, 'a-file');
    await writeFile(notAFolder, 'not a folder', 'utf8');

    await expect(writeAtomically(join(notAFolder, 'inside.json'), '{}')).rejects.toThrow();
    expect(await readFile(notAFolder, 'utf8')).toBe('not a folder');
    expect(await readdir(folder)).toEqual(['a-file']);
  });

  it('creates the folder it was given, so a first write is not a failure', async () => {
    const folder = await scratch();
    const buried = join(folder, 'one', 'two', 'index.json');
    await writeAtomically(buried, '{"version":1}\n');
    expect(await readFile(buried, 'utf8')).toBe('{"version":1}\n');
    expect(await readdir(join(folder, 'one', 'two'))).toEqual(['index.json']);
  });
});
