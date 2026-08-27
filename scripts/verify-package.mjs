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
    const siblings = await readdir(join(app, 'Contents/Resources/app.asar.unpacked/node_modules'));
    if (!siblings.includes('@earendil-works')) fault('the @earendil-works scope is missing');
    const nested = await readdir(join(piDir, 'node_modules')).catch(() => []);
    if (nested.length < 20) {
      fault(`Pi's own dependencies look incomplete — ${nested.length} packages under it`);
    } else {
      pass(`Pi's dependency tree came with it — ${nested.length} packages`);
    }
  } else {
    fault(`${PI} is NOT in the bundle — the app cannot think`);
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
