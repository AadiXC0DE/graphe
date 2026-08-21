#!/usr/bin/env node
/**
 * A number to tune against — issue #13 item 4.
 *
 * Any fixed task set, run before and after. It is a day, and without it the
 * ordering of 1–3 is taste.
 *
 * This thin wrapper does not invent a new harness. It runs the project's own
 * tests as the task set's oracle, because every task in eval/tasks.json maps
 * to a real test file we already maintain.
 *
 * So be clear about what the number is. There is no model here, no prompt, and
 * no task an agent has to solve: it says whether a change broke something we
 * already knew how to check, not whether the agent got better at anything. It
 * is still worth running — same list every time, and it fails loudly — but a
 * number about the agent would have to run the agent, and this does not.
 *
 * Usage:
 *   node scripts/eval.mjs                 # run and print + write results/<ISO>/summary.json
 *   node scripts/eval.mjs --json          # also emit JSON on stdout
 *   node scripts/eval.mjs --before file   # write before snapshot
 *   node scripts/eval.mjs --after  file   # write after  snapshot
 *   node scripts/eval.mjs --compare a b   # compare two summaries
 *
 * Exit code is 0 even when some tasks fail — the number is the result, not a gate.
 */

import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tasksPath = join(root, 'eval/tasks.json');

function readTasks() {
  try {
    return JSON.parse(readFileSync(tasksPath, 'utf8'));
  } catch {
    return [];
  }
}

function runTests() {
  const start = Date.now();
  // vitest JSON reporter gives machine-readable per-test pass/fail; fallback to stdout parse
  const out = spawnSync('npx', ['vitest', 'run', '--reporter=json'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 100 * 1024 * 1024,
    env: { ...process.env, CI: '1' },
  });
  const durationMs = Date.now() - start;
  const stdout = out.stdout ?? '';
  const stderr = out.stderr ?? '';
  let json = null;
  try {
    // vitest --reporter=json writes a single JSON blob to stdout
    const trimmed = stdout.trim();
    // Sometimes vite prints banner before JSON — find the JSON start
    const jsonStart = trimmed.indexOf('{');
    if (jsonStart !== -1) json = JSON.parse(trimmed.slice(jsonStart));
  } catch {
    json = null;
  }
  return { json, stdout, stderr, durationMs, status: out.status };
}

function toSummary({ json, stdout, durationMs }, tasks) {
  let total = 0;
  let passed = 0;
  let failed = 0;
  const perFile = new Map();
  if (json && Array.isArray(json.testResults)) {
    for (const file of json.testResults) {
      const assertionResults = file.assertionResults ?? [];
      for (const t of assertionResults) {
        total += 1;
        if (t.status === 'passed') passed += 1;
        else failed += 1;
      }
      perFile.set(relative(root, file.name).replaceAll('\\', '/'), {
        passed: assertionResults.filter((a) => a.status === 'passed').length,
        total: assertionResults.length,
        status: file.status,
      });
    }
  } else {
    // Fallback: parse "Tests  X passed | Y failed"
    const m = stdout.match(/Tests\s+(\d+)\s+passed.*?(\d+)\s+failed|Tests\s+(\d+)\s+passed/s);
    if (m) {
      if (m[1] !== undefined) {
        passed = parseInt(m[1], 10);
        failed = m[2] ? parseInt(m[2], 10) : 0;
        total = passed + failed;
      } else if (m[3] !== undefined) {
        passed = parseInt(m[3], 10);
        total = passed;
      }
    }
  }
  // The number is task files green, not the project's raw assertion count. A task
  // maps to one stable oracle file in eval/tasks.json; missing is a failure,
  // never silently clean. The full assertion totals remain beside it as detail.
  const taskResults = tasks.map((t) => {
    const named = t.check.split(':')[0];
    const fileName = named.includes('/') ? named : `tests/${named}`;
    const file = perFile.get(fileName) ?? null;
    const status = file !== null && file.total > 0 && file.passed === file.total ? 'passed' : 'failed';
    return {
      id: t.id,
      title: t.title,
      check: t.check,
      status,
      passed: file?.passed ?? 0,
      total: file?.total ?? 0,
    };
  });
  const tasksPassed = taskResults.filter((one) => one.status === 'passed').length;
  const passAt1 = tasks.length === 0 ? 0 : tasksPassed / tasks.length;
  return {
    at: new Date().toISOString(),
    tasks: tasks.length,
    tasksPassed,
    tests: { total, passed, failed },
    passAt1,
    durationMs,
    taskResults,
  };
}

function printSummary(summary) {
  const pct = (summary.passAt1 * 100).toFixed(1);
  console.log(`\n# eval — ${summary.at}`);
  console.log(`tasks (pinned): ${summary.tasksPassed}/${summary.tasks} passed   files green: ${pct}%   tests: ${summary.tests.passed}/${summary.tests.total}   duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
  if (summary.tests.failed > 0) console.log(`failed: ${summary.tests.failed}`);
  console.log('');
}

function compare(aPath, bPath) {
  const a = JSON.parse(readFileSync(resolve(aPath), 'utf8'));
  const b = JSON.parse(readFileSync(resolve(bPath), 'utf8'));
  const da = ((b.passAt1 - a.passAt1) * 100).toFixed(2);
  const sign = b.passAt1 >= a.passAt1 ? '+' : '';
  console.log(`compare ${aPath} → ${bPath}`);
  console.log(`  files green: ${(a.passAt1 * 100).toFixed(1)}% → ${(b.passAt1 * 100).toFixed(1)}%   delta: ${sign}${da} pts`);
  console.log(`  tests: ${a.tests.passed}/${a.tests.total} → ${b.tests.passed}/${b.tests.total}   tasks: ${a.tasks} → ${b.tasks}`);
  console.log(`  duration: ${(a.durationMs / 1000).toFixed(1)}s → ${(b.durationMs / 1000).toFixed(1)}s`);
}

const args = process.argv.slice(2);
if (args.includes('--compare')) {
  const i = args.indexOf('--compare');
  const a = args[i + 1];
  const b = args[i + 2];
  if (!a || !b) {
    console.error('usage: node scripts/eval.mjs --compare <before.json> <after.json>');
    process.exit(1);
  }
  compare(a, b);
  process.exit(0);
}

const tasks = readTasks();
if (tasks.length === 0) {
  console.error('no tasks at eval/tasks.json');
  process.exit(1);
}

const raw = runTests();
const summary = toSummary(raw, tasks);
printSummary(summary);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(root, 'results', stamp);
try {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), JSON.stringify(summary, null, 2), 'utf8');
  console.log(`wrote ${join(dir, 'summary.json')}`);
} catch {}

// --before / --after snapshot
for (const flag of ['--before', '--after']) {
  const idx = args.indexOf(flag);
  if (idx !== -1) {
    const out = args[idx + 1];
    if (out) {
      const p = resolve(out);
      mkdirSync(join(p, '..'), { recursive: true });
      // ensure parent dir exists for file
      const dir2 = p.endsWith('.json') ? p.slice(0, p.lastIndexOf('/')) : p;
      if (dir2 && dir2 !== p) mkdirSync(dir2, { recursive: true });
      writeFileSync(p, JSON.stringify(summary, null, 2), 'utf8');
      console.log(`wrote ${flag.slice(2)} snapshot ${p}`);
    }
  }
}

if (args.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
}

// A gate that always passes is not a gate, so a failing task says so and this
// can sit in CI beside the tests it runs.
process.exit(summary.tasksPassed === summary.tasks ? 0 : 1);
