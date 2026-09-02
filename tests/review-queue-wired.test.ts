/** The review queue, from the settle that fills it to the press that empties it.
 *
 * The change this guards is a change of default: a conversation working in its
 * own checkout used to have its files carried into the person's folder on every
 * settle, and now an entry arrives on a list and nothing moves until somebody
 * says so. Live mirror is the way back to the old behaviour, one card at a
 * time, so both halves are asserted here — the new default, and the fact that
 * the old path is still reachable and unchanged.
 *
 * The carry itself is real git: a per-file decision is only worth anything if
 * the file it names is the only one that moves.
 */

import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { bringBack, createWorktree, landingWords, type RunGit } from '../src/history/worktree';
import { chooseFile, filesToTake, landsAsOneCommit, heldBack, queueFrom, waiting, withoutEntry, type Arriving, type Entry } from '../src/work/reviewqueue';
import { prBody, droppedFor } from '../src/components/ReviewQueue';
import { parseDiff } from '../src/diff/hunks';
import type { ReviewEntry } from '../src/lib/ipc';

const MAIN = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const APP = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const BRIDGE = readFileSync(fileURLToPath(new URL('../src/lib/bridge.ts', import.meta.url)), 'utf8');
const PRELOAD = readFileSync(fileURLToPath(new URL('../electron/preload.ts', import.meta.url)), 'utf8');
const IPC = readFileSync(fileURLToPath(new URL('../src/lib/ipc.ts', import.meta.url)), 'utf8');

const spawn = promisify(execFile);

function git(): RunGit {
  return async (args, options) => {
    try {
      const made = await spawn('git', ['-C', options.cwd, ...args], { encoding: 'utf8' });
      return { code: 0, out: made.stdout };
    } catch (cause) {
      const failed = cause as { code?: number };
      return { code: typeof failed.code === 'number' ? failed.code : 1, out: '' };
    }
  };
}

async function raw(cwd: string, ...args: string[]): Promise<string> {
  return (await spawn('git', ['-C', cwd, ...args], { encoding: 'utf8' })).stdout;
}

async function freshRepo(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), 'graphe-review-'));
  await raw(root, 'init', '-b', 'main');
  await raw(root, 'config', 'user.email', 'test@graphe.local');
  await raw(root, 'config', 'user.name', 'Test');
  await raw(root, 'config', 'commit.gpgsign', 'false');
  await writeFile(path.join(root, 'one.txt'), 'one\n');
  await writeFile(path.join(root, 'two.txt'), 'two\n');
  await raw(root, 'add', '.');
  await raw(root, 'commit', '-m', 'first');
  return root;
}

function entry(over: Partial<ReviewEntry> = {}): ReviewEntry {
  return {
    id: 'a1',
    from: 'conversation',
    title: 'Make the header sticky',
    address: 'a1',
    branch: 'graphe/conversation-2',
    mirror: false,
    files: [
      { path: 'src/Header.tsx', added: 12, removed: 3 },
      { path: 'src/Header.css', added: 4, removed: 0 },
    ],
    at: 1,
    read: false,
    ...over,
  };
}

/* -------------------------------------------------------------------------- */

describe('an entry arrives instead of the files', () => {
  it('notes the work on the list at every settle, whether or not it is mirroring', () => {
    // The one call that puts an entry on the list, and it is made before the
    // decision about carrying anything.
    expect(MAIN).toContain('void noteForReview(path, held, address, holding, mirroring)');
  });

  it('carries nothing home when the card is not mirroring', () => {
    const settle = MAIN.slice(MAIN.indexOf('function settleUpTheJob'));
    const body = settle.slice(0, settle.indexOf('\n}\n'));
    // The early return is the whole change: with mirror off, nothing below it
    // runs, and everything below it is the old apply.
    const noted = body.indexOf('noteForReview');
    const stop = body.indexOf('if (!mirroring) {');
    const carry = body.indexOf('bringBack(gitRunHereFor()');
    expect(noted).toBeGreaterThan(-1);
    expect(stop).toBeGreaterThan(noted);
    expect(carry).toBeGreaterThan(stop);
  });

  it('keeps live mirror as the old behaviour, and only for the conversation in front', () => {
    const settle = MAIN.slice(MAIN.indexOf('function settleUpTheJob'));
    expect(settle).toContain('held.mirroring.has(address)');
    expect(settle).toContain("held.sessions.current?.path === address");
    // Unchanged below the gate: the same version-first, same-line, bring-back.
    expect(settle).toContain('beforeBringingWorkIn');
    expect(settle).toContain('onTheSameLine(path, checkout.folder)');
  });

  it('never notes work for a conversation being landed or dropped', () => {
    const settle = MAIN.slice(MAIN.indexOf('function settleUpTheJob'));
    expect(settle).toContain('held.suppressCarry.has(address)');
  });

  it('an entry that changed nothing never joins the list', () => {
    const arriving: Arriving = {
      id: 'a1', from: 'conversation', title: 'Nothing', address: 'a1', files: [], at: 1,
    };
    expect(queueFrom([], [arriving])).toEqual([]);
  });

  it('refreshes the list in the window when a conversation settles', () => {
    expect(APP).toContain('refreshReviewQueue();');
    expect(APP).toContain('bridge.reviewQueue(reviewWhere())');
  });
});

