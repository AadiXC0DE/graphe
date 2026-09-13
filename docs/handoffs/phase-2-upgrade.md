# Phase 2 handoff: the runtime and the dependency stack

Findings: Q03 (open), E11 (open). Baseline: `2b5bccb`, app `1.0.3`.

## Done: the one upgrade that had to be deliberate

`@earendil-works/pi-coding-agent` 0.84.3 to **0.85.1**, pinned exactly
(`"0.85.1"`, no range). Evidence:

- `package.json`, `package-lock.json`, `THIRD-PARTY-LICENSES.md` regenerated from
  the installed tree (466 packages, was 462).
- The pin is enforced by `tests/pinned-runtime.test.ts`: exact version, the
  version on disk, and the lockfile's resolution agree.
- Contract tests against the new runtime: `tests/adapter.test.ts` (68),
  `tests/session-replay.test.ts` (26), `tests/packages.test.ts` (41),
  `tests/extension-probe.test.ts` (9), `tests/extension-policy.test.ts` (12),
  `tests/standing-block.test.ts` (15), `tests/pinned-runtime.test.ts` (5). All
  pass. `npx tsc --noEmit` clean.
- 0.85.1 rather than 0.85.0: the SDK import failures 0.85.0 introduced are fixed
  there, and the experimental subpaths are unpublished. Graphe imports only the
  package root.
- 0.85.0's changed areas that intersect the adapter (session restore/fork, cwd
  after resume, provider terminal events, compaction cancellation) are exercised
  by the adapter contract suite; no adapter change was needed for them.

## Not done

| Package | Plan says | Status |
| --- | --- | --- |
| `marked` 18.0.9 to 18.0.13 | patch, hostile Markdown fixtures | not started |
| `shiki` 4.4.2 to 4.4.3 | patch, workers/grammars | not started |
| `typebox` 1.3.12 to 1.3.30 | patch, tool-schema serialization | not started |
| `mermaid` 11.16.1 to 11.17.2 | minor first | not started |
| `react`/`react-dom`/`@types/react*` to 19.3.0 | together | not started |
| `@types/node` to 22.20.2 | align to build target | not started |
| `electron` 43.4.1 to 43.7.0 then 44.3.0 | packaged smoke between | not started |
| `electron-builder`, `playwright`, `eslint`, `jsdom`, `vite`, `vitest`, `typescript`, `concurrently`, `glob`, `unpdf`, `@vitejs/plugin-react` | separate coherent groups, tested after each | not started |
| `npm ci` / packaged-runtime import verification | re-run in CI | `npm ci` unchanged in CI; package job still runs `licenses:check && package && verify:package` |

Every one of those is a separate change with its own verification, and none of
them is a prerequisite for the ownership work, which is why they were left rather
than half-done. The reason each is listed here rather than attempted in a batch
is the plan's own rule: one group at a time, tested after each.

Exit criteria: the pinned-runtime half is met (exact version recorded, contract
tests pass, licences regenerated, typecheck/lint/tests/build green). The "patch
stack upgraded" half is not.
