/** A child of this app has to be able to run.
 *
 * Graphe is an Electron process, so `process.execPath` is Electron rather than
 * node. Anything that spawns "the runtime I am running under" — an add-on
 * starting a fresh agent, a tool shelling out to pi — gets Electron, and
 * Electron handed a script starts a whole second application: a GPU process, a
 * network service, a window that never appears. From a terminal that happens to
 * work. From inside a running Electron app it hangs, forever, with nothing on
 * stdout.
 *
 * That is what "the subagent produced no output" was. Not a model that said
 * nothing — a child that was never a child.
 *
 * One variable fixes it, and it is the one Electron documents for exactly this:
 * `ELECTRON_RUN_AS_NODE` makes the same binary behave as the node it embeds.
 *
 * ## Why this is a patch and not a setting
 *
 * The obvious fix — set it on `process.env` so every child inherits it — takes
 * the app down. Electron reads that variable when it starts a renderer, so a
 * window created afterwards comes up as a node process with no page in it. It
 * was tried; nothing rendered.
 *
 * So it is applied at the one place it is needed: a spawn whose command is this
 * binary. Everything else is left exactly as it was. Same seam as
 * `node-shim.ts`, and for the same reason — the code that needs fixing is
 * somebody else's and is not going to change.
 *
 * No add-on is named anywhere here. One published tomorrow gets a working
 * environment on the same terms as one installed today.
 */

import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

/** The variable Electron reads to behave as the node it embeds. */
export const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE';

/**
 * Whether a command is the binary this process is running under.
 *
 * By path, not by name: a spawn of `node` is a spawn of node, and only the
 * thing that is really Electron needs telling what it is.
 */
export function isOurOwnRuntime(command: unknown, execPath: string): boolean {
  return typeof command === 'string' && command !== '' && command === execPath;
}

/**
 * Whether this process is Electron at all.
 *
 * Asked of `process.versions`, never of the path. A packaged app's binary is
 * `Graphe.app/Contents/MacOS/Graphe` — the word "electron" appears nowhere in
 * it, so a path check is a check that passes in development and quietly fails
 * in every shipped copy, which is the worst shape a check can have.
 *
 * A test under vitest is a plain node, and telling a plain node child that it
 * is Electron helps nobody.
 */
export function underElectron(_execPath: string, versions: NodeJS.ProcessVersions): boolean {
  return typeof versions.electron === 'string' && versions.electron !== '';
}

/** The options a spawn of our own runtime should really have. Additive: a child
 *  of this app is meant to see the same world this app sees. */
export function optionsForOurRuntime<T extends { env?: NodeJS.ProcessEnv }>(
  options: T | undefined,
  env: NodeJS.ProcessEnv,
): T {
  const already = options?.env ?? env;
  return { ...(options ?? ({} as T)), env: { ...already, [RUN_AS_NODE]: '1' } };
}

/* -------------------------------------------------------------------------- */
/* Somewhere of its own to write                                               */
/* -------------------------------------------------------------------------- */

/** Folders a child started inside should write its temporary files under, by
 *  the folder it runs in. Longest match wins, so a checkout inside a project
 *  gets its own rather than the project's. */
const scratchAt = new Map<string, string>();

/** Say where a child running in `folder` should put anything temporary. */
export function scratchUnder(folder: string, scratch: string): void {
  scratchAt.set(folder, scratch);
}

export function forgetScratch(folder: string): void {
  scratchAt.delete(folder);
}

/** The scratch folder for a child running here, or null when nothing claims it. */
export function scratchIn(cwd: string | undefined): string | null {
  if (typeof cwd !== 'string' || cwd === '') return null;
  let best: string | null = null;
  let nearest: string | null = null;
  for (const [folder, scratch] of scratchAt) {
    if (cwd !== folder && !cwd.startsWith(`${folder}/`)) continue;
    // The nearest claim wins: a checkout sits inside its project, and the
    // project's folder would otherwise swallow every conversation's.
    if (nearest === null || folder.length > nearest.length) {
      nearest = folder;
      best = scratch;
    }
  }
  return best;
}

/** The options a child should really have: its own place for temporary files,
 *  unless whoever spawned it already said where. */
export function optionsWithScratch<T extends { cwd?: unknown; env?: NodeJS.ProcessEnv }>(
  options: T | undefined,
  env: NodeJS.ProcessEnv,
): T | undefined {
  const cwd = typeof options?.cwd === 'string' ? options.cwd : undefined;
  const scratch = scratchIn(cwd);
  if (scratch === null) return options;
  const already = options?.env ?? env;
  if (typeof already['TMPDIR'] === 'string' && already['TMPDIR'].startsWith(scratch)) return options;
  return {
    ...(options ?? ({} as T)),
    env: { ...already, TMPDIR: scratch, TMP: scratch, TEMP: scratch },
  };
}

/** Set once, so a second call is free. */
let patched = false;

/**
 * Make every spawn of this binary a spawn of node.
 *
 * Wraps `spawn`, `spawnSync`, `execFile` and `execFileSync` on the shared
 * `child_process` module — the one every add-on in this process reaches for.
 * Only a command equal to `process.execPath` is touched; everything else is
 * handed straight through.
 */
export function letChildrenRunAsNode(
  execPath: string = process.execPath,
  versions: NodeJS.ProcessVersions = process.versions,
): boolean {
  if (patched || !underElectron(execPath, versions)) return false;
  patched = true;

  /* `import.meta.url` is the right anchor and is always there in the ESM this
     ships as — but it is undefined the moment anything bundles this file to
     CJS, and a patch that throws on load takes the app with it. The binary's
     own path is a real absolute path and answers the same question. */
  const from = import.meta.url ?? pathToFileURL(execPath).href;
  const children = createRequire(from)('node:child_process') as Record<
    string,
    (...args: unknown[]) => unknown
  >;

  for (const name of ['spawn', 'spawnSync', 'execFile', 'execFileSync']) {
    const before = children[name];
    if (typeof before !== 'function') continue;
    children[name] = function patchedSpawn(this: unknown, ...args: unknown[]): unknown {
      /* The options are the last argument that is a plain object, and the
         signature allows it in two places — `(cmd, args, options)` and
         `(cmd, options)`. Found rather than assumed, because guessing wrong
         means dropping somebody's cwd. */
      const at = args.length >= 2 && isOptions(args[args.length - 1]) ? args.length - 1 : -1;
      const options =
        at === -1 ? undefined : (args[at] as { cwd?: unknown; env?: NodeJS.ProcessEnv });
      const ours = isOurOwnRuntime(args[0], execPath);
      let fixed = optionsWithScratch(options, process.env);
      if (ours) fixed = optionsForOurRuntime(fixed, process.env);
      if (fixed === options) return before.apply(this, args);
      if (at === -1) return before.apply(this, [...args, fixed]);
      const next = [...args];
      next[at] = fixed;
      return before.apply(this, next);
    } as typeof before;
  }
  return true;
}

/** A plain options object, told apart from an argument array and a callback. */
function isOptions(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
