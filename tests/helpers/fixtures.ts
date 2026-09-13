/** Disposable fixtures: real disk, real git, and a model that does exactly what
 *  the script says.
 *
 * Every builder here makes one folder under the system temp directory, writes
 *  nothing above it, and gives back a `dispose()` that takes the whole thing
 *  away again. Nothing is shared between tests, nothing lands in the repository,
 *  and nothing reaches the network.
 *
 * `scriptedModel` is the other half. It plays a list of steps as the events the
 * adapter emits, so a test can run a whole turn with no provider and no clock.
 * Where waiting matters it holds a barrier rather than sleeping, and the test
 * opens that barrier once it has looked at whatever it wanted to look at.
 */

import { execFile } from 'node:child_process';
import {
  appendFile,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve, sep } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';

import type { Question } from '../../src/agent/asking';
import type { AgentEvent, SettledHow } from '../../src/agent/types';
import { createWorktree, type RunGit } from '../../src/history/worktree';

const spawn = promisify(execFile);

/* -------------------------------------------------------------------------- */
/* Every fixture is one folder and a way to take it away                       */
/* -------------------------------------------------------------------------- */

export type Built = {
  /** The folder this fixture was built in. Nothing was written above it. */
  readonly root: string;
  /** An absolute path inside it. Refuses anything that would climb out. */
  at(...parts: string[]): string;
  /** Remove the folder and everything in it. Calling it twice is fine. */
  dispose(): Promise<void>;
};

/** A temp folder, resolved, because macOS hands out `/var/folders` paths that
 *  are really `/private/var` and git reports the resolved name. */
async function temporary(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

function inside(root: string, ...parts: string[]): string {
  const full = resolve(root, ...parts);
  if (full !== root && !full.startsWith(root + sep)) {
    throw new Error(`A fixture may not reach outside its own folder: ${full}`);
  }
  return full;
}

function built(root: string): Built {
  let gone = false;
  return {
    root,
    at: (...parts: string[]) => inside(root, ...parts),
    dispose: async () => {
      if (gone) return;
      gone = true;
      await rm(root, { recursive: true, force: true });
    },
  };
}

/* -------------------------------------------------------------------------- */
/* git, configured so a commit works anywhere                                  */
/* -------------------------------------------------------------------------- */

export type GitResult = { code: number; out: string; err: string };

/** One fixed moment, so two runs of the same fixture commit the same revision. */
const COMMIT_WHEN = '2020-01-01T00:00:00Z';

async function run(cwd: string, args: readonly string[]): Promise<GitResult> {
  try {
    const done = await spawn('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      env: {
        ...process.env,
        // No system or user configuration: a machine with an unusual signing
        // key or a default branch of its own must not change a fixture.
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_TERMINAL_PROMPT: '0',
        GIT_AUTHOR_DATE: COMMIT_WHEN,
        GIT_COMMITTER_DATE: COMMIT_WHEN,
      },
    });
    return { code: 0, out: done.stdout, err: done.stderr };
  } catch (error) {
    const failed = error as { code?: number; stdout?: string; stderr?: string };
    return {
      code: typeof failed.code === 'number' ? failed.code : 1,
      out: failed.stdout ?? '',
      err: failed.stderr ?? '',
    };
  }
}

/** git in a folder this module handed back but did not wrap, which is what the
 *  shapes around a repository (a child, a moved project) need. */
export async function gitIn(cwd: string, ...args: string[]): Promise<GitResult> {
  return run(cwd, args);
}

/** The git runner `src/history/` expects, over the runner above. */
function runGit(): RunGit {
  return async (args, options) => {
    const one = await run(options.cwd, args);
    return { code: one.code, out: one.out };
  };
}

