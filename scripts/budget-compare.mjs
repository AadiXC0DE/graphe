/** The launch budget the Build job keeps, read back, so it is a number rather
 *  than a file nobody opens.
 *
 *   npm run budget:compare
 *   node scripts/budget-compare.mjs --tolerance=1
 *   node scripts/budget-compare.mjs --json=a.json,b.json
 *
 * CI measures the main chunk on every run and uploads `launch-budget.json` as
 * the `launch-budget` artifact whether the number is inside the 450 KB or not.
 * Nothing read it back, which is the same as not keeping it: a build that grew
 * 40 KB since the last green one failed no gate, and the only way to find out
 * was to open two artifacts and subtract.
 *
 * This pulls the newest two runs that have an artifact and prints the
 * difference, in KB and in percent, for the main chunk, the launch set and the
 * on-demand set. It exits non-zero when the main chunk is over the limit, or
 * when it grew past the tolerance — so it is usable as a gate as well as a
 * readout.
 *
 * `--json=` compares two files already on this machine instead, which is what a
 * person does after `gh run download`: newest first, previous second.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

const args = process.argv.slice(2);
function readArg(name) {
  const found = args.find((one) => one.startsWith(`${name}=`));
  return found === undefined ? null : found.slice(name.length + 1);
}

/** A percent, because a build's size moves a little every time and a gate that
 *  fires on 200 bytes is a gate somebody turns off. */
const tolerance = Number(readArg('--tolerance') ?? '1');
const workflow = readArg('--workflow') ?? 'ci.yml';
const branch = readArg('--branch');
const files = readArg('--json');

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
const pct = (was, now) => (was === 0 ? 'n/a' : `${((100 * (now - was)) / was).toFixed(2)}%`);
const signed = (bytes) => `${bytes > 0 ? '+' : ''}${kb(bytes)}`;

function readOne(path) {
  const one = JSON.parse(readFileSync(path, 'utf8'));
  for (const key of ['main', 'launch', 'onDemand', 'limitKb', 'machine']) {
    if (one[key] === undefined) throw new Error(`${path} has no "${key}" — not a launch-budget.json`);
  }
  return one;
}

function gh(argv) {
  const ran = spawnSync('gh', argv, { cwd: root, encoding: 'utf8' });
  if (ran.error !== undefined) return { failed: String(ran.error.message) };
  if (ran.status !== 0) return { failed: `${ran.stderr ?? ''}`.trim().split('\n')[0] ?? 'gh failed' };
  return { out: ran.stdout ?? '' };
}

/** The newest runs that actually carry the artifact, newest first. An artifact
 *  expires after thirty days, so run order is not the same as having one. */
function runsWithTheArtifact(want) {
  const list = [
    'run',
    'list',
    `--workflow=${workflow}`,
    '--limit=20',
    '--json=databaseId,headBranch,headSha,conclusion,createdAt',
  ];
  if (branch !== null) list.push(`--branch=${branch}`);
  const listed = gh(list);
  if (listed.failed !== undefined) return { failed: listed.failed };
  const runs = JSON.parse(listed.out);
  const kept = [];
  for (const one of runs) {
    const artifacts = gh(['api', `repos/{owner}/{repo}/actions/runs/${String(one.databaseId)}/artifacts`]);
    if (artifacts.failed !== undefined) continue;
    const found = JSON.parse(artifacts.out).artifacts ?? [];
    if (found.some((each) => each.name === 'launch-budget' && !each.expired)) kept.push(one);
    if (kept.length === want) break;
  }
  return { runs: kept };
}

function downloadOne(id, into) {
  const folder = join(into, String(id));
  const ran = gh(['run', 'download', String(id), '-n', 'launch-budget', '-D', folder]);
  if (ran.failed !== undefined) return { failed: ran.failed };
  const file = join(folder, 'launch-budget.json');
  return existsSync(file) ? { file } : { failed: `run ${String(id)} had no launch-budget.json` };
}

/* -------------------------------------------------------------------------- */
/* The two numbers                                                             */
/* -------------------------------------------------------------------------- */

let now;
let before;
let where;
const scratch = mkdtempSync(join(tmpdir(), 'graphe-budget-'));

