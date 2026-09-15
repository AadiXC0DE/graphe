# Phase 2 handoff: the runtime and the dependency stack

STATUS 2026-09-15: Pi is pinned at 0.85.1 and the packaged-runtime import is
proven on arm64. Of the plan's rows, **react/react-dom, both React type packages,
typebox, playwright, concurrently, typescript-eslint, vite with
`@vitejs/plugin-react`, and the `glob` removal are landed**, each with a command
behind it in "Taken in the second pass" below. **Not landed:** electron,
electron-builder, vitest, jsdom, eslint with `eslint-plugin-react-hooks`,
typescript, unpdf, mermaid, and any `@types/node` above 22 — each with its reason
and a reassessment date. `npx tsc --noEmit` was clean on this tree at the end of
the pass, `npm run lint` was clean, and every suite the dependency groups touch
passed. The only failure left in the whole suite is one case in a sibling's file
— `tests/runtime-spike.test.ts` ("a child that is killed") — not a dependency row.

Findings: Q03 (open), E11 (open). Baseline: `2b5bccb`, app `1.0.3`. Every number
here was taken on this tree on 2026-09-15.

## Done: the one upgrade that had to be deliberate

`@earendil-works/pi-coding-agent` 0.84.3 to **0.85.1**, pinned exactly
(`"0.85.1"`, no range). Evidence:

- `package.json`, `package-lock.json` and `THIRD-PARTY-LICENSES.md` agree with the
  installed tree: `npm run licenses:check` says "THIRD-PARTY-LICENSES.md describes
  everything installed (471 of 471)".
- The pin is enforced by `tests/pinned-runtime.test.ts` (4 tests): exact version,
  the version on disk, and the lockfile's resolution agree.
- Contract tests against the new runtime, run here: `tests/adapter.test.ts` (68),
  `tests/session-replay.test.ts` (26), `tests/packages.test.ts` (65),
  `tests/extension-policy.test.ts` (14), `tests/standing-block.test.ts` (16),
  `tests/pinned-runtime.test.ts` (4) — 6 files, 193 tests, all passing.
  `npx tsc --noEmit` clean.
- 0.85.1 rather than 0.85.0: the SDK import failures 0.85.0 introduced are fixed
  there, and the experimental subpaths are unpublished. Graphe imports only the
  package root.
- 0.85.0's changed areas that intersect the adapter (session restore/fork, cwd
  after resume, provider terminal events, compaction cancellation) are exercised
  by the adapter contract suite; no adapter change was needed for them.
- The packaged half of the exit criterion now has a run behind it: `npm run
  test:packaged` (2026-09-15) launched `release/mac-arm64/Graphe.app` with
  `PATH=/usr/bin:/bin`, no global `pi`, npm or node, and the app's own log records
  `started version=1.0.3 electron=43.4.1 node=24.18.1 runtime=0.85.1`, with the
  smoke asserting the runtime it loaded is the pinned one.

## Also landed: the patch rows the plan allows