async function init(root: string): Promise<void> {
  const made = await run(root, ['init', '-b', 'main']);
  if (made.code !== 0) throw new Error(`git init failed in ${root}: ${made.err}`);
  // Local, so a CI box with no global identity still makes commits, and no
  // signing key is needed to make one.
  await run(root, ['config', 'user.name', 'Graphe fixtures']);
  await run(root, ['config', 'user.email', 'fixtures@graphe.local']);
  await run(root, ['config', 'commit.gpgsign', 'false']);
  await run(root, ['config', 'tag.gpgsign', 'false']);
  await run(root, ['config', 'core.autocrlf', 'false']);
}

async function commitAll(root: string, message: string): Promise<string> {
  const added = await run(root, ['add', '-A']);
  if (added.code !== 0) throw new Error(`git add failed in ${root}: ${added.err}`);
  const made = await run(root, ['commit', '-m', message]);
  if (made.code !== 0) throw new Error(`git commit failed in ${root}: ${made.err}`);
  return (await run(root, ['rev-parse', 'HEAD'])).out.trim();
}

/* -------------------------------------------------------------------------- */
/* The repository                                                              */
/* -------------------------------------------------------------------------- */

const FILES = {
  /** Committed, and then edited twice when the fixture is dirty. */
  committed: 'notes.md',
  untracked: 'loose.ts',
  binary: 'assets/pixel.bin',
  script: 'scripts/run.sh',
  link: 'notes-link.md',
  ignored: 'node_modules/probe/index.js',
  env: '.env.local',
  ignoreList: '.gitignore',
} as const;

export type GitRepoPaths = typeof FILES;

const COMMITTED_TEXT = 'The fixture note.';
/** The two edits that make one file `MM`: one in the index, one not. */
export const STAGED_LINE = 'staged change, not committed yet';
export const UNSTAGED_LINE = 'unstaged change, not added yet';

/** Bytes a text editor will not read, so the tools that care can tell. */
const BINARY = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01, 0x02, 0x00, 0xff, 0xfe, 0x00,
]);

/** Made-up values and nothing else. A fixture is the one place a `.env` may be
 *  committed, and only because nothing in it is real. */
const DUMMY_ENV = [
  '# Made-up values, for tests. Put nothing real in a fixture.',
  'GRAPHE_FIXTURE_TOKEN=dummy-token-not-a-secret',
  'GRAPHE_FIXTURE_URL=https://example.invalid/v1',
  '',
].join('\n');

export type GitRepoOpts = {
  /** Uncommitted work at all: the edits to the committed file and the untracked
   *  source file. False leaves a tree `git status` calls clean, and the two
   *  flags below are then moot. */
  dirty?: boolean;
  /** That the staged edit is really in the index. Only when dirty. */
  staged?: boolean;
  /** That the untracked source file is there. Only when dirty. */
  untracked?: boolean;
  /** A committed file of bytes no editor will read. */
  binary?: boolean;
  /** A committed script with the executable bit set. */
  executable?: boolean;
  /** A committed symlink to the committed file. */
  symlink?: boolean;
  /** The dependency directory `.gitignore` names, with files inside it. */
  ignored?: boolean;
  /** A `.env.local` of made-up values. False when a test wants it absent. */
  env?: boolean;
};

export type GitRepo = Built & {
  /** Where each part of the fixture is, relative to the root. */
  readonly paths: GitRepoPaths;
  /** The committed revision, before any of the edits above. */
  readonly head: string;
  /** git here. */
  git(...args: string[]): Promise<GitResult>;
  /** `git status --porcelain`, one untracked file per line. */
  status(): Promise<string>;
};

/** A real repository, dirty by default: everything the register asks for, with
 *  each part switchable so one test can have the clean case. */