if (files !== null) {
  const [newest, previous] = files.split(',').map((one) => resolve(process.cwd(), one.trim()));
  if (previous === undefined) {
    console.error('\n--json needs two files: the newer one first, then the one to compare against.');
    process.exit(2);
  }
  now = readOne(newest);
  before = readOne(previous);
  where = { newest, previous };
} else {
  const found = runsWithTheArtifact(2);
  if (found.failed !== undefined) {
    console.error(
      `\nCould not ask github for the runs: ${found.failed}\n` +
        '`gh` needs to be installed and signed in for this. Without it, download the artifact by\n' +
        'hand and compare two files:\n' +
        '  gh run download <id> -n launch-budget -D /tmp/now\n' +
        '  npm run budget:compare -- --json=/tmp/now/launch-budget.json,/tmp/before/launch-budget.json\n',
    );
    process.exit(2);
  }
  const runs = found.runs;
  if (runs.length < 2) {
    console.error(
      `\nOnly ${String(runs.length)} run${runs.length === 1 ? '' : 's'} with a launch-budget artifact${branch === null ? '' : ` on ${branch}`}.\n` +
        'There is nothing to compare against yet; the next Build run gives this a baseline.\n',
    );
    rmSync(scratch, { recursive: true, force: true });
    process.exit(2);
  }
  for (const [index, one] of runs.entries()) {
    const got = downloadOne(one.databaseId, scratch);
    if (got.failed !== undefined) {
      console.error(`\n${got.failed}`);
      process.exit(2);
    }
    if (index === 0) now = readOne(got.file);
    else before = readOne(got.file);
  }
  where = { newest: runs[0], previous: runs[1] };
}

/* -------------------------------------------------------------------------- */
/* The comparison                                                              */
/* -------------------------------------------------------------------------- */

console.log(`\nlaunch budget: the newest run against the one before it`);
if (typeof where.newest === 'string') {
  console.log(`  newest   ${where.newest}`);
  console.log(`  previous ${where.previous}`);
} else {
  const says = (one) =>
    `run ${String(one.databaseId)} ${one.headBranch}@${one.headSha.slice(0, 7)} ${one.createdAt}`;
  console.log(`  newest   ${says(where.newest)}`);
  console.log(`  previous ${says(where.previous)}`);
}
console.log(
  `  measured on ${now.machine.platform} ${now.machine.arch}, ${String(now.machine.cpus)} cores, node ${now.machine.node}` +
    (now.machine.runner === 'local' ? ' (a local run)' : ` (${now.machine.runner})`),
);

const rows = [
  ['main chunk', now.main.raw, before.main.raw],
  ['  gzip', now.main.gzip, before.main.gzip],
  ['launch set', now.launch.raw, before.launch.raw],
  ['  gzip', now.launch.gzip, before.launch.gzip],
  ['on demand', now.onDemand.raw, before.onDemand.raw],
  ['  gzip', now.onDemand.gzip, before.onDemand.gzip],
];
console.log(`\n${'what'.padEnd(12)} ${'before'.padStart(10)} ${'now'.padStart(10)} ${'change'.padStart(11)} ${'percent'.padStart(9)}`);
for (const [what, nowBytes, wasBytes] of rows) {
  console.log(
    `${what.padEnd(12)} ${kb(wasBytes).padStart(10)} ${kb(nowBytes).padStart(10)} ${signed(nowBytes - wasBytes).padStart(11)} ${pct(wasBytes, nowBytes).padStart(9)}`,
  );
}

console.log(
  `\nlimit ${String(now.limitKb)} KB, tolerance ${String(tolerance)}%: ` +
    (now.limitKb === before.limitKb ? 'the same in both runs' : `was ${String(before.limitKb)} KB in the previous run`),
);

const grew = now.main.raw - before.main.raw;
const grewBy = before.main.raw === 0 ? 0 : (100 * grew) / before.main.raw;
const problems = [];
if (now.main.raw > now.limitKb * 1024) {
  problems.push(`the main chunk is ${kb(now.main.raw)}, over the ${String(now.limitKb)} KB the app promises`);
}
if (grewBy > tolerance) {
  problems.push(
    `the main chunk grew ${kb(grew)} (${grewBy.toFixed(2)}%) since the previous run, past the ${String(tolerance)}% tolerance`,
  );
}
if (now.heavyAtLaunch.length > 0) {
  problems.push(`something meant to be fetched on demand is in the launch set: ${now.heavyAtLaunch.join(', ')}`);
}

if (files === null) rmSync(scratch, { recursive: true, force: true });

if (problems.length > 0) {
  console.error('\nA regression, as a number:');
  for (const one of problems) console.error(`  - ${one}`);
  process.exit(1);
}

console.log(
  `\nNo regression: the main chunk ${grew <= 0 ? `shrank by ${kb(-grew)}` : `grew ${kb(grew)}`}, ` +
    `and it is ${kb(now.limitKb * 1024 - now.main.raw)} inside the limit.`,
);
