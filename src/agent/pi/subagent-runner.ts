/** The helper agent: a child process with its own clean context.
 *
 * Spawned by the `task` tool (src/agent/pi/tools.ts) through Electron's own
 * binary under `ELECTRON_RUN_AS_NODE=1` — which is just Node, including
 * Electron's Node quirks, which is why the Pi patch in node-shim.ts runs first
 * here too.
 *
 * Everything about this process is a boundary:
 *
 *  - It never touches this conversation, this session, or this process's
 *    memory. It starts blank, hears one job on stdin, and leaves.
 *  - It cannot change the project. It gets the four read-only built-ins by
 *    name (`read`, `ls`, `grep`, `find`) plus the two web tools, and its Guard
 *    blocks anything that changes anything — no shell, no writes, and no
 *    question that could hang a process with nobody to ask.
 *  - It reports in plain JSON lines on stdout and nothing else. Whatever the
 *    parent does not read is not sent.
 *  - Underneath all of that it is wrapped in whatever boundary the computer
 *    itself can hold around it, and it checks that from in here rather than
 *    trusting a clean start (src/agent/sandbox/).
 *
 * The Guard here is the same decision table the main process uses
 * (src/agent/guard/policy.ts): the same deny-by-default floor, the same
 * credential stops, the same outside-the-project refusal. What it does with a
 * confirmation is the one difference, and `review` below is where that is
 * argued out.
 */

import { rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { mayRun, roleSpec, safeChildWords, type HelperRole } from './child';
import { CARRY_ON, isTransientStreamError, WAITS_MS } from './transient';
import { patchWorkerThreads } from './node-shim';
import type { HelperPace } from './tools';
import type { GuardFacts } from '../guard/policy';

patchWorkerThreads();

type Job = {
  task: string;
  cwd?: string;
  agentDir?: string;
  /** Who to think with. Without it Pi falls back to its own settings, which in
   *  this app nobody has ever written — and a session with no model answers
   *  nothing at all, which is what a helper saying nothing looked like. */
  model?: { providerId: string; modelId: string } | null;
  /** How long to think first. The child has no preferences of its own, so the
   *  pace chosen in the window travels with the job. Pi clamps a level this
   *  model cannot use. */
  thinking?: HelperPace;
  /** A file outside everything this process should be able to touch. Named by
   *  the parent so the answer means something to it. */
  outside?: string;
  /** What kind of helper this is: its tools and instructions come from the
   *  role, and the child never holds more than the role allows. */
  role?: HelperRole;
};

/** The job arrives as JSON on a pipe, so nothing in it is trusted to be what it
 *  says. An unrecognised pace is left off rather than passed on. */
const PACES: readonly HelperPace[] = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

function paceOf(value: unknown): HelperPace | undefined {
  return PACES.find((level) => level === value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** The one channel out. Only JSON lines ever leave, so a parent that reads by
 *  line never has to guess which parts are report and which are noise. The
 *  shapes are the `SubagentLine` contract in tools.ts. */
function report(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
}

/**
 * Try to reach outside the folder this process was given, and say what happened.
 *
 * The parent asks the computer to hold this process inside one folder, and a
 * boundary that failed to load starts exactly as cleanly as one that worked. The
 * only answer worth having comes from in here, trying it.
 */
function tellBoundary(outside: unknown): void {
  if (typeof outside !== 'string' || outside.trim() === '') return;
  try {
    writeFileSync(outside, '');
    rmSync(outside, { force: true });
    report({ type: 'boundary', held: false });
  } catch {
    report({ type: 'boundary', held: true });
  }
}

function readJob(): Promise<Job> {
  return new Promise((resolve, reject) => {
    let input = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (chunk: string) => {
      input += chunk;
    });
    process.stdin.on('end', () => {
      try {
        const job = JSON.parse(input) as Job;
        if (typeof job.task !== 'string' || job.task.trim() === '') {
          reject(new Error('The helper was handed an empty piece of work.'));
          return;
        }
        resolve(job);
      } catch {
        reject(new Error('The helper did not understand what it was asked to do.'));
      }
    });
    process.stdin.on('error', reject);
  });
}

/** No account reached the child. Said as a failure rather than an empty answer:
 *  the parent turns this into the tool's error text, so the model reads it and
 *  says something true instead of reporting a finding it never made. */
const NO_MODEL =
  'The helper had nothing to think with — no account reached it. Nothing was looked at.';

/** A helper that ran and said nothing is not a helper that found nothing. */
const SAID_NOTHING =
  'The helper finished without saying anything. Nothing was found, and nothing was changed.';

/** The only tools this process may run at all — a second lock on the `tools:`
 *  list below, so anything a resource or a Pi upgrade registers is blocked by
 *  name rather than allowed by omission. */
async function main(): Promise<number> {
  let job: Job;
  try {
    job = await readJob();
  } catch (cause) {
    report({ type: 'done', outcome: { ok: false, error: messageOf(cause) } });
    return 1;
  }

  tellBoundary(job.outside);

  const cwd = job.cwd ?? process.cwd();
  const agentDir = job.agentDir ?? '';
  // The helper reads its own skills too — the same folder, the same reason.
  const facts = agentDir === '' ? { projectRoot: cwd } : { projectRoot: cwd, agentFolder: agentDir };

  try {
    return await work(job, cwd, agentDir, facts, roleSpec(job.role));
  } catch (cause) {
    // Everything below used to sit outside a try: a package that would not load
    // or a resource folder that would not read exited mute, and the parent could
    // only guess from whatever the last line of stderr happened to be.
    report({ type: 'done', outcome: { ok: false, error: messageOf(cause) } });
    return 1;
  }
}

async function work(
  job: Job,
  cwd: string,
  agentDir: string,
  facts: GuardFacts,
  spec: ReturnType<typeof roleSpec>,
): Promise<number> {

  // Everything Pi and the policy modules take to load is done before any
  // question can be answered, so the child either has all of it or fails with a
  // single sentence. The Pi load is the same dynamic import the adapter uses —
  // nothing of Pi exists in this process until a job actually arrives.
  const pi = await import('@earendil-works/pi-coding-agent');
  const { websearchTool, webfetchTool } = await import('./tools.ts');
  const helperTools = [websearchTool, webfetchTool];
  const { EventRelay } = await import('./events.ts');
  const { evaluate, changesAnything } = await import('../guard/policy.ts');

  /**
   * A `confirm` cannot be parked here — no window, nobody to ask — and
   * refusing it refuses work the person already agreed to: the `task` question
   * told them the helper reads the project and searches the web. Every
   * `websearch` and `webfetch` evaluates to `confirm`, so refusing left the
   * helper advertising tools it could never use.
   *
   * Saying yes on their behalf is safe because the confirmation is not what
   * keeps this process harmless: the name list and `changesAnything` are. A
   * `snapshot-first` verdict is mutating by construction, and so is the
   * deny-by-default `confirm` an unrecognised tool gets, so both are blocked
   * before anything runs. A `deny` — credentials, anywhere outside the project
   * folder, a key on its way out — is still a deny.
   */
  const review = async (call: { id: string; name: string; input: Record<string, unknown> }) =>
    mayRun(spec, call, evaluate(call, facts), changesAnything(call, facts), facts.projectRoot);

  // The helper's Guard is a resource-layer hook rather than a session option:
  // extension factories plug into the resource loader, exactly as the main
  // session wires them.
  /* The same credentials the window signed in with, read from the same two
     files. Without this the child builds a runtime against the default agent
     folder, which in a packaged app is not where the account lives. */
  const runtime = await pi.ModelRuntime.create(
    agentDir === ''
      ? {}
      : { authPath: join(agentDir, 'auth.json'), modelsPath: join(agentDir, 'models.json') },
  );

  const pace = paceOf(job.thinking);
  const chosen = job.model ?? null;
  let model: ReturnType<typeof runtime.getAvailableSnapshot>[number] | undefined;
  if (chosen === null) {
    model = runtime.getAvailableSnapshot()[0];
  } else {
    model = runtime.getModel(chosen.providerId, chosen.modelId);
    if (model === undefined) {
      report({
        type: 'done',
        outcome: {
          ok: false,
          error: `The model you selected (${chosen.providerId}/${chosen.modelId}) is not available for this helper — it may have been removed or renamed. Select a model that is available and try again.`,
        },
      });
      return 1;
    }
  }

  // Said rather than survived. A helper with nothing to think with used to
  // finish quietly with an empty answer, which read as "it worked and found
  // nothing" — the most expensive possible way to be wrong.
  if (model === undefined) {
    report({
      type: 'done',
      outcome: {
        ok: false,
        error: NO_MODEL,
      },
    });
    return 1;
  }

  const loader = new pi.DefaultResourceLoader({
    cwd,
    agentDir,
    noExtensions: true,
    noThemes: true,
    extensionFactories: [
      {
        name: 'graphe-subagent-guard',
        factory: (api) => {
          api.on('tool_call', async (event) =>
            review({ id: event.toolCallId, name: event.toolName, input: { ...event.input } }),
          );
        },
      },
    ],
  });
  await loader.reload();

  let session: { dispose: () => void } | null = null;
  let finished = false;
  let spoken = '';

  /** One answer, however the run ends: the settled event, a failure, or the
   *  prompt resolving without either. The guard means the first one wins. */
  const finish = (outcome: { ok: true; text: string } | { ok: false; error: string }): void => {
    if (finished) return;
    finished = true;
    report({ type: 'done', outcome });
    session?.dispose();
  };

  /** A failure caught on its way out while there are still waits left. */
  let heldBackTrouble: string | null = null;
  let waitsLeft = 0;
  const relay = new EventRelay((event) => {
    if (event.type === 'message-delta') {
      spoken += event.text;
      report({ type: 'delta', text: safeChildWords(event.text) });
    }
    // Nobody else can see this. The helper calls the account from its own
    // process, so unless it says what a turn cost, a fan-out to six helpers is
    // money that never reaches a meter or a ceiling.
    if (event.type === 'spend') {
      report({ type: 'spend', amount: event.amount, label: event.label, reason: event.reason });
    }
    if (event.type === 'error') {
      // The engine reports a provider failure by settling the turn with it, not
      // by throwing, so this is where a helper actually dies. Held while there
      // are waits left to spend, or a fan-out of six loses one to a busy minute.
      if (waitsLeft > 0 && isTransientStreamError(event.message)) {
        heldBackTrouble = event.message;
        return;
      }
      finish({ ok: false, error: event.message });
    }
    if (event.type === 'settled') {
      const said = safeChildWords(spoken.trim());
      finish(said === '' ? { ok: false, error: SAID_NOTHING } : { ok: true, text: said });
    }
  });

  try {
    const created = await pi.createAgentSession({
      cwd,
      agentDir,
      // The read-only built-ins, by name — no shell, no edits, no writes.
      // Naming `tools` at all makes it an absolute allowlist that custom tools
      // are filtered through too, so the two web tools have to be in it or they
      // are registered and immediately dropped — which is how a helper sent to
      // research something ended up able to read local files and nothing else.
      tools: [...spec.tools],
      customTools: helperTools.filter((tool) => spec.tools.includes(tool.name)),
      modelRuntime: runtime,
      model,
      ...(pace === undefined ? {} : { thinkingLevel: pace }),
      sessionManager: pi.SessionManager.inMemory(cwd),
      settingsManager: pi.SettingsManager.create(cwd, agentDir),
      resourceLoader: loader,
    });
    session = created.session;
    const unsubscribe = created.session.subscribe((event) => relay.fromPi(event));

    // A busy provider settles the turn with the failure on it rather than
    // throwing, so both endings are read the same way and waited the same way.
    let words = `${spec.spoken}\n\n${job.task.trim()}`;
    for (let attempt = 0; ; attempt += 1) {
      heldBackTrouble = null;
      waitsLeft = WAITS_MS.length - attempt;
      try {
        await created.session.prompt(words);
      } catch (cause) {
        if (!isTransientStreamError(cause)) throw cause;
        heldBackTrouble = cause instanceof Error ? cause.message : String(cause);
      } finally {
        waitsLeft = 0;
      }
      const trouble = heldBackTrouble;
      heldBackTrouble = null;
      if (trouble === null) break;
      if (attempt >= WAITS_MS.length) {
        finish({ ok: false, error: trouble });
        break;
      }
      await sleep(WAITS_MS[attempt] ?? 0);
      words = CARRY_ON;
    }

    // A run that was refused outright can resolve with no `settled` to follow.
    // Give the event a beat to land, then answer with whatever did.
    await new Promise((wake) => setTimeout(wake, 250));
    if (!finished) {
      const said = safeChildWords(spoken.trim());
      finish(said === '' ? { ok: false, error: SAID_NOTHING } : { ok: true, text: said });
    }
    unsubscribe();
  } catch (cause) {
    finish({ ok: false, error: messageOf(cause) });
  }

  return 0;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'The helper stopped before it finished.';
}

void main().then(leave, () => leave(1));

/**
 * Wait for the report to actually reach the parent.
 *
 * `process.exit` throws away whatever is still sitting in the pipe, and stdout
 * to a pipe is asynchronous — so a fifty-millisecond timer was a hope, not a
 * guarantee. A helper's answer is one long JSON line, which is exactly the
 * shape that gets cut in half: the parent could not parse it, kept nothing, and
 * reported a helper that had finished without saying anything.
 *
 * Setting `exitCode` and letting the loop empty is the version that cannot lose
 * the answer. What is left is the backstop, and it used to be a deadline: five
 * seconds, then leave. A parent busy for six is not a parent that will never
 * read — it is the app opening another conversation, which takes longer than
 * that — and the answer was cut in half for it. So the backstop waits on
 * movement instead of on the clock: as long as the pipe is emptying, however
 * slowly, the answer is still arriving.
 */
const NOTHING_MOVING_MS = 20_000;

function leave(code: number): void {
  process.exitCode = code;
  if (process.stdout.writableLength === 0) return;

  let left = process.stdout.writableLength;
  const give = setInterval(() => {
    const now = process.stdout.writableLength;
    if (now === 0) {
      clearInterval(give);
      return;
    }
    if (now < left) {
      // Still going out. However long it takes, it is not lost.
      left = now;
      return;
    }
    clearInterval(give);
    process.exit(code);
  }, NOTHING_MOVING_MS);
  // Never the reason this stays up: a drained pipe ends the process on its own.
  give.unref();
  process.stdout.once('drain', () => {
    clearInterval(give);
  });
}