export async function gitRepo(opts: GitRepoOpts = {}): Promise<GitRepo> {
  const root = await temporary('graphe-fixture-repo-');
  const made = built(root);
  const at = made.at;
  await init(root);

  await writeFile(at(FILES.ignoreList), 'node_modules/\n.env.local\n');
  await writeFile(at(FILES.committed), `${COMMITTED_TEXT}\n`);
  if (opts.binary !== false) {
    await mkdir(at('assets'), { recursive: true });
    await writeFile(at(FILES.binary), BINARY);
  }
  if (opts.executable !== false) {
    await mkdir(at('scripts'), { recursive: true });
    await writeFile(at(FILES.script), '#!/bin/sh\necho fixture\n');
    await chmod(at(FILES.script), 0o755);
  }
  if (opts.symlink !== false) await symlink(FILES.committed, at(FILES.link));
  if (opts.ignored !== false) {
    await mkdir(at('node_modules/probe'), { recursive: true });
    await writeFile(at('node_modules/probe/package.json'), '{"name":"probe","version":"1.0.0"}\n');
    await writeFile(at(FILES.ignored), 'module.exports = "probe";\n');
  }
  if (opts.env !== false) await writeFile(at(FILES.env), DUMMY_ENV);

  const head = await commitAll(root, 'Fixture project');

  if (opts.dirty !== false) {
    if (opts.staged !== false) {
      await appendFile(at(FILES.committed), `${STAGED_LINE}\n`);
      const staged = await run(root, ['add', FILES.committed]);
      if (staged.code !== 0) throw new Error(`git add failed in ${root}: ${staged.err}`);
    }
    await appendFile(at(FILES.committed), `${UNSTAGED_LINE}\n`);
    if (opts.untracked !== false) {
      await writeFile(at(FILES.untracked), 'export const loose = true;\n');
    }
  }

  return {
    ...made,
    paths: FILES,
    head,
    git: (...args: string[]) => run(root, args),
    status: async () => (await run(root, ['status', '--porcelain'])).out,
  };
}

/* -------------------------------------------------------------------------- */
/* The shapes around a repository                                              */
/* -------------------------------------------------------------------------- */

export type PlainFolder = Built & { /** The one file in it. */ readonly file: string };

/** A folder with a file and no repository in it, for everything that has to
 *  cope with somebody opening a folder that is not a project. */
export async function plainFolder(): Promise<PlainFolder> {
  const root = await temporary('graphe-fixture-plain-');
  const made = built(root);
  await writeFile(made.at('notes.txt'), 'Not a repository, just a folder.\n');
  return { ...made, file: 'notes.txt' };
}

export type ParentWithTwoRepos = Built & {
  /** The first child repository. */
  readonly first: string;
  /** The second, with a history of its own and nothing in common. */
  readonly second: string;
};

/** One folder holding two projects, which is what a polyrepo sweep has to walk. */
export async function parentWithTwoRepos(): Promise<ParentWithTwoRepos> {
  const root = await temporary('graphe-fixture-parent-');
  const made = built(root);
  for (const name of ['one', 'two']) {
    const child = made.at(name);
    await mkdir(child, { recursive: true });
    await init(child);
    await writeFile(join(child, `${name}.txt`), `${name} is its own project\n`);
    await commitAll(child, `${name} starts`);
  }
  return { ...made, first: made.at('one'), second: made.at('two') };
}

export type MovedProject = Built & {
  /** The path a stored row still names. Nothing is there any more. */
  readonly stale: string;
  /** Where the project actually is now: same repository, same head. */
  readonly moved: string;
};

/** A project that was renamed, and the stale path left behind in whatever
 *  remembered it. A row pointing at `stale` must not be reused. */
export async function movedProject(): Promise<MovedProject> {
  const root = await temporary('graphe-fixture-moved-');
  const made = built(root);
  const stale = made.at('before-move');
  await mkdir(stale, { recursive: true });
  await init(stale);
  await writeFile(join(stale, 'notes.md'), 'Moved, not rewritten.\n');
  await commitAll(stale, 'Before the move');
  const moved = made.at('after-move');
  await rename(stale, moved);
  return { ...made, stale, moved };
}

export type MissingWorktree = Built & {
  /** The project. */
  readonly repo: string;
  /** The checkout a stored row still names. Its folder has been removed. */
  readonly recorded: string;
  /** The branch that checkout was on, still in the repository. */
  readonly branch: string;
};

/** A repository with a conversation's checkout made and then taken off disk
 *  behind git's back, which is what a project moved or cleaned by hand looks
 *  like from the inside. */