/* -------------------------------------------------------------------------- */

describe('a decision per file', () => {
  it('reaches filesToTake, and filesToTake reaches the carry', () => {
    const decide = MAIN.slice(MAIN.indexOf('CHANNEL.reviewDecide'));
    const body = decide.slice(0, decide.indexOf('CHANNEL.reviewLand'));
    expect(body).toContain('const taking = filesToTake(entry, verdict);');
    expect(body).toContain('checkout.folder, taking)');
  });

  it('takes everything except what was held back, and nothing else', () => {
    const one = entry();
    const held = chooseFile([one], 'a1', 'src/Header.css', 'keep mine')[0] as Entry;
    expect(filesToTake(held, 'take it')).toEqual(['src/Header.tsx']);
    expect(heldBack(held)).toBe(1);
  });

  it('takes the one file that was right out of an entry otherwise turned down', () => {
    const one = entry();
    const singled = chooseFile([one], 'a1', 'src/Header.css', 'take theirs')[0] as Entry;
    expect(filesToTake(singled, 'keep mine')).toEqual(['src/Header.css']);
  });

  it('moves only the named file on disk', async () => {
    const repo = await freshRepo();
    try {
      const made = await createWorktree(git(), repo, 'conversation-2', null);
      expect(made.ok).toBe(true);
      const folder = made.ok && made.value !== null ? made.value.folder : '';
      await writeFile(path.join(folder, 'one.txt'), 'one, changed\n');
      await writeFile(path.join(folder, 'two.txt'), 'two, changed\n');

      const carried = await bringBack(git(), repo, folder, ['one.txt']);
      expect(carried.ok).toBe(true);
      if (carried.ok) expect(carried.value.applied).toEqual(['one.txt']);
      expect(await readFile(path.join(repo, 'one.txt'), 'utf8')).toBe('one, changed\n');
      // The file kept as yours is untouched, which is the whole promise.
      expect(await readFile(path.join(repo, 'two.txt'), 'utf8')).toBe('two\n');
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  it('draws a file kept as yours as dropped in the diff', () => {
    const diff = [
      'diff --git a/one.txt b/one.txt',
      'index 1111111..2222222 100644',
      '--- a/one.txt',
      '+++ b/one.txt',
      '@@ -1 +1 @@',
      '-one',
      '+one, changed',
      '',
    ].join('\n');
    const files = parseDiff(diff);
    const one = entry({ files: [{ path: 'one.txt', added: 1, removed: 1 }] });
    expect(droppedFor(files, one).size).toBe(0);
    const held = { ...one, choices: { 'one.txt': 'keep mine' as const } };
    expect(droppedFor(files, held).size).toBe(files[0]?.hunks.length ?? 0);
    expect(droppedFor(files, held).size).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe('landing', () => {
  it('squashes unless somebody asked for every version', () => {
    const land = MAIN.slice(MAIN.indexOf('CHANNEL.reviewLand'));
    const body = land.slice(0, land.indexOf('CHANNEL.reviewPr'));
    expect(body).toContain("said['how'] === 'every-version'");
    expect(body).toContain("how: everyVersion ? 'every-version' : 'squash'");
  });

  it('forces one commit once a file is held back, because there is no branch to bring across', () => {
    const one = entry();
    expect(landsAsOneCommit(one)).toBe(false);
    const held = chooseFile([one], 'a1', 'src/Header.css', 'keep mine')[0] as Entry;
    expect(landsAsOneCommit(held)).toBe(true);
    expect(MAIN).toContain("said['how'] === 'every-version' && !landsAsOneCommit(entry)");
  });

  it('names the two ways as themselves, and says what each one costs', () => {
    expect(landingWords.squash).toBe('One commit, your message');
    expect(landingWords.every).toBe('Keep every version');
    expect(landingWords.note).toContain('pre-commit');
  });

  it('refuses to land an entry with nothing chosen', () => {
    const land = MAIN.slice(MAIN.indexOf('CHANNEL.reviewLand'));
    expect(land.slice(0, land.indexOf('CHANNEL.reviewPr'))).toContain('reviewWords.nothingChosen');
  });

  it('takes the entry off the list once it has landed', () => {
    const one = entry();
    expect(withoutEntry([one], 'a1')).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe('a pull request from an entry', () => {
  it('sends the branch, then asks gh to open it with the summary as the body', () => {
    const pr = MAIN.slice(MAIN.indexOf('CHANNEL.reviewPr'));
    const body = pr.slice(0, pr.indexOf('CHANNEL.reviewMirror'));
    expect(body).toContain("'push',");
    expect(body).toContain('ghOpenPr(');
    expect(MAIN).toContain("'pr', 'create', '--head', branch, '--title', title, '--body-file', file");
  });

  it('describes what it actually carries, not what the entry started with', () => {
    const one = entry();
    const held = chooseFile([one], 'a1', 'src/Header.css', 'keep mine')[0] as ReviewEntry;
    const said = prBody({ ...held, branch: one.branch, mirror: false });
    expect(said).toContain('src/Header.tsx');
    expect(said).not.toContain('src/Header.css');
  });
});

/* -------------------------------------------------------------------------- */

describe('the bridge is whole', () => {
  const doors = [
    'reviewQueue',
    'reviewOpen',
    'reviewChoose',
    'reviewDecide',
    'reviewLand',
    'reviewPr',
    'reviewMirror',
    'conflictLook',
    'conflictSettle',
  ];

  it('names every door in one place, and answers it on all four sides', () => {
    for (const door of doors) {
      expect(IPC, door).toContain(`${door}:`);
      expect(PRELOAD, door).toContain(`CHANNEL.${door}`);
      expect(MAIN, door).toContain(`CHANNEL.${door}`);
      expect(BRIDGE, door).toContain(`${door}:`);
    }
  });

  it('a browser tab answers an empty list rather than pretending to have one', () => {
    expect(BRIDGE).toContain('reviewQueue(): Promise<Result<readonly ReviewEntry[]>>');
  });

  it('opens the screen from the palette and from above the composer', () => {
    expect(APP).toContain("id: 'review-queue', name: 'Review finished work'");
    expect(APP).toContain('className="reviewband"');
    expect(APP).toContain('waitingToReview(reviewQ)');
  });

  it('counts only what nobody has opened yet', () => {
    const list = queueFrom([], [
      { id: 'a', from: 'conversation', title: 'A', address: 'a', files: [{ path: 'a', added: 1, removed: 0 }], at: 2 },
      { id: 'b', from: 'conversation', title: 'B', address: 'b', files: [{ path: 'b', added: 1, removed: 0 }], at: 1 },
    ]);
    expect(waiting(list)).toBe(2);
    expect(waiting(list.map((one) => (one.id === 'a' ? { ...one, read: true } : one)))).toBe(1);
  });

  it('keeps a path off the wire from reaching outside the project', () => {
    expect(MAIN).toContain('function insideProject(');
    expect(MAIN).toContain('const target = insideProject(reviewRepo(open, where), path);');
  });

  it('remembers the list and the mirroring cards between sittings', () => {
    expect(MAIN).toContain('function reviewIndexFile(');
    expect(MAIN).toContain('const restoredReview = await readReviewQueue(path);');
    expect(existsSync(fileURLToPath(new URL('../src/components/ReviewQueue.tsx', import.meta.url)))).toBe(true);
  });
});
