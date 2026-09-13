# Phase 10 handoff: proving the contract, and where the proof stops

This phase is verification. It is the one that says plainly what is provable now
and what is not, so that nothing is claimed as working because a checkbox was
ticked.

## What was run, and what it said

| Command | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm run lint` | clean |
| `npm run copy:check` | clean |
| `npx vitest run` | 317 files, 6913 tests, all passing |
| `npx vite build` | 6.4 s, main chunk 691.3 KB raw / 222.7 KB gzip |
| `node scripts/perf-report.mjs --check` | **fails**, 691.3 KB against a 450 KB limit. Measured, attributed, and recorded as an assessed exception (phase 9 handoff) |
| `npm run app:build` / `npm run package` / `npm run verify:package` | not run in this environment |
| Electron end-to-end, visual, packaged, clean-machine | not run |

## The scenario catalogue

None of the sixty scenarios is implemented as a named test. The honest mapping is
that the behaviours they describe are either covered by unit and component tests,
covered by construction with no test, or not implemented at all:

| Covered by a test | Covered by construction, no test | Not implemented |
| --- | --- | --- |
| Migration idempotence and record accounting (T09, T10), PR fetch/snapshot isolation (T12, T13), checkpoint identity under a partially staged tree (T14's precondition), workspace identity through symlinks and colliding names (T11), lock FIFO and cancellation (T18, T20's mechanism), extension trust before execution (T33), extension dialogs (T34), tab strip and keyboard (T46) | T01/T06 (no navigation-triggered writes remain: the write path was deleted), T19/T20 (request ids settle once, owner carried), T24/T25 (owner guards on overview, versions, files), T27's draft preservation (untouched behaviour), T44's preview frames (untouched) | T03, T04, T05 (partly: New worktree exists, handoff and fork do not), T07's orphan record cleanup, T15's full merge matrix, T16/T17's discoverable background runs, T21/T22's panes, T23 (per-conversation references), T26 (attachment ownership), T28/T29 (replay fidelity), T30 to T32, T35 to T45, T47 to T60 |

## Release gates

Blocked, by the plan's own list:

- Data loss, pre-trust execution, wrong-owner mutation, workspace corruption: the
  pre-trust and navigation-write gates pass; the rest has no end-to-end evidence.
- New/Resume/Continue/Stop/Close behaviour: Resume and Stop unchanged, Continue
  not implemented, Close no longer puts a checkout away.
- Silent workspace fallback or file movement during navigation: no longer
  possible by construction; not exercised in Electron.
- Extension input disappearing: dialogs are bound; terminal-only requests are
  visible; not exercised in Electron.
- Migration records accounted for: unit-proven, not exercised against a real
  profile.
- Core action usable at the minimum window size and by keyboard alone: not
  verified.
- Fresh build, packaged runtime and regressions: build and regressions pass,
  packaged runtime not run.
- Performance: the gate fails, with an assessed exception recorded.

## What a release would need before those gates pass

1. The phase 1.1 disposable profile and the real Electron smoke suite, so that
   T01 to T08 can be run against the actual shell.
2. Phase 8's retirement table, which also removes most of the main chunk's
   removable weight (phase 9's exception).
3. Phase 6.2 (runtimes out of the main process) before any claim that a hung
   extension cannot freeze the shell.
4. Phase 4's conversation registry and the Continue/Fork/Archive/Delete
   contract, without which "continue" still means what it always did.

## What this branch is safe to merge

Nothing in it removes a user-facing capability except two deliberate retirements
that the plan itself calls for: live mirror (the saved setting is preserved and
ignored, and merging is still one press) and the fake `lsp` capability. Every
other change either narrows what runs before consent, or moves an ownership
decision from "whichever tab is in front" to an explicit one. The migration runs
once, keeps backups, and does not move or delete anything.