export async function missingWorktree(): Promise<MissingWorktree> {
  const root = await temporary('graphe-fixture-worktree-');
  const made = built(root);
  const repo = made.at('project');
  await mkdir(repo, { recursive: true });
  await init(repo);
  await writeFile(join(repo, 'notes.md'), 'The project, and a checkout of it.\n');
  await commitAll(repo, 'Fixture project');

  const checkout = await createWorktree(runGit(), repo, 'review', null);
  if (!checkout.ok || checkout.value === null) {
    throw new Error(
      `Could not make a checkout in ${repo}: ${checkout.ok ? 'it came back empty' : checkout.because}`,
    );
  }
  const recorded = checkout.value.folder;
  await rm(recorded, { recursive: true, force: true });
  return { ...made, repo, recorded, branch: checkout.value.branch };
}

/** The name a project used to be filed under: its own folder name, with every
 *  character that is not a letter, digit, dash or underscore flattened to a
 *  dash. Two projects called `website` in different places came out the same,
 *  so one's copies and remembered state could be read as the other's. */
export function legacyName(project: string): string {
  return basename(resolve(project))
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-');
}

export type CollidingLegacyNames = Built & {
  /** The first project: `<root>/one/website`. */
  readonly first: string;
  /** The second: `<root>/two/website`. */
  readonly second: string;
  /** The one key the legacy derivation filed both of them under. */
  readonly legacy: string;
};

/** Two real projects whose legacy names collide: same folder name, different
 *  parents, separate histories. */
export async function collidingLegacyNames(): Promise<CollidingLegacyNames> {
  const root = await temporary('graphe-fixture-collide-');
  const made = built(root);
  for (const parent of ['one', 'two']) {
    const child = made.at(parent, 'website');
    await mkdir(child, { recursive: true });
    await init(child);
    await writeFile(join(child, `${parent}.txt`), `${parent} wrote this\n`);
    await commitAll(child, `${parent} starts`);
  }
  const first = made.at('one', 'website');
  const second = made.at('two', 'website');
  return { ...made, first, second, legacy: legacyName(first) };
}

/* -------------------------------------------------------------------------- */
/* Barriers, so a test never guesses with a timer                              */
/* -------------------------------------------------------------------------- */

/** A promise somebody else settles. The gate below keeps the resolver until
 *  `release` finds it, which is the whole point of a barrier. */
type Waiter<T> = { promise: Promise<T>; done(value: T): void };

function waiter<T>(): Waiter<T> {
  let settle!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    settle = done;
  });
  return { promise, done: settle };
}

type Gate = { open: boolean; waiting: (() => void)[] };

const gates = new Map<string, Gate>();

function gateFor(name: string): Gate {
  const found = gates.get(name);
  if (found !== undefined) return found;
  const fresh: Gate = { open: false, waiting: [] };
  gates.set(name, fresh);
  return fresh;
}

/** Wait for a named barrier to be released.
 *
 *  Opening it first is fine: a barrier that is already open resolves at once,
 *  so a test cannot race the thing it is testing into a hang. The timeout is a
 *  hang guard rather than a delay; it is short because the suite times out at
 *  ten seconds and this failure says more. */
export async function until(name: string, timeoutMs = 5_000): Promise<void> {
  const gate = gateFor(name);
  if (gate.open) return;
  const held = waiter<void>();
  gate.waiting.push(() => {
    held.done(undefined);
  });
  await Promise.race([
    held.promise,
    sleep(timeoutMs).then(() => {
      throw new Error(`Nothing released '${name}' within ${String(timeoutMs)}ms.`);
    }),
  ]);
}

/** Open a named barrier. Everyone waiting on it, now or later, goes through. */
export function release(name: string): void {
  const gate = gateFor(name);
  gate.open = true;
  for (const one of gate.waiting.splice(0)) one();
}

/** Forget every barrier. For `afterAll`, so one suite cannot open another's. */
export function forgetBarriers(): void {
  gates.clear();
}

