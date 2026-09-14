/** E04: the probe runs in a process that can be ended.
 *
 * An add-on's factory is somebody else's code and a trusted one may never
 * yield, so nothing that happens on the probing thread can end it. The card is
 * worth less than the app being able to answer, so the deadline is kept by a
 * parent that is free to keep it: the child is killed and the add-on is read as
 * unknown.
 *
 * Two halves, proven separately. The stand-in programs here are the parent's
 * half — the deadline, the kill, and the reading of an answer. `probeLine` is
 * the child's half — the recording, the stub and the line it writes — because a
 * stand-in cannot prove that.
 */

import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { afterAll, afterEach, describe, expect, it } from 'vitest';

import {
  PROBE_MARKER,
  cardFrom,
  probe,
  probeInChild,
  probeProgram,
} from '../src/agent/pi/extension-probe';
import { probeLine } from '../src/agent/pi/probe-runner';

const at = (name: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${name}/index.mjs`, import.meta.url));

const made: string[] = [];
const named = process.env['GRAPHE_PROBE_PROGRAM'];

afterEach(() => {
  if (named === undefined) delete process.env['GRAPHE_PROBE_PROGRAM'];
  else process.env['GRAPHE_PROBE_PROGRAM'] = named;
});

afterAll(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'graphe-probe-child-'));
  made.push(dir);
  return dir;
}

/** Whether a process is still there. Signal 0 asks without sending one. */
function stillRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** A program that holds the thread for ever, after saying which process it is. */
async function programThatSpins(pidFile: string): Promise<string> {
  const file = join(await scratch(), 'spins.mjs');
  await writeFile(
    file,
    `import { writeFileSync } from 'node:fs';
writeFileSync(${JSON.stringify(pidFile)}, String(process.pid));
for (;;) {}
`,
    'utf8',
  );
  return file;
}

/** A program that answers the way the child does, with a recording of ours. */
async function programThatAnswers(recorded: unknown): Promise<string> {
  const file = join(await scratch(), 'answers.mjs');
  await writeFile(
    file,
    `process.stdout.write(${JSON.stringify(`${PROBE_MARKER}${JSON.stringify({ recorded })}`)} + '\\n', () => process.exit(0));
`,
    'utf8',
  );
  return file;
}

/* -------------------------------------------------------------------------- */

describe('a factory that never yields', () => {
  it('is killed, and costs a card rather than the app', async () => {
    const pidFile = join(await scratch(), 'pid');
    const program = await programThatSpins(pidFile);
    const answering = await programThatAnswers({
      id: 'read-while-that-one-was-held',
      hooks: [],
      tools: [],
      commands: [],
      sentTurns: false,
      source: '',
    });

    // Two reads at once, one of them held for ever by its own child. The other
    // finishes while the first is still running, which is the claim: the thread
    // the shell answers on is not the one a factory is holding. Under the old
    // in-process probe this could not finish at all.
    const began = Date.now();
    const held = probeInChild(program, at('spins'), 900);
    const read = await probeInChild(answering, at('plain'), 8000);

    expect(read?.id).toBe('read-while-that-one-was-held');
    await expect(held).resolves.toBeNull();
    expect(Date.now() - began).toBeLessThan(8000);

    const pid = Number(await readFile(pidFile, 'utf8'));
    expect(Number.isInteger(pid)).toBe(true);
    expect(stillRunning(pid)).toBe(false);
  }, 30_000);

  it('is not left behind to be read a second time', async () => {
    const pidFile = join(await scratch(), 'pid');
    const program = await programThatSpins(pidFile);

    // Long enough that the child has certainly started and written its pid
    // before the deadline takes it: what this proves is that it is gone
    // afterwards, not that a cold Node starts inside a stopwatch.
    await probeInChild(program, at('spins'), 1500);
    const pid = Number(await readFile(pidFile, 'utf8'));

    // The same again, and the first child is still gone: nothing accumulates
    // when somebody reopens the screen that reads these cards.
    await probeInChild(program, at('spins'), 1500);
    expect(stillRunning(pid)).toBe(false);
  }, 20_000);
});

/* -------------------------------------------------------------------------- */

describe('an answer from the child', () => {
  const recorded = {
    id: 'from-a-child',
    hooks: ['agent_end'],
    tools: [{ name: 'stand_in', description: 'A tool no fixture registered.' }],
    commands: ['hello'],
    sentTurns: false,
    source: '',
  };

  it('is read as the card the parent hands on', async () => {
    const program = await programThatAnswers(recorded);
    const card = await probeInChild(program, at('plain'), 4000);

    expect(card?.id).toBe('from-a-child');
    expect(card?.tools).toEqual(['stand_in']);
    expect(card?.commands).toEqual(['hello']);
  }, 20_000);

  it('is what the probe reaches for, once a program has been named', async () => {
    const program = await programThatAnswers(recorded);
    process.env['GRAPHE_PROBE_PROGRAM'] = program;

    // The fixture registers `count_words`; this answer does not. Which one came
    // back is the whole point: with a program named, the factory is not run
    // here at all.
    const card = await probe(at('plain'));
    expect(card?.id).toBe('from-a-child');
    expect(card?.tools).toEqual(['stand_in']);
  }, 20_000);

  it('is nothing when the child says nothing this understands', async () => {
    const file = join(await scratch(), 'garbage.mjs');
    await writeFile(
      file,
      `console.log('a factory logging is not a card');
process.exit(0);
`,
      'utf8',
    );
    await expect(probeInChild(file, at('plain'), 4000)).resolves.toBeNull();
  }, 20_000);

  it('does not answer with a half-written line as a card', async () => {
    const file = join(await scratch(), 'half.mjs');
    await writeFile(
      file,
      `process.stdout.write(${JSON.stringify(PROBE_MARKER)} + '{"recorded":{"hooks":'); process.exit(0);
`,
      'utf8',
    );
    await expect(probeInChild(file, at('plain'), 4000)).resolves.toBeNull();
  }, 20_000);

  it('wins over a marker-shaped line the factory printed first', async () => {
    const file = join(await scratch(), 'also-marks.mjs');
    // A factory that logs something starting with the marker, which the child
    // prints before its own answer. Both lines are of the shape the parent
    // reads, and only the later one is the answer.
    const own = `${PROBE_MARKER}${JSON.stringify({
      recorded: { ...recorded, id: 'a-line-the-factory-printed' },
    })}`;
    await writeFile(
      file,
      `process.stdout.write(${JSON.stringify(own)} + '\\n');
process.stdout.write(${JSON.stringify(`${PROBE_MARKER}${JSON.stringify({ recorded })}`)} + '\\n', () => process.exit(0));
`,
      'utf8',
    );

    const card = await probeInChild(file, at('plain'), 4000);
    expect(card?.id).toBe('from-a-child');
  }, 20_000);

  it('is still read when the factory logged more than the parent keeps', async () => {
    const file = join(await scratch(), 'chatty.mjs');
    // Past a megabyte of logging, in whole lines, before the answer. Keeping
    // the front of that output would keep only the logging and lose the card.
    await writeFile(
      file,
      `process.stdout.write('an add-on saying something\\n'.repeat(${String(1 << 17)}));
process.stdout.write(${JSON.stringify(`${PROBE_MARKER}${JSON.stringify({ recorded })}`)} + '\\n', () => process.exit(0));
`,
      'utf8',
    );

    const card = await probeInChild(file, at('plain'), 8000);
    expect(card?.id).toBe('from-a-child');
    expect(card?.tools).toEqual(['stand_in']);
  }, 30_000);

  it('is not held up by a factory that fills the error pipe', async () => {
    const file = join(await scratch(), 'loud-stderr.mjs');
    // Far past what a pipe holds, written before the answer and written again
    // only once that has gone through. A parent that never reads stderr never
    // sees the answer: this one costs the deadline and comes back with nothing.
    await writeFile(
      file,
      `process.stderr.write('an add-on complaining\\n'.repeat(${String(1 << 17)}), () => {
  process.stdout.write(${JSON.stringify(`${PROBE_MARKER}${JSON.stringify({ recorded })}`)} + '\\n', () => process.exit(0));
});
`,
      'utf8',
    );

    const began = Date.now();
    const card = await probeInChild(file, at('plain'), 4000);
    expect(card?.id).toBe('from-a-child');
    expect(Date.now() - began).toBeLessThan(4000);
  }, 20_000);
});

/* -------------------------------------------------------------------------- */

describe('the child itself', () => {
  it('writes down a factory that only adds tools', async () => {
    const line = await probeLine(at('plain'));
    const read = JSON.parse(line.slice(PROBE_MARKER.length)) as { recorded: unknown };

    expect(cardFrom(read.recorded as never)?.tools).toEqual(['count_words', 'spell_check']);
  });

  it('writes down an add-on that cannot be read as nothing at all', async () => {
    for (const which of ['throws', 'no-such-add-on']) {
      const line = await probeLine(at(which));
      const read = JSON.parse(line.slice(PROBE_MARKER.length)) as { recorded: unknown };
      expect(read.recorded).toBeNull();
    }
  });

  it('is started from the path the build puts it at, beside the shell', async () => {
    delete process.env['GRAPHE_PROBE_PROGRAM'];
    const program = probeProgram();
    // Either the built one, or none at all: never a path that is not there.
    expect(program === null || existsSync(program)).toBe(true);
    if (program !== null) expect(program.endsWith('probe-runner.mjs')).toBe(true);
  });

  it('is named by the environment when a copy of the app has not been built', async () => {
    const program = await programThatAnswers(null);
    process.env['GRAPHE_PROBE_PROGRAM'] = program;
    expect(probeProgram()).toBe(program);

    process.env['GRAPHE_PROBE_PROGRAM'] = join(await scratch(), 'not-here.mjs');
    expect(probeProgram()).toBeNull();
  });
});

/* -------------------------------------------------------------------------- */

describe('the program the app actually ships', () => {
  /** The runner as `scripts/build-electron.mjs` makes it: one file, bundled,
   *  ESM for Node, started by path. esbuild comes with Vite, which is how the
   *  app is built — and the options here are the ones that build uses for it. */
  async function builtRunner(): Promise<string> {
    const out = join(await scratch(), 'probe-runner.mjs');
    await build({
      entryPoints: [fileURLToPath(new URL('../src/agent/pi/probe-runner.ts', import.meta.url))],
      outfile: out,
      bundle: true,
      platform: 'node',
      target: 'node20',
      format: 'esm',
      minify: false,
      logLevel: 'silent',
      banner: {
        js: [
          "import { createRequire as __createRequire } from 'node:module';",
          'const require = __createRequire(import.meta.url);',
        ].join('\n'),
      },
    });
    return out;
  }

  it('reads a factory for real, through a process of its own', async () => {
    const program = await builtRunner();
    process.env['GRAPHE_PROBE_PROGRAM'] = program;

    const card = await probe(at('plain'));
    expect(card?.tools).toEqual(['count_words', 'spell_check']);
    expect(card?.commands).toEqual(['spell']);
  }, 30_000);

  it('comes back with nothing, and kills the child, when the factory never yields', async () => {
    const program = await builtRunner();

    // The stopwatch is the point of this one: the fixture holds its thread for
    // ever, and the answer is the deadline rather than the factory. Nothing on
    // this side of the process boundary could have ended it.
    const began = Date.now();
    await expect(probeInChild(program, at('spins'), 800)).resolves.toBeNull();
    expect(Date.now() - began).toBeLessThan(6000);
  }, 30_000);
});

/* -------------------------------------------------------------------------- */

describe('a child that cannot be started at all', () => {
  it('is a card nobody could read, rather than a failure', async () => {
    const missing = join(await scratch(), 'not-a-program.mjs');
    // A file that does not exist is what a copy of the app with a half-written
    // build looks like, and it must not be the end of discovery.
    await expect(probeInChild(missing, at('plain'), 4000)).resolves.toBeNull();
  }, 20_000);
});
