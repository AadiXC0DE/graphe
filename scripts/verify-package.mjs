// Opens the thing we just built and checks it is actually the thing we meant.
//
//   node scripts/verify-package.mjs
//
// Packaging failures are the quietest failures in the project. Everything else
// breaks in front of somebody who can fix it; a bad bundle breaks on a
// stranger's laptop, three weeks later, in a sentence they cannot act on. The
// two that are worth spending a minute of build time on:
//
//   1. **The agent runtime did not make it in.** `scripts/build-electron.mjs`
//      leaves `@earendil-works/pi-coding-agent` external on purpose, so it has
//      to arrive through electron-builder's dependency copy instead. If that
//      does not happen, the app installs, opens, draws its window and says "I
//      could not start the part of me that does the work" the moment somebody
//      opens a folder — which reads exactly like a missing account, and will be
//      diagnosed as one.
//
//   2. **The bundle is unsigned.** On Apple Silicon an unsigned app is killed
//      by the kernel with no dialog at all. `mac.identity: null` skips signing;
//      scripts/adhoc-sign.mjs puts an ad-hoc signature back. If that hook ever
//      stops running, every arm64 build is dead on arrival and nothing else in
//      the pipeline notices.
//
// So this asserts both, on the real artifacts, by looking inside them.

import { execFile } from 'node:child_process';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

import * as asar from '@electron/asar';

const run = promisify(execFile);
const root = fileURLToPath(new URL('..', import.meta.url));
const releaseDir = join(root, 'release');

const PI = '@earendil-works/pi-coding-agent';

const problems = [];
function fault(message) {
  problems.push(message);
  console.error(`  ✗ ${message}`);
}
function pass(message) {
  console.log(`  ✓ ${message}`);
}

async function exists(path) {
  return (await stat(path).catch(() => null)) !== null;
}

async function sizeOf(path) {
  const { stdout } = await run('du', ['-sk', path]);
  const kb = Number.parseInt(stdout.trim().split(/\s+/)[0] ?? '0', 10);
  return `${(kb / 1024).toFixed(0)} MB`;
}

/** Every package reachable from `roots` inside an asar, and anything it declares
 *  but cannot find. Node's own rule: a package resolves in the nearest
 *  `node_modules` at or above the dependent, so a hoisted copy at the archive's
 *  top level satisfies a dependency declared deep inside Pi.
 *
 *  Read from the archive listing rather than by walking `app.asar.unpacked`,
 *  which is why this works for both architectures on a one-architecture machine.
 *  Manifest bytes come through `extractFile`, read only for the packages the
 *  walk reaches. */
async function reachableIn(archive, roots) {
  const members = new Set(asar.listPackage(archive));
  const manifests = new Map();
  const readManifest = async (dir) => {
    const key = `${dir}/package.json`;
    if (!manifests.has(key)) {
      let parsed = null;
      try {
        // `extractFile` takes the member path without its leading slash, while
        // `listPackage` hands them back with one.
        parsed = JSON.parse((await asar.extractFile(archive, key.slice(1))).toString('utf8'));
      } catch {
        parsed = null;
      }
      manifests.set(key, parsed);
    }
    return manifests.get(key);
  };

  const found = new Set();
  const missing = new Set();
  // Roots and required dependencies have to resolve. An optional dependency is
  // allowed to be absent: those are per-platform binaries, and a darwin bundle
  // has no use for @esbuild/win32-x64.
  const queue = roots.map((name) => ({ name, from: '', required: true }));
  while (queue.length > 0) {
    const { name, from, required } = queue.pop();
    // Up through node_modules folders, as Node does.
    let at = null;
    for (let dir = from; ; ) {
      const candidate = dir === '' ? `/node_modules/${name}` : `${dir}/node_modules/${name}`;
      if (members.has(candidate)) {
        at = candidate;
        break;
      }
      if (dir === '') break;
      const cut = dir.lastIndexOf('/node_modules');
      dir = cut === -1 ? '' : dir.slice(0, cut);
    }
    if (at === null) {
      if (required) missing.add(name);
      continue;
    }
    if (found.has(at)) continue;
    found.add(at);
    const manifest = await readManifest(at);
    if (manifest === null) continue;
    for (const dep of Object.keys(manifest.dependencies ?? {})) {
      queue.push({ name: dep, from: at, required: true });
    }
    for (const dep of Object.keys(manifest.optionalDependencies ?? {})) {
      queue.push({ name: dep, from: at, required: false });
    }
  }
  return { found, missing };
}