/* -------------------------------------------------------------------------- */
/* A model that does exactly what the script says                              */
/* -------------------------------------------------------------------------- */

/** One thing the scripted model does inside a round. */
export type Step =
  /** Say something, in pieces. `everyMs` waits between the pieces, which is
   *  what a stream arriving over a slow link looks like. */
  | { kind: 'say'; text: string; chunk?: number; everyMs?: number }
  /** Look at where the run thinks it is. Recorded, never altered. */
  | { kind: 'cwd' }
  /** Read a fixture file under the root. Throws if it is not there. */
  | { kind: 'read'; file: string }
  /** Write a fixture file under the root. Refuses to leave the root. */
  | { kind: 'write'; file: string; content: string }
  /** Call a tool. `fails` is what came back when it did not work. */
  | { kind: 'call'; name: string; input?: Record<string, unknown>; fails?: string }
  /** Ask a person, and hold the round here until they answer. */
  | { kind: 'ask'; question: string; until?: string }
  /** Hold the round here until the named barrier is released. */
  | { kind: 'hold'; until: string }
  /** End the round where it stands. Without one, the round ends finished once
   *  the steps above it have run. */
  | { kind: 'settle'; how?: SettledHow };

/** What a step did or saw, oldest first, for a test to assert against. */
export type Observation =
  | { kind: 'waited'; ms: number }
  | { kind: 'cwd'; cwd: string }
  | { kind: 'read'; file: string; text: string }
  | { kind: 'wrote'; file: string; bytes: number }
  | { kind: 'called'; name: string; ok: boolean }
  | { kind: 'asked'; question: string }
  | { kind: 'answered'; text: string }
  | { kind: 'held'; name: string }
  | { kind: 'settled'; how: SettledHow };

export type ScriptedOpts = {
  /** The folder file steps may touch. Required as soon as the script reads or
   *  writes: a fixture is never given the run of the filesystem. */
  root?: string;
  /** What the `cwd` step reports. The real working directory by default. */
  cwd?: () => string;
  /** How a delayed delta waits. Real sleeping by default. */
  wait?: (ms: number) => Promise<void>;
};

export type ScriptedModel = {
  /** How many rounds the script has. */
  readonly rounds: number;
  /** One round's events, in order, waiting on the steps' own barriers. */
  stream(round: number): AsyncGenerator<AgentEvent, void, void>;
  /** The same, collected, for a test that does not need to watch it arrive. */
  events(round: number): Promise<readonly AgentEvent[]>;
  /** What the steps did and saw, oldest first. */
  observations(): readonly Observation[];
  /** True while a step is holding the round open. */
  readonly paused: boolean;
  /** Resolves with the barrier the round is held on, once it is held on one: a
   *  question's own name, or the `hold` step's. Call it before or after. It
   *  times out rather than leaving a test waiting on a question never asked. */
  waiting(timeoutMs?: number): Promise<string>;
  /** Answer the question it is paused on, which lets the round carry on. */
  answer(text: string): void;
  /** The answers given so far, in order. */
  readonly answers: readonly string[];
};

function chunksOf(text: string, size: number): string[] {
  const out: string[] = [];
  for (let at = 0; at < text.length; at += size) out.push(text.slice(at, at + size));
  return out;
}

