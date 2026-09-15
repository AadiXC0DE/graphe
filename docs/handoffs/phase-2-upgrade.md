# Phase 2 handoff: the runtime and the dependency stack

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
| `typebox` | 1.3.12 | 1.3.30 | `import { Type } from 'typebox'` in `src/agent/pi/desktop.ts:27`, `search-symbols-text.ts:17`, `mcp.ts:24` and the rest of the tool modules; the registrations are held by `tests/adapter.test.ts` (68) |
| `mermaid` | 11.16.1 | 11.17.2 (the plan's first step) | `tests/mermaid.test.ts`, 5 tests including the hostile label, run here |
| `@types/node` | 22.20.1 | 22.20.2 | aligned to the runtime, not to newest types |
| `node-pty`, `@xterm/xterm` | absent | 1.1.0, 6.0.0 | new, for the terminal; N-API prebuilds load under this Electron with no rebuild. `npm install` can drop the execute bit on `prebuilds/<arch>/spawn-helper`, which is the packaging requirement in the phase 6 handoff |

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
| `react` / `react-dom` to 19.3.0 | upgrade together | The plan's step 7 puts rendering after Electron and after the session-state work, and the phase 8 retirements are still deleting design views: a React bump in the middle of that is two changes in one tree | 2026-10-13 |
| `@types/react` 19.2.18, `@types/react-dom` 19.2.4 to 19.3.0 | align with the React upgrade | Same change as the row above, by the plan's own instruction ("align with React upgrade") | with React |
| `electron` 43.4.1 | 43.7.0 first, then 44.3.0 after a packaged smoke | The packaged smoke exists now (`npm run test:packaged`) and has been run once, on this machine's arm64. The plan asks for both advertised arches and a re-run after the bump, and the x64 bundle has not been started | 2026-10-13 |
| `electron-builder` 25.1.8 to 26.15.3 | upgrade with packaging fixtures, native assets and signing verification | `scripts/verify-package.mjs` and the `afterPack` ad-hoc sign hook are what a new builder has to be re-verified against; doing that in the same change as the Electron bump costs one packaging pass rather than two | with Electron |
| `typescript` 5.9.3 to 7.0.2 | "stay on a supported intermediate release if the compiler API migration is not ready. Record the exact reason and reassessment date" | The compiler API has three consumers here — `scripts/no-dashes.mjs` (`npm run copy:check`), `tests/asking-wired.test.ts`, `tests/overview-roots.test.ts` — and `typescript-eslint@8.67.0` is on the same 8.x line the plan flags as needing its own pass. 5.9.3 is a supported release, not a broken "latest" | 2026-10-13, as its own change |
| `typescript-eslint` 8.67.0 to 8.70.0 | patch first, check TS/ESLint peers before majors | Superseded by the TypeScript row: a patch that lands between 5.9.3 and a compiler-API migration is churn | with TypeScript |
| `vite` 6.4.3 to 8.3.0 | follow the major path and compare the bundle graph | Rolldown/Oxc needs `base: './'` with `file://`, lazy chunks, worker/WASM paths and sourcemaps compared one at a time, and the phase 8 retirement rows are still changing the module graph | 2026-10-13 |
| `vitest` 2.1.9 to 5.0.0 | read intermediate migration requirements; verify mocks, timers, pools, reporters | The intermediate requirements have not been read, and this suite is the gate for everything else in flight | 2026-10-13 |
| `eslint` 9.39.5 to 10.10.0, `eslint-plugin-react-hooks` 5.2.0 to 7.1.1 | compatible parser/plugins; review new findings, especially lifecycle effects and stale closures | ESLint 10 changes the peer set the two plugins sit in, and the hooks plugin's new rules would report on components this branch is midway through deleting | 2026-10-13 |
| `jsdom` 25.0.1 to 29.1.1 | validate Node engine and changed DOM/layout assumptions | It is a stand-in for Chromium, not a substitute; the assumption changes have to be checked against a real window, which is the same pass as the visual matrix | 2026-10-13 |
| `playwright` 1.62.1 to 1.63.0 | update browser binaries with the package; run real Electron tests | Its one consumer here is `scripts/packaged-smoke.mjs`, which was run for the first time on 2026-09-15; the update is worth doing with the Electron bump rather than before it | with Electron |
| `concurrently` 9.2.4 to 10.0.5 | isolated dev-script check: signals, exit status, sibling shutdown | Nothing outside `npm run app` uses it, and that check has not been run | 2026-10-13 |
| `glob` 7.2.3 to 13.0.6 | locate all consumers; prefer removing the direct dependency if supported discovery covers them | Located: nothing in `src/`, `electron/`, `scripts/` or `tests/` imports it — every `glob` in the tree is the tool name (`src/agent/guard/policy.ts:352`). Removing it is the plan's preferred answer, and it needs an `npm ci` plus a launch to prove nothing transitive wanted it | 2026-10-13 |
| `unpdf` 0.12.2 to 1.8.1 | major, isolated: compare text/images, worker/assets, encrypted/corrupt PDF handling | The comparison fixtures have not been built; PDF text extraction feeds a turn (`paperWords`), so it is not a swap to make blind | 2026-10-13 |
| `mermaid` 11.17.2 to 12.0.0 | major separately, after renderer/sanitization checks | The 11.17.2 step is done; the major needs the hostile-label and sanitization cases repeated against the 12 renderer | 2026-10-13 |
| `typebox` 1.3.30 to 1.3.31 | patch with tool-schema serialization tests | A further patch beyond the plan's row; it buys nothing until `@types/node` and the Electron line move | 2026-10-13 |
| `@types/node` 22.20.2 to 26.5.1 | align final types to the build/runtime target, not newest types blindly | The packaged app reports node 24.18.1 under Electron 43.4.1, so the types follow the Electron bump rather than leading it | with Electron |
| `@huggingface/transformers` 4.2.0, `@modelcontextprotocol/sdk` 1.30.0, `react-icons` 5.7.0, `sql.js` 1.14.2, `@types/sql.js` 1.4.11, `use-stick-to-bottom` 1.1.6 | retain | The plan's row is retain; no newer target is reported and nothing here depends on a bump | not scheduled |

## Still not met

- `npm ci` is unchanged in CI, and the package job still runs `licenses:check &&
  package && verify:package`.
- The x64 bundle in `release/mac` was built on 2026-09-15 and carries the pinned
  Pi and node-pty (checked in the asar), but nothing has started it: the packaged
  smoke drives the bundle for this machine's architecture only.

Exit criteria: the pinned-runtime half is met, and the packaged-runtime import is
now proven on arm64. The "patch stack upgraded" half is not: the rows above are
the remainder, each with the reason it waits and when it is looked at again.