/* -------------------------------------------------------------------------- */
/* The .app bundles                                                            */
/* -------------------------------------------------------------------------- */

/** electron-builder names the x64 output `mac` and everything else `mac-<arch>`. */
const bundles = [
  { arch: 'x64', dir: join(releaseDir, 'mac') },
  { arch: 'arm64', dir: join(releaseDir, 'mac-arm64') },
];

let checkedAny = false;

for (const bundle of bundles) {
  const app = join(bundle.dir, 'Graphe.app');
  if (!(await exists(app))) continue;
  checkedAny = true;

  console.log(`\nGraphe.app (${bundle.arch}) — ${await sizeOf(app)}`);

  /* The agent runtime, where it has to be. It is in asarUnpack, so it is a real
     folder on disk rather than a member of the archive — which is also what
     makes this checkable without unpacking anything. */
  const piDir = join(app, 'Contents/Resources/app.asar.unpacked/node_modules', PI);
  if (await exists(join(piDir, 'package.json'))) {
    const manifest = JSON.parse(await readFile(join(piDir, 'package.json'), 'utf8'));
    pass(`${PI} ${manifest.version} is in the bundle`);

    // Its own dependency tree, not just the entry package. Pi is useless
    // without pi-agent-core and undici, and "the folder is there" is not the
    // same claim as "the tree is complete".
    //
    // Asserted as reachability rather than as a count of what sits under Pi.
    // electron-builder 26 hoists a nested package to the archive's top level, so
    // a bundle that satisfies "everything Pi declares resolves" can have nothing
    // at all beneath Pi — and a bundle that had lost cross-spawn, debug, ms and
    // which still had two folders there to count.
    const { found, missing } = await reachableIn(join(app, 'Contents/Resources/app.asar'), [PI]);
    if (missing.size > 0) {
      fault(`Pi cannot resolve ${[...missing].join(', ')} inside the bundle`);
    } else {
      pass(`Pi's dependency tree came with it — ${found.size} packages`);
    }
  } else {
    fault(`${PI} is NOT in the bundle — the app cannot think`);
  }

  /* The terminal's pty helper: unpacked, and executable. The execute bit is the
     whole reason this check exists — npm can install the prebuilt binary without
     it, and a terminal that silently will not start is the kind of thing nobody
     notices until they need it. */
  const ptyDir = join(app, 'Contents/Resources/app.asar.unpacked/node_modules/node-pty');
  const helpers = join(ptyDir, 'prebuilds');
  if (await exists(join(ptyDir, 'package.json'))) {
    const arch = process.arch === 'arm64' ? 'darwin-arm64' : 'darwin-x64';
    const helper = join(helpers, arch, 'spawn-helper');
    if (!(await exists(helper))) {
      fault(`node-pty is in the bundle but ${arch}/spawn-helper is not`);
    } else {
      const mode = (await stat(helper)).mode & 0o111;
      if (mode === 0) fault('node-pty spawn-helper is not executable — the terminal will not start');
      else pass('node-pty is in the bundle with an executable helper');
    }
  } else {
    // Not a fault while the app ships without it: the terminal says so itself.
    console.log('  note: node-pty is not in this bundle, so the terminal is unavailable');
  }

  /* The window's own build. */
  for (const needed of ['app.asar', 'app.asar.unpacked']) {
    if (!(await exists(join(app, 'Contents/Resources', needed)))) fault(`Resources/${needed} missing`);
  }

  /* Licences, readable without unpacking an archive. */
  for (const notice of ['LICENSE', 'THIRD-PARTY-LICENSES.md', 'THIRD-PARTY-NOTICES.md']) {
    if (!(await exists(join(app, 'Contents/Resources', notice)))) fault(`Resources/${notice} missing`);
  }

  /* The signature. */
  try {
    const { stderr } = await run('codesign', ['--verify', '--deep', '--strict', '--verbose=2', app]);
    const adhoc = await run('codesign', ['--display', '--verbose=2', app]).catch(() => null);
    const authority = `${adhoc?.stderr ?? ''}${stderr}`;
    if (/Signature=adhoc/.test(authority)) pass('ad-hoc signed, and the signature verifies');
    else fault('signed, but not ad-hoc — check who signed this before publishing it');
  } catch (cause) {
    fault(`the bundle is not validly signed: ${cause.message.split('\n')[0]}`);
  }

  /* The one that matters most: can the runtime actually be loaded from where it
     now lives? A dynamic ESM import out of a packaged layout is exactly what
     the shell does the first time somebody opens a folder, and it is the step
     that has historically gone wrong. `ELECTRON_RUN_AS_NODE` runs the app's own
     Electron binary as plain Node, so this is the real interpreter, the real
     paths and the real archive. Only on the architecture this machine can
     execute; the other bundle gets the structural checks above. */
  if (bundle.arch === process.arch) {
    const entry = join(app, 'Contents/Resources/app.asar/node_modules', PI, 'dist/index.js');
    const binary = join(app, 'Contents/MacOS/Graphe');
    // The shell patches one missing function into Electron's Node before it
    // touches Pi — see `patchWorkerThreads` in electron/main.ts. Without the
    // same patch here this check fails for a reason the real app does not have,
    // and with it the check also proves the patch still does its job in a
    // packaged build, which is the version of it nobody exercises by accident.
    const asTheShellDoes = [
      "const w = require('node:worker_threads');",
      "if (typeof w.markAsUncloneable !== 'function') w.markAsUncloneable = () => {};",
      `import(${JSON.stringify(entry)})`,
      "  .then((m) => { console.log('exports:' + Object.keys(m).length); })",
      '  .catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n');
    try {
      const { stdout } = await run(
        binary,
        ['-e', asTheShellDoes],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, timeout: 60_000 },
      );
      const count = Number.parseInt(/exports:(\d+)/.exec(stdout)?.[1] ?? '0', 10);
      if (count > 10) pass(`the runtime imports inside the bundle — ${count} exports`);
      else fault(`the runtime imported but looks empty — ${count} exports`);
    } catch (cause) {
      fault(`the runtime does not import inside the bundle: ${String(cause).split('\n')[0]}`);
    }

    /* The memory store, for the same reason and one more: scripts/what-ships.mjs
       leaves out every build of sql.js except the two the package's own entry
       point reaches for, and if it ever leaves out the wrong two the app does
       not fail — it quietly stops remembering anything between sittings. */
    const opensADatabase = [
      `import(${JSON.stringify(join(app, 'Contents/Resources/app.asar/node_modules/sql.js/dist/sql-wasm.js'))})`,
      '  .then((m) => (m.default ?? m)())',
      "  .then((SQL) => { const db = new SQL.Database(); db.run('create table t (a)'); console.log('rows:' + db.exec('select count(*) from t')[0].values[0][0]); })",
      '  .catch((e) => { console.error(e); process.exit(1); });',
    ].join('\n');
    try {
      const { stdout } = await run(binary, ['-e', opensADatabase], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 60_000,
      });
      if (/rows:0/.test(stdout)) pass('the memory store opens inside the bundle');
      else fault(`the memory store opened but answered oddly — ${stdout.trim()}`);
    } catch (cause) {
      fault(`the memory store does not open inside the bundle: ${String(cause).split('\n')[0]}`);
    }

    /* The child runtime, which a conversation is hosted in once the switch is
       on. Two claims, and the second is the one that costs an afternoon when it
       is false: the file is *outside* the archive — an ESM entry Node has to
       import, which is why `asarUnpack` names it — and the real binary under the
       real interpreter starts it far enough to say it is ready. A worker that
       cannot say that is a conversation that cannot open, and nothing else in
       the pipeline notices: the app installs, opens, and fails on the first
       message somebody sends. */
    const child = join(app, 'Contents/Resources/app.asar.unpacked/dist-electron/runtime-child.mjs');
    if (!(await exists(child))) {
      fault('dist-electron/runtime-child.mjs is not unpacked from the archive — no conversation can start one');
    } else {
      pass('the child runtime is unpacked, where an ESM entry can be imported');
      /* Pi's entry, handed over the way the shell hands it over. `startRuntime`
         sets these three, so this is the same start rather than a lookalike. */
      const ready = [
        "const { spawn } = require('node:child_process');",
        `const child = spawn(process.execPath, [${JSON.stringify(child)}, '--no-extensions', '--no-approve'], {`,
        "  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', GRAPHE_RUNTIME_NONCE: 'verify',",
        `    GRAPHE_RUNTIME_PI_ENTRY: ${JSON.stringify(join(app, 'Contents/Resources/app.asar.unpacked/node_modules', PI, 'dist/index.js'))} },`,
        "  stdio: ['pipe', 'pipe', 'pipe', 'pipe', 'pipe'],",
        '});',
        "let said = '';",
        'child.stdio[3].setEncoding("utf8");',
        `child.stdio[3].on('data', (c) => { said += c; if (said.includes('"ready"')) { console.log('ready:' + said.trim()); child.kill('SIGKILL'); } });`,
        "child.on('exit', () => { if (!said.includes('\"ready\"')) { console.error('no ready line'); process.exit(1); } });",
      ].join('\n');
      try {
        const { stdout } = await run(binary, ['-e', ready], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
          timeout: 90_000,
        });
        if (/"type":"ready"/.test(stdout)) pass('the child runtime starts in the bundle and says it is ready');
        else fault(`the child runtime started but never said it was ready — ${stdout.trim()}`);
      } catch (cause) {
        fault(`the child runtime does not start in the bundle: ${String(cause).split('\n')[0]}`);
      }
    }
  }
}