/** One list of steps per round, in the order the rounds happen. */
export function scriptedModel(
  script: readonly (readonly Step[])[],
  opts: ScriptedOpts = {},
): ScriptedModel {
  const seen: Observation[] = [];
  const answers: string[] = [];
  const wait = opts.wait ?? sleep;
  const where = opts.cwd ?? ((): string => process.cwd());
  let asked = 0;
  let calls = 0;
  let holding: string | null = null;
  const arrivals: ((name: string) => void)[] = [];

  function startedHolding(name: string): void {
    holding = name;
    for (const one of arrivals.splice(0)) one(name);
  }

  /** The folder a file step is allowed in. Not having one is a script mistake,
   *  and said as one rather than writing somewhere surprising. */
  function scope(file: string): string {
    if (opts.root === undefined) {
      throw new Error(`A scripted file step needs the folder it may touch: pass 'root' for ${file}.`);
    }
    return inside(resolve(opts.root), file);
  }

  async function* play(step: Step): AsyncGenerator<AgentEvent, void, void> {
    switch (step.kind) {
      case 'say': {
        const pieces = chunksOf(step.text, step.chunk ?? 24);
        for (const [at, piece] of pieces.entries()) {
          // Between the pieces, not before the first: the first piece is
          // already on the wire when a real stream starts waiting.
          if (at > 0 && step.everyMs !== undefined) {
            await wait(step.everyMs);
            seen.push({ kind: 'waited', ms: step.everyMs });
          }
          yield { type: 'message-delta', text: piece };
        }
        return;
      }
      case 'cwd': {
        seen.push({ kind: 'cwd', cwd: where() });
        return;
      }
      case 'read': {
        const file = scope(step.file);
        const text = await readFile(file, 'utf8');
        seen.push({ kind: 'read', file, text });
        return;
      }
      case 'write': {
        const file = scope(step.file);
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, step.content);
        seen.push({ kind: 'wrote', file, bytes: Buffer.byteLength(step.content) });
        return;
      }
      case 'call': {
        calls += 1;
        const id = `call-${String(calls)}`;
        yield { type: 'tool-start', call: { id, name: step.name, input: step.input ?? {} } };
        const ok = step.fails === undefined;
        seen.push({ kind: 'called', name: step.name, ok });
        yield { type: 'tool-end', id, ok, ...(ok ? {} : { detail: step.fails ?? '' }) };
        return;
      }
      case 'ask': {
        asked += 1;
        const name = step.until ?? `ask-${String(asked)}`;
        const question: Question = {
          question: step.question,
          header: 'Question',
          choices: [],
          many: false,
        };
        seen.push({ kind: 'asked', question: step.question });
        yield { type: 'asked-first', id: name, questions: [question] };
        yield { type: 'waiting-for-you', on: true };
        startedHolding(name);
        await until(name);
        holding = null;
        yield { type: 'waiting-for-you', on: false };
        return;
      }
      case 'hold': {
        seen.push({ kind: 'held', name: step.until });
        startedHolding(step.until);
        await until(step.until);
        holding = null;
        return;
      }
      // A settle ends the round, so `stream` takes it before play is asked.
      case 'settle':
        return;
    }
  }

  async function* stream(round: number): AsyncGenerator<AgentEvent, void, void> {
    yield { type: 'busy', on: true };
    let how: SettledHow = 'finished';
    for (const step of script[round] ?? []) {
      if (step.kind === 'settle') {
        how = step.how ?? 'finished';
        break;
      }
      yield* play(step);
    }
    // A round that finished says so in words first; one that failed or was
    // stopped only settles, which is the shape the adapter emits.
    if (how === 'finished') yield { type: 'message-end' };
    yield { type: 'settled', how };
    seen.push({ kind: 'settled', how });
    yield { type: 'busy', on: false };
  }

  return {
    rounds: script.length,
    stream,
    events: async (round: number): Promise<readonly AgentEvent[]> => {
      const out: AgentEvent[] = [];
      for await (const one of stream(round)) out.push(one);
      return out;
    },
    observations: () => seen,
    get paused(): boolean {
      return holding !== null;
    },
    waiting: async (timeoutMs = 5_000): Promise<string> => {
      if (holding !== null) return holding;
      const arrival = waiter<string>();
      arrivals.push((name) => {
        arrival.done(name);
      });
      return Promise.race([
        arrival.promise,
        sleep(timeoutMs).then(() => {
          throw new Error(
            `The scripted model never held a round within ${String(timeoutMs)}ms.`,
          );
        }),
      ]);
    },
    answer: (text: string): void => {
      answers.push(text);
      seen.push({ kind: 'answered', text });
      if (holding !== null) release(holding);
    },
    get answers(): readonly string[] {
      return answers;
    },
  };
}
