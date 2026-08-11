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
 *
 * The Guard here is the same decision table the main process uses
 * (src/agent/guard/policy.ts): the same deny-by-default floor, the same
 * credential stops, the same outside-the-project refusal. What it does with a
 * confirmation is the one difference, and `review` below is where that is
 * argued out.
 */

import { patchWorkerThreads } from './node-shim';

patchWorkerThreads();

type Job = { task: string; cwd?: string; agentDir?: string };

/** The one channel out. Only JSON lines ever leave, so a parent that reads by
 *  line never has to guess which parts are report and which are noise. The
 *  shapes are the `SubagentLine` contract in tools.ts. */
function report(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload)}\n`);
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

/** What the model is told when the helper will not do something. The same words
 *  come back as the tool's error text, the same way a denial in the main
 *  session does. */
const DECLINED =
  'This could not be done by a helper: helpers cannot ask questions or change anything. Report what you found and let the main agent decide.';

/** The only tools this process may run at all — a second lock on the `tools:`
 *  list below, so anything a resource or a Pi upgrade registers is blocked by
 *  name rather than allowed by omission. */
const ALLOWED_TOOLS = new Set(['read', 'ls', 'grep', 'find', 'websearch', 'webfetch']);

async function main(): Promise<number> {
  let job: Job;
  try {
    job = await readJob();
  } catch (cause) {
    report({ type: 'done', outcome: { ok: false, error: messageOf(cause) } });
    return 1;
  }

  const cwd = job.cwd ?? process.cwd();
  const agentDir = job.agentDir ?? '';
  const facts = { projectRoot: cwd };

  // Everything Pi and the policy modules take to load is done before any
  // question can be answered, so the child either has all of it or fails with a
  // single sentence. The Pi load is the same dynamic import the adapter uses —
  // nothing of Pi exists in this process until a job actually arrives.
  const pi = await import('@earendil-works/pi-coding-agent');
  const { websearchTool, webfetchTool } = await import('./tools.ts');
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
  const review = async (call: { id: string; name: string; input: Record<string, unknown> }) => {
    if (!ALLOWED_TOOLS.has(call.name.toLowerCase())) return { block: true, reason: DECLINED };
    const verdict = evaluate(call, facts);
    if (verdict.kind === 'deny') return { block: true, reason: verdict.reason };
    if (changesAnything(call, facts)) return { block: true, reason: DECLINED };
    return undefined;
  };

  // The helper's Guard is a resource-layer hook rather than a session option:
  // extension factories plug into the resource loader, exactly as the main
  // session wires them.
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

  const relay = new EventRelay((event) => {
    if (event.type === 'message-delta') {
      spoken += event.text;
      report({ type: 'delta', text: event.text });
    }
    if (event.type === 'error') finish({ ok: false, error: event.message });
    if (event.type === 'settled') {
      finish({ ok: true, text: spoken.trim() });
    }
  });

  try {
    const created = await pi.createAgentSession({
      cwd,
      agentDir,
      // The read-only built-ins, by name — no shell, no edits, no writes.
      tools: ['read', 'ls', 'grep', 'find'],
      customTools: [websearchTool, webfetchTool],
      sessionManager: pi.SessionManager.inMemory(cwd),
      settingsManager: pi.SettingsManager.create(cwd, agentDir),
      resourceLoader: loader,
    });
    session = created.session;
    const unsubscribe = created.session.subscribe((event) => relay.fromPi(event));

    await created.session.prompt(job.task.trim());

    // A run that was refused outright can resolve with no `settled` to follow.
    // Give the event a beat to land, then answer with whatever did.
    await new Promise((wake) => setTimeout(wake, 250));
    if (!finished) finish({ ok: true, text: spoken.trim() });
    unsubscribe();
  } catch (cause) {
    finish({ ok: false, error: messageOf(cause) });
  }

  return 0;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'The helper stopped before it finished.';
}

void main().then((code) => {
  // The report has been written by the time main resolves; give the pipe a
  // moment to drain before the process goes.
  setTimeout(() => process.exit(code), 50);
}, () => {
  process.exit(1);
});