/* -------------------------------------------------------------------------- */
/* The distributables                                                          */
/* -------------------------------------------------------------------------- */

const artifacts = (await readdir(releaseDir).catch(() => [])).filter(
  (name) => name.endsWith('.dmg') || name.endsWith('.zip'),
);

if (artifacts.length === 0) {
  fault('no .dmg or .zip was produced');
} else {
  console.log('\nDistributables');
  for (const name of artifacts.sort()) {
    console.log(`  ${name} — ${await sizeOf(join(releaseDir, name))}`);
  }
}

/* Every disk image gets opened, because the one thing that can be wrong with it
   is invisible from the outside. A .dmg with the app in it and no link to
   /Applications still mounts, still shows an icon, and still cannot be
   installed by anybody who does not already know where applications live —
   and it is produced silently whenever two architectures end up racing for the
   same volume name. */
for (const name of artifacts.filter((one) => one.endsWith('.dmg'))) {
  const mountpoint = join('/tmp', `graphe-verify-${name.replace(/\W+/g, '-')}`);
  try {
    await run('hdiutil', [
      'attach',
      join(releaseDir, name),
      '-nobrowse',
      '-readonly',
      '-mountpoint',
      mountpoint,
    ]);
  } catch (cause) {
    fault(`${name} will not mount: ${String(cause).split('\n')[0]}`);
    continue;
  }
  try {
    const inside = await readdir(mountpoint);
    if (!inside.includes('Graphe.app')) fault(`${name} does not contain Graphe.app`);
    else if (!inside.includes('Applications')) {
      fault(`${name} has no link to /Applications — nobody can install from it`);
    } else pass(`${name} opens onto Graphe.app and a link to /Applications`);
  } finally {
    await run('hdiutil', ['detach', mountpoint, '-quiet']).catch(() => {});
  }
}

if (!checkedAny) fault('no Graphe.app was found in release/');

if (problems.length > 0) {
  console.error(`\n${problems.length} problem(s). This build should not be released.`);
  process.exit(1);
}
console.log('\nThe bundle is what it claims to be.');
