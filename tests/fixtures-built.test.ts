/** The fixtures themselves, checked against what is really on disk.
 *
 * Every builder in `tests/helpers/fixtures.ts` is only worth having if it
 * builds the thing it says it does, so each one is opened here and the property
 * that matters is asked of the filesystem or of git rather than of the builder.
 */

import { existsSync, lstatSync, readlinkSync, statSync } from 'node:fs';
import { readFile, realpath } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';

import type { AgentEvent } from '../src/agent/types';
import {
  collidingLegacyNames,
  forgetBarriers,
  gitIn,
  gitRepo,
  legacyName,
  missingWorktree,
  movedProject,
  parentWithTwoRepos,
  plainFolder,
  release,
  scriptedModel,
  STAGED_LINE,
  UNSTAGED_LINE,
  until,
  type Built,
  type ScriptedModel,
} from './helpers/fixtures';

const kept: Built[] = [];

/** Build one, and let the suite take it away at the end. */
function held<T extends Built>(one: T): T {
  kept.push(one);
  return one;
}

afterAll(async () => {
  forgetBarriers();
  for (const one of kept) await one.dispose();
});

/** Start a round and let it run, so a test can look at what has arrived. */
function playing(model: ScriptedModel, round = 0): { events: AgentEvent[]; done: Promise<void> } {
  const events: AgentEvent[] = [];
  const done = (async () => {
    for await (const one of model.stream(round)) events.push(one);
  })();
  return { events, done };
}

function deltasIn(events: readonly AgentEvent[]): Extract<AgentEvent, { type: 'message-delta' }>[] {
  return events.filter(
    (one): one is Extract<AgentEvent, { type: 'message-delta' }> => one.type === 'message-delta',
  );
}

/* -------------------------------------------------------------------------- */

describe('a repository with everything the register asks for', () => {
  it('has the committed file, the staged edit and the separate unstaged edit', async () => {
    const repo = held(await gitRepo());
    expect(repo.head).toMatch(/^[0-9a-f]{40}$/);
    expect(repo.head).toBe((await repo.git('rev-parse', 'HEAD')).out.trim());
    expect(await repo.status()).toContain(`MM ${repo.paths.committed}`);

    const working = await readFile(repo.at(repo.paths.committed), 'utf8');
    expect(working).toContain(STAGED_LINE);
    expect(working).toContain(UNSTAGED_LINE);

    // The index has the first edit and not the second, which is what `MM`
    // means and what a two-sided diff depends on.
    const index = (await repo.git('show', `:${repo.paths.committed}`)).out;
    expect(index).toContain(STAGED_LINE);
    expect(index).not.toContain(UNSTAGED_LINE);

    const committed = (await repo.git('show', `HEAD:${repo.paths.committed}`)).out;
    expect(committed).not.toContain(STAGED_LINE);
    expect(committed).not.toContain(UNSTAGED_LINE);
  });

  it('leaves the untracked source file untracked', async () => {
    const repo = held(await gitRepo());
    expect(await repo.status()).toContain(`?? ${repo.paths.untracked}`);
    expect(existsSync(repo.at(repo.paths.untracked))).toBe(true);
  });

  it('has no uncommitted work at all when dirty is false', async () => {
    const repo = held(await gitRepo({ dirty: false, untracked: true }));
    expect((await repo.status()).trim()).toBe('');
    expect(existsSync(repo.at(repo.paths.untracked))).toBe(false);
  });

  it('leaves only the unstaged edit when staged is false', async () => {
    const repo = held(await gitRepo({ staged: false }));
    expect(await repo.status()).toBe(` M ${repo.paths.committed}\n?? ${repo.paths.untracked}\n`);
  });

  it('commits a binary file git tracks as one', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    const bytes = await readFile(repo.at(repo.paths.binary));
    expect(bytes.includes(0)).toBe(true);
    expect((await repo.git('ls-files', '--error-unmatch', repo.paths.binary)).code).toBe(0);
  });

  it('commits an executable script that is executable on disk', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    expect(statSync(repo.at(repo.paths.script)).mode & 0o777).toBe(0o755);
    expect((await repo.git('ls-files', '-s', repo.paths.script)).out.startsWith('100755')).toBe(true);
  });

  it('commits a symlink that really resolves', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    const link = repo.at(repo.paths.link);
    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(readlinkSync(link)).toBe(repo.paths.committed);
    expect(await realpath(link)).toBe(await realpath(repo.at(repo.paths.committed)));
    expect((await repo.git('ls-files', '-s', repo.paths.link)).out.startsWith('120000')).toBe(true);
  });

  it('has a dependency directory git ignores and somebody could install into', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    expect(existsSync(repo.at(repo.paths.ignored))).toBe(true);
    expect((await repo.git('check-ignore', '-q', repo.paths.ignored)).code).toBe(0);
    expect(await repo.status()).not.toContain('node_modules');
  });

  it('has a .env.local of made-up values, ignored and never committed', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    const words = await readFile(repo.at(repo.paths.env), 'utf8');
    expect(words).toContain('dummy-token-not-a-secret');
    expect(words).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
    expect(await repo.status()).not.toContain('.env.local');
  });

  it('refuses to hand back a path above its own root', async () => {
    const repo = held(await gitRepo({ dirty: false }));
    expect(() => repo.at('..', 'elsewhere.txt')).toThrow(/outside its own folder/);
  });

  it('takes its folder away when asked, and twice is fine', async () => {
    const repo = await gitRepo({ dirty: false });
    expect(existsSync(repo.root)).toBe(true);
    await repo.dispose();
    await repo.dispose();
    expect(existsSync(repo.root)).toBe(false);
  });
});

