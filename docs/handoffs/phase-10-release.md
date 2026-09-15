# Phase 10 handoff: proving the contract, and where the proof stops

This phase is verification. It is the one that says plainly what is provable now
and what is not, so that nothing is claimed as working because a checkbox was
ticked. Everything below was run on this tree on 2026-09-15.

## What was run, and what it said

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run copy:check` | clean ("Shipped copy is clean.") — it was red earlier in this wave on `src/gallery/Gallery.tsx` and `src/components/NewWorktree.css`, and those were fixed while this was being written |
| `npx vitest run` | 347 files passed, 1 failed, 1 skipped (349); 6427 tests passed, 1 failed, 4 skipped. The failure is `tests/project-context.test.ts` "carries the project's items, named as the project's and not this chat's": the implementation writes `- the brief.pdf: what the site is for` and the test still expects the em dash that was there before the shipped-copy rule was applied to it. Both files are uncommitted work from another workstream, and it is a test pinning copy wording rather than a behaviour that changed |
| `npm run test:electron` | green: 1 file, 4 tests, 20.2 s. A real window on a profile nothing else uses: boot and the profile, two conversations and the connect-a-model path, a file written by a real tool call that the conversation beside it also sees, and a reply arriving in pieces in the order it was sent |
| `npm run test:packaged` | green on arm64: the installed app started with `PATH=/usr/bin:/bin`, a home and profile thrown away afterwards, and no global `pi`, npm or node. The window came up and was visible, the app reports it is packaged and on the disposable profile, the log records `started version=1.0.3 electron=43.4.1 node=24.18.1 runtime=0.85.1`, and Pi kept everything inside the profile. It says itself what it cannot prove: signing and notarization beyond the ad-hoc check, Finder and quarantine, a real provider, the terminal, and the x64 bundle on this machine |
| `npx vite build` then `node scripts/perf-report.mjs --check` | build 62 s; **fails**: main 577.2 KB raw / 184.7 KB gzip against the 450 KB limit. Recorded, attributed and accepted as a narrow exception (phase 9 handoff) |
| `npm run verify:package` | green on **both** bundles: each carries the pinned `@earendil-works/pi-coding-agent 0.85.1`, Pi's 83-package tree, node-pty with an executable helper and a verifying ad-hoc signature; every disk image opens onto `Graphe.app` |
| `npm run licenses:check` | "THIRD-PARTY-LICENSES.md describes everything installed (471 of 471)" |
| `npm run package` | not run for this handoff. The bundles and images in `release/` are the ones built on 2026-09-15, and `verify:package` passes on them |
| `npm run eval` | not run by hand; it runs in CI's Tests job, where a gate nobody runs is not a gate |

## The gates, as CI runs them

The workflow's gates are the ones the plan names, split so a failure says where
it is: **Typecheck** (`tsc --noEmit`), **Lint** (`lint` then `copy:check`),
**Tests** on macOS (`npm test` then `npm run eval`), **Build** (`build` then
`app:build`, then the launch-budget measurement and artifact), **Integration (in
process)** (`tests/e2e`, renamed so it cannot be read as the real-window suite),
**Electron smoke** (`npm run test:electron`), and **Package** (on macOS:
`licenses:check`, `package`, `verify:package`).

Against the plan's eight release-blocking conditions, honestly:

| The plan blocks a release on | Where it stands |
| --- | --- |
| Data loss, pre-trust execution, wrong-owner mutation or workspace corruption | The pre-trust and navigation-write gates pass and are tested. The rest has no end-to-end evidence at the Electron level; the workspace, checkpoint, PR-checkout, migration and merge suites are service-level |
| New/Resume/Continue/Stop/Close behaviour differing from the contract | Resume and Stop are unchanged; Continue, Fork, Archive and view-only Close are built and tested; the end-to-end window run covers none of them |
| Silent workspace fallback or file movement during navigation | No longer possible by construction (nothing on the open path writes), and `tests/close-keeps-worktree.test.ts` and the workspace-identity suite hold the destructive half; it is not exercised in Electron |
| Required extension input disappearing, or terminal mode bypassing permissions | Dialogs are bound, terminal-only requests are visible, and the real terminal says it is the person's shell and not the agent's. Not exercised in Electron. Terminal compatibility mode is not shipped at all (6.5), so there is nothing to bypass |
| Migration records not accounted for, or rollback not exercised | Migration accounting is unit-proven (`tests/migration.test.ts`, 14) but has not been run against a real profile; the rollback refusal is implemented and covered (`parseIndex`'s `future`, RELEASING.md "Rolling back"). What the move found is now on the Storage page rather than only in the log — the counts, the folder the `.bak` copies are in, and two presses, "Check again" (the same run, idempotent) and "Show copies" (`tests/migration-readout.test.ts` 10, `tests/migration-screen.test.ts` 8). A profile from a newer app says so on that screen with what to do, rather than only refusing silently |
| A core action inaccessible at the supported minimum size or by keyboard alone | Not verified: the visual and accessibility matrix (8.5) has not been done |
| Fresh build, packaged runtime or a required regression suite failing | Build, typecheck, lint, `copy:check` and the packaged app all pass; the suite is green except one assertion in `tests/project-context.test.ts` that pins an em dash the shipped copy no longer has (uncommitted work from another workstream, named in the table above) |
| Performance materially regressing without an explicit assessed exception | The exception is explicit: 577.2 KB against 450 KB, recorded, with the CI artifact keeping the number |

## The scenario catalogue

`docs/handoffs/phase-10-scenarios.md` (not this handoff) holds the row-by-row
mapping of the plan's sixty cases. Its state, counted from that file: **41 of the
60 name a test as the whole of their proof**, 3 are partly proven (`T04`, `T27`,
`T44`), and 16 are recorded as not provable today with the production change each
one waits on (`T03`, `T17`, `T21`, `T22`, `T24`, `T25`, `T30`, `T32`, `T35`,
`T36`, `T41`, `T45`, `T49`, `T50`, `T52`, `T59`) — 44 rows name a test somewhere,
41 of those for the whole case. Eleven suites under `tests/scenarios/` — run
here: **11 files, 115 tests, all passing**, 6.4 s — plus the four real-window
cases in `tests/electron/smoke.test.ts`.
Three defects that catalogue found are fixed, each with an ordinary passing test
now holding it.

## What remains, and who it waits on

1. **The visual and accessibility matrix (8.5)** — Electron at 620×520, 800×600,
   1100×780 and a large display; light/dark/system; 100–200% zoom; long titles;
   20+ tabs; keyboard-only use; reduced motion; a screen reader. Not started. It
   covers T45, T46 (the zoom and narrow-window halves) and the plan's minimum-size
   gate.
2. **A clean machine, properly** — from Finder, with quarantine and translocation
   in play, both advertised architectures, a notarized build and no ad-hoc
   signature standing in for one. The packaged smoke is most of the launch half
   and none of the Finder half.
3. **A real provider** — every run on this branch uses a scripted model or no
   model. Provider retry, compaction, usage accounting against a live service and
   the paid-fallback question (T31's retry half, T32) have no live evidence.
4. **The CI artifacts** — the Build job writes `launch-budget` (the table and the
   JSON) and nothing reads it back: there is no comparison against the previous
   run and no job that fails on a regression, by design, because the budget is
   already over. `npm run test:packaged` is not in CI at all, so the packaged
   launch is proven on this machine and nowhere else.

## What this branch is safe to merge

Nothing in it removes a user-facing capability except two deliberate retirements
the plan itself calls for: live mirror (the saved setting is preserved and
ignored, and merging is still one press) and the built-in `lsp` capability, which
was text search under a false name and is now `search_symbols_text`. Every other
change either narrows what runs before consent, or moves an ownership decision
from "whichever tab is in front" to an explicit one. The migration runs once,
keeps backups, and does not move or delete anything. What it is *not* safe to
claim from this handoff: that the interface is accessible at the minimum window
size, that a signed build behaves on a stranger's machine, or that anything above
has been proven against a real model provider.