| Package | Locked at audit | Now | Evidence |
| --- | --- | --- | --- |
| `marked` | 18.0.9 | 18.0.13 | `tests/markdown.test.ts`, 22 tests, run here |
| `shiki` | 4.4.2 | 4.4.3 | reached only through `src/lib/highlight.ts`, which loads the engine on the first fence; `tests/operations/build-budget.test.ts` is what checks it stays out of the launch set |
| `typebox` | 1.3.12 | 1.3.30, then 1.3.31 in the pass below | `import { Type } from 'typebox'` in `src/agent/pi/desktop.ts:27`, `search-symbols-text.ts:17`, `mcp.ts:24` and the rest of the tool modules; the registrations are held by `tests/adapter.test.ts` (68) |
| `mermaid` | 11.16.1 | 11.17.2 (the plan's first step) | `tests/mermaid.test.ts`, 5 tests including the hostile label, run here |
| `@types/node` | 22.20.1 | 22.20.2 | aligned to the runtime, not to newest types |
| `node-pty`, `@xterm/xterm` | absent | 1.1.0, 6.0.0 | new, for the terminal; N-API prebuilds load under this Electron with no rebuild. `npm install` can drop the execute bit on `prebuilds/<arch>/spawn-helper`, which is the packaging requirement in the phase 6 handoff |

## Taken in the second pass, group by group (2026-09-15)

One group at a time, each with its own install and its own round trip. Every
command below was run on this tree on 2026-09-15; a group that had turned
`npx tsc --noEmit` or the suite red would have been reverted on its own, per the
plan's rule.

**Group 1, the patch/minor set.** `react` 19.2.8 to **19.3.0**, `react-dom` to
**19.3.0**, `@types/react` 19.2.18 to **19.3.0**, `@types/react-dom` 19.2.4 to
**19.3.0**, `typebox` 1.3.30 to **1.3.31**. `scheduler` moved 0.27.0 to 0.28.0
with React. No source change was needed.

- `npx tsc --noEmit` clean; `npm run lint` clean; `npx vite build` built.
- The 47 jsdom suites, together: 578 tests, all passing — the renderer half of
  the move.
- `tests/adapter.test.ts`, `tests/read-a-file.test.ts`, `tests/markdown.test.ts`,
  `tests/attached-pdf-wired.test.ts` and `tests/operations/build-budget.test.ts`,
  together: 113 tests, all passing — the typebox registrations and the launch
  budget after a React bump.

**Group 2, the tools.** `playwright` 1.62.1 to **1.63.0**, `concurrently` 9.2.4
to **10.0.5**, `typescript-eslint` 8.67.0 to **8.70.0**.

- `npx tsc --noEmit` clean; `npm run lint` clean; `npx vite build` built.
- The whole suite (363 files, 6,578 tests) was run here: one failure, and it was
  the licence manifest, not the tools — `THIRD-PARTY-LICENSES.md` is generated
  from the lockfile, so `npm run licenses` was run and `tests/licences.test.ts`
  went green (3 tests).
- `npm run test:electron` — the real window under Playwright 1.63: 13 tests,
  passing, including the force-quit recovery and the renderer-reload case.
  Playwright 1.63 wants chromium 1243, which is the revision already in the
  cache; its newer webkit is not used by anything here.
- `concurrently` 10 was checked against its three claims in an isolated script
  rather than by reading the changelog: the first child to fail ends the group
  with a non-zero status and stops its sibling; a clean pair stays 0; SIGINT
  reaches the children and the group closes. `-k`, `-n` and `-c` all still mean
  what `npm run app` asks for. It requires Node >= 22, which is what `.nvmrc`
  and CI already pin.

**Group 3, Vite.** `vite` 6.4.3 to **8.3.0**, `@vitejs/plugin-react` 4.7.0 to
**6.1.1**.

- Vite 8 builds with Rolldown and no longer depends on `esbuild`, which this
  tree used transitively: `scripts/build-electron.mjs` and
  `tests/extension-probe-child.test.ts` both import it. `esbuild` 0.28.1 — the
  version `@earendil-works/chord` already resolves, and inside Vite 8's optional
  peer range — is now a direct devDependency, and the two comments claiming it
  "comes with Vite" were corrected.
- `npx tsc --noEmit` clean; `npm run lint` clean; `npx vite build` built in
  under a second; `npm run app:build` built all seven shell outputs.
- The bundle graph was compared, not assumed. 122 files / 5,897.5 KB before,
  160 files / 5,829.8 KB after: 68 KB lighter overall, and the launch set is
  608.6 KB across 6 chunks against 610.4 KB before. `node
  scripts/perf-report.mjs --check` passes: main 379.1 KB raw / 116.3 KB gzip
  against the 450 KB limit, down from 392.4 KB. The on-demand total is 5,221.2
  KB, down from 5,287.1 KB. Mermaid's single 680.7 KB `mermaid.core` chunk is now
  split across Rolldown's `chunk-*` files, which is why the file count rose and
  the total fell. `index.html` still references `./assets/…` relatively, so the
  `base: './'` + `file://` requirement is intact.
- The comment in `vite.config.ts` that names `rollupOptions`/`manualChunks` still
  describes an option Vite 8 accepts — the build reports no deprecation and the
  manual split still runs, which is why the `react` chunk is still its own file
  — but the bundler underneath it is Rolldown now. Rewording that comment is
  phase 9 work, not a dependency row.

**Group 4, `glob`.** Removed rather than upgraded, which is the plan's preferred
answer. Nothing in `src/`, `electron/`, `scripts/` or `tests/` imports it — every
`glob` in the tree is the tool name (`src/agent/guard/policy.ts:352`) — and the
proof the plan asks for was run: after `npm uninstall glob`,
`rm -rf node_modules && npm ci` completed (1,033 packages) and the tree still
type-checks, lints, builds and tests. The lockfile keeps `node_modules/glob` at
7.2.3 anyway, because four transitive packages still ask for it
(`@electron/asar`, `archiver-utils`, `cacache`, `node-gyp`, `rimraf`); that copy
is theirs to move, not ours to name.

## Untouched, and why, with a reassessment date

The plan's own rule for a row it cannot take yet: "Record the exact reason and
reassessment date, rather than forcing a broken 'latest' installation." Every row
below is still on the version the audit recorded, and each is a separate change
with its own verification — none of them is a prerequisite for the ownership work,
which is why they were left rather than attempted in a batch. `npm ls --depth=0`
and `npm outdated --json` on this tree give the current and wanted columns below.

**Reassessment: 2026-10-13** for the stack as a whole — a month after the audit
baseline and at the next wave boundary. A row with its own reason says so.

| Package | Plan's row | Why it is still there | Reassess |
| --- | --- | --- | --- |
| `electron` 43.4.1 | 43.7.0 first, then 44.3.0 after a packaged smoke | Not attempted in this pass: it needs a full `npm run package` on both advertised arches plus `npm run test:packaged` on each, which is a packaging session rather than a dependency-row step, and the packaged smoke has only ever been driven on this machine's arm64 | 2026-10-13 |
| `electron-builder` 25.1.8 to 26.15.3 | upgrade with packaging fixtures, native assets and signing verification | Same session as the Electron row, by the handoff's own instruction: one packaging pass rather than two. `scripts/verify-package.mjs` and the `afterPack` ad-hoc sign hook are what a new builder has to be re-verified against | with Electron |
| `glob` 7.2.3 | locate all consumers; prefer removing the direct dependency if supported discovery covers them | **Done in this pass by removal** (see above). The direct dependency is gone; the lockfile copy remains only because four transitive packages require it | done |
| `vite` 6.4.3 to 8.3.0 | follow the major path and compare the bundle graph | **Done in this pass** (see above). The Rolldown/Oxc comparison, `base: './'`, lazy chunks and sourcemaps were all exercised | done |
| `vitest` 2.1.9 to 5.0.0 | read intermediate migration requirements; verify mocks, timers, pools, reporters | Not attempted. Vitest 5 requires Node `^22.12.0 \|\| ^24.0.0 \|\| >=26.0.0`; this machine runs 22.21.1 and `.nvmrc` pins 22, so the row is coupled to a Node decision before it is coupled to any API | 2026-10-13 |
| `jsdom` 25.0.1 to 29.1.1 | validate Node engine and changed DOM/layout assumptions | Not attempted. It is a stand-in for Chromium, and the assumption changes have to be checked against a real window, which is the same pass as the visual matrix | 2026-10-13 |
| `eslint` 9.39.5 to 10.10.0, `eslint-plugin-react-hooks` 5.2.0 to 7.1.1 | compatible parser/plugins; review new findings, especially lifecycle effects and stale closures | Not attempted. ESLint 10 changes the peer set the two plugins sit in, and the hooks plugin's new rules report on components this branch is midway through deleting | 2026-10-13 |
| `typescript` 5.9.3 to 7.0.2 | "stay on a supported intermediate release if the compiler API migration is not ready. Record the exact reason and reassessment date" | Not attempted. The compiler API has three consumers — `scripts/no-dashes.mjs` (`npm run copy:check`), `tests/asking-wired.test.ts`, `tests/overview-roots.test.ts` — and a probe of the three has not been run. 5.9.3 is a supported release, not a broken "latest" | 2026-10-13, as its own change |
| `unpdf` 0.12.2 to 1.8.1 | major, isolated: compare text/images, worker/assets, encrypted/corrupt PDF handling | Not attempted. Its one importer is `src/agent/pi/pdf.ts:16` (`extractText`), and PDF text feeds a turn (`paperWords`); the comparison fixtures have not been built | 2026-10-13 |
| `mermaid` 11.17.2 to 12.0.0 | major separately, after renderer/sanitization checks | Not attempted. The 11.17.2 step is done; the major needs the hostile-label and sanitization cases in `tests/mermaid.test.ts` repeated against the 12 renderer, and Vite 8 moved the mermaid chunks this pass | 2026-10-13 |
| `@types/node` 22.20.2 | align final types to the build/runtime target, not newest types blindly | Note: the plan's inventory row names 26.5.1 as newest. The lockfile-aligned move to 22.20.2 is already done above; anything higher follows the Electron bump rather than leading it | with Electron |
| `@huggingface/transformers` 4.2.0, `@modelcontextprotocol/sdk` 1.30.0, `react-icons` 5.7.0, `sql.js` 1.14.2, `@types/sql.js` 1.4.11, `use-stick-to-bottom` 1.1.6 | retain | The plan's row is retain; no newer target is reported and nothing here depends on a bump | not scheduled |

## What this pass did not reach

Stated plainly, so the next pass starts from the truth rather than from this
table's optimism.

- `glob` was removed in this pass; there is nothing left to do for that row.
- `vitest` 5 is blocked on a Node decision, not on Vitest: its engines are
  `^22.12.0 || ^24.0.0 || >=26.0.0` and this machine and `.nvmrc` are on 22.
- `typescript` 7's three compiler-API consumers have not been probed.
- `electron` / `electron-builder` / `@types/node`-above-22 are one packaging
  session, and it has not been opened.
- `eslint` 10 + `eslint-plugin-react-hooks` 7, `jsdom` 29 and `mermaid` 12 were
  not attempted.

Not a dependency row, but touched by this pass: `scripts/build-electron.mjs`
gained a seventh build, `runtime-child.mjs`, at the request of the phase 6
child-runtime work, and the console line now names it.

## Still not met

- `npm ci` is unchanged in CI, and the package job still runs `licenses:check &&
  package && verify:package`.
- The x64 bundle in `release/mac` was built on 2026-09-15 and carries the pinned
  Pi and node-pty (checked in the asar), but nothing has started it: the packaged
  smoke drives the bundle for this machine's architecture only.

Exit criteria: the pinned-runtime half is met, and the packaged-runtime import is
now proven on arm64. The "patch stack upgraded" half moved in this pass — the
React pair, both `@types` rows, typebox, playwright, concurrently,
typescript-eslint and the Vite pair with `@vitejs/plugin-react` are all on the
plan's target versions and each has a command behind it above, and the `glob`
dependency is gone rather than upgraded, which is the plan's own preference. The
remainder is listed twice on purpose: in the table with the reason, and in "What
this pass did not reach" with what is actually missing.