describe('the shapes around a repository', () => {
  it('plainFolder is a folder with a file and no repository', async () => {
    const folder = held(await plainFolder());
    expect(existsSync(folder.at(folder.file))).toBe(true);
    expect(existsSync(folder.at('.git'))).toBe(false);
    expect(await readFile(folder.at(folder.file), 'utf8')).toContain('Not a repository');
    expect((await gitIn(folder.root, 'status')).code).not.toBe(0);
  });

  it('parentWithTwoRepos holds two repositories, each its own top level', async () => {
    const parent = held(await parentWithTwoRepos());
    expect(parent.first).not.toBe(parent.second);
    for (const child of [parent.first, parent.second]) {
      const top = (await gitIn(child, 'rev-parse', '--show-toplevel')).out.trim();
      expect(await realpath(top)).toBe(await realpath(child));
    }
    expect((await gitIn(parent.first, 'log', '--oneline')).out).toContain('one starts');
    expect((await gitIn(parent.second, 'log', '--oneline')).out).toContain('two starts');
  });

  it('movedProject keeps the repository and leaves the stale path behind', async () => {
    const project = held(await movedProject());
    expect(existsSync(project.stale)).toBe(false);
    expect(existsSync(project.moved)).toBe(true);
    expect(await realpath((await gitIn(project.moved, 'rev-parse', '--show-toplevel')).out.trim())).toBe(
      await realpath(project.moved),
    );
    expect((await gitIn(project.moved, 'log', '--oneline')).out).toContain('Before the move');
    expect((await gitIn(project.stale, 'status')).code).not.toBe(0);
  });

  it('missingWorktree names a checkout git still lists and the disk does not', async () => {
    const gone = held(await missingWorktree());
    expect(existsSync(gone.recorded)).toBe(false);
    expect((await gitIn(gone.repo, 'worktree', 'list', '--porcelain')).out).toContain(gone.recorded);
    expect((await gitIn(gone.repo, 'rev-parse', '--verify', gone.branch)).code).toBe(0);
  });

  it('collidingLegacyNames are two real projects the legacy derivation cannot tell apart', async () => {
    const both = held(await collidingLegacyNames());
    expect(both.legacy).toBe('website');
    expect(legacyName(both.first)).toBe(legacyName(both.second));
    expect(basename(both.first)).toBe(basename(both.second));
    expect(both.first).not.toBe(both.second);
    expect((await gitIn(both.first, 'log', '--oneline')).out).toContain('one starts');
    expect((await gitIn(both.second, 'log', '--oneline')).out).toContain('two starts');
    expect((await gitIn(both.first, 'log', '--oneline')).out).not.toContain('two starts');
  });
});

describe('barriers', () => {
  it('opens whether the wait or the release came first', async () => {
    release('already open');
    await expect(until('already open')).resolves.toBeUndefined();

    let opened = false;
    const waiting = until('still shut').then(() => {
      opened = true;
    });
    expect(opened).toBe(false);
    release('still shut');
    await waiting;
    expect(opened).toBe(true);
  });

  it('fails rather than hanging when nothing releases it', async () => {
    await expect(until('never released', 20)).rejects.toThrow(/Nothing released/);
  });
});

describe('a model that does exactly what the script says', () => {
  it('reads cwd, writes a fixture file, reads it back, and says so in pieces', async () => {
    const folder = held(await plainFolder());
    const model = scriptedModel(
      [
        [
          { kind: 'cwd' },
          { kind: 'write', file: 'scratch/note.txt', content: 'written by the script' },
          { kind: 'read', file: 'scratch/note.txt' },
          { kind: 'say', text: 'Done, and here is what it says.', chunk: 8 },
        ],
      ],
      { root: folder.root, cwd: () => '/a/pretend/project' },
    );

    const events = await model.events(0);
    expect(events[0]).toEqual({ type: 'busy', on: true });
    expect(deltasIn(events).map((one) => one.text).join('')).toBe('Done, and here is what it says.');
    expect(deltasIn(events).length).toBeGreaterThan(1);
    expect(events.at(-1)).toEqual({ type: 'busy', on: false });

    expect(await readFile(folder.at('scratch/note.txt'), 'utf8')).toBe('written by the script');
    expect(model.observations()).toEqual([
      { kind: 'cwd', cwd: '/a/pretend/project' },
      {
        kind: 'wrote',
        file: folder.at('scratch/note.txt'),
        bytes: Buffer.byteLength('written by the script'),
      },
      { kind: 'read', file: folder.at('scratch/note.txt'), text: 'written by the script' },
      { kind: 'settled', how: 'finished' },
    ]);
  });

  it('waits between delayed deltas instead of guessing how long one takes', async () => {
    const waits: number[] = [];
    const model = scriptedModel([[{ kind: 'say', text: 'abcdefghij', chunk: 5, everyMs: 7 }]], {
      wait: async (ms) => {
        waits.push(ms);
      },
    });

    const events = await model.events(0);
    expect(deltasIn(events).map((one) => one.text)).toEqual(['abcde', 'fghij']);
    // Once, between the two pieces, and not before the first: a stream is
    // already coming when a real one starts waiting.
    expect(waits).toEqual([7]);
    expect(model.observations()).toContainEqual({ kind: 'waited', ms: 7 });
  });

  it('reports a tool that failed in the script own words', async () => {
    const model = scriptedModel([
      [
        { kind: 'call', name: 'read', input: { path: 'notes.md' } },
        { kind: 'call', name: 'bash', input: { command: 'ls' }, fails: 'the command exited 1' },
      ],
    ]);

    const events = await model.events(0);
    expect(events).toContainEqual({
      type: 'tool-start',
      call: { id: 'call-1', name: 'read', input: { path: 'notes.md' } },
    });
    expect(events).toContainEqual({ type: 'tool-end', id: 'call-1', ok: true });
    expect(events).toContainEqual({
      type: 'tool-end',
      id: 'call-2',
      ok: false,
      detail: 'the command exited 1',
    });
    expect(model.observations()).toContainEqual({ kind: 'called', name: 'bash', ok: false });
  });

  it('holds the round open until the named barrier is released, so a test can look first', async () => {
    const folder = held(await plainFolder());
    const model = scriptedModel(
      [
        [
          { kind: 'write', file: 'before.txt', content: 'written before the wait' },
          { kind: 'hold', until: 'the other conversation has been picked' },
          { kind: 'write', file: 'after.txt', content: 'written after it' },
        ],
      ],
      { root: folder.root },
    );

    const running = playing(model);
    expect(await model.waiting()).toBe('the other conversation has been picked');
    expect(existsSync(folder.at('before.txt'))).toBe(true);
    expect(existsSync(folder.at('after.txt'))).toBe(false);
    expect(running.events.some((one) => one.type === 'settled')).toBe(false);

    release('the other conversation has been picked');
    await running.done;
    expect(existsSync(folder.at('after.txt'))).toBe(true);
    expect(running.events.at(-1)).toEqual({ type: 'busy', on: false });
  });

  it('pauses on a question and carries on when it is answered', async () => {
    const model = scriptedModel([
      [
        { kind: 'ask', question: 'Which file should I change?' },
        { kind: 'say', text: 'Then that is the one.' },
      ],
    ]);

    const running = playing(model);
    expect(await model.waiting()).toBe('ask-1');
    expect(model.paused).toBe(true);
    expect(running.events.some((one) => one.type === 'asked-first')).toBe(true);
    expect(running.events.some((one) => one.type === 'settled')).toBe(false);

    model.answer('the one on the left');
    await running.done;
    expect(model.answers).toEqual(['the one on the left']);
    expect(model.paused).toBe(false);
    expect(running.events).toContainEqual({ type: 'waiting-for-you', on: false });
    expect(model.observations()).toContainEqual({ kind: 'answered', text: 'the one on the left' });
  });

  it('settles a round past the end of the script saying nothing', async () => {
    const model = scriptedModel([[{ kind: 'say', text: 'Only one round in this script.' }]]);
    expect(model.rounds).toBe(1);
    expect(await model.events(1)).toEqual([
      { type: 'busy', on: true },
      { type: 'message-end' },
      { type: 'settled', how: 'finished' },
      { type: 'busy', on: false },
    ]);
  });

  it('settles a round that failed without saying anything finished', async () => {
    const model = scriptedModel([
      [{ kind: 'call', name: 'bash', fails: 'the command exited 1' }, { kind: 'settle', how: 'failed' }],
    ]);
    const events = await model.events(0);
    expect(events).toContainEqual({ type: 'settled', how: 'failed' });
    expect(events.some((one) => one.type === 'message-end')).toBe(false);
    expect(model.observations()).toContainEqual({ kind: 'settled', how: 'failed' });
  });

  it('refuses a file step with no root, and one that would leave the root', async () => {
    const folder = held(await plainFolder());
    const stray = scriptedModel([[{ kind: 'write', file: '../elsewhere.txt', content: 'no' }]], {
      root: folder.root,
    });
    await expect(stray.events(0)).rejects.toThrow(/outside its own folder/);
    expect(existsSync(join(dirname(folder.root), 'elsewhere.txt'))).toBe(false);

    const unscoped = scriptedModel([[{ kind: 'read', file: 'notes.txt' }]]);
    await expect(unscoped.events(0)).rejects.toThrow(/needs the folder it may touch/);
  });
});
