# Phase 1 handoff: the contract, the regressions, and the dangerous paths

Findings: W02, E03, A05, S08 (partial) done; Q01 closed — the harness is still
in-process and now says so, so nothing claims to be Electron UI; Q02 open and
counted below.
Branch: `fix/ownership-stabilization`. Baseline commit: `2b5bccb`.

## 1.3 Containment, before anything else

Three changes, each narrowing what runs or what is claimed.

**E03, code no longer runs before trust.** `src/agent/pi/adapter.ts` probed
every discovered extension to build a capability card, and a card is read by
importing the file and calling its factory. The trust filter ran afterwards, so
a cloned folder's `.pi/extensions/*` was executed by discovery alone.

- `src/agent/pi/extension-probe.ts`: new `cardsFor(paths, cacheDir, mayRun)`,
  which returns `null` for any path the caller may not run.
- `src/agent/pi/adapter.ts`: `probePermitted(projectRoot, trusts)` decides per
  path; installed add-ons (outside the project) are already consented to, a
  project's own extension needs the same yes its loading needs. Untrusted and
  unread are both `null`, which the policy already treats as the risky case.
- `theirsTrustedAndPolicied` now records an untrusted extension in `carried`
  even when the policy would also have dropped it, so the trust switch is still
  offered for it.
- Evidence: `tests/extension-trust.test.ts` (2 tests) uses a fixture whose first
  statement writes a file. Untrusted: the file is not there and the card is
  `null`. Trusted: the file is there and the card is the tool it registers. The
  fixture is copied into a temp folder, so the test leaves nothing behind.

**W02, opening a conversation stopped writing to the project.** `CHANNEL.openConversation`
called `bringBack`, so selecting an isolated conversation carried its files into
the project folder. Navigation was a mutation.

- The call is gone. What is said instead is a banner for that conversation:
  `ownCopyWords.whereItWorks(folder, project)` in `src/history/worktree.ts`,
  delivered through the existing one-shot note (`withNote`), plus the existing
  `ownCopy` flag so Merge/Delete stay offered. Nothing is copied.
- Evidence: absence of the call is structural; `tests/review-queue-wired.test.ts`
  asserts the settle path carries nothing home at all, and the merge path
  (`CHANNEL.worktreeLand`) is untouched and still tested.

**A05, a failed operation no longer claims the world is unchanged.** The generic
IPC catch said "Nothing else has been changed", which is a claim no service can
make. It now says the operation did not finish, that part of it may have gone
through, and to check before retrying; the cause is still kept for the
technical-details disclosure only.

## 1.4 The vocabulary

`src/domain/{identity,failures,events,conversations,workspaces}.ts` (added,
tested in `tests/domain.test.ts`, 21 tests): branded stable ids and a
epoch-scoped sequence, the five typed failure kinds including `partial-failure`
with its unknown effects, owner envelopes with a written-down staleness rule,
the eleven session states with their allowed transitions and a restart rule that
yields `interrupted` unless the runtime is demonstrably alive, and the workspace
kind/state/record vocabulary.

They are used by the registry and the locks (`electron/services/`), which phase 3
wired into the shell. The remaining consumers are listed in the phase 5 handoff.

## What phase 1 did not finish, and two findings it settles

Q01 is closed here (by naming, below); the Q02 suites and the A04 correction are
recorded here because this is Q02's phase.

| Item | Status | Owner |
| --- | --- | --- |
| Disposable application profile for tests | **Done.** `electron/profile.ts` resolves `GRAPHE_PROFILE` > `--profile=<path>` > the app's own folder, refuses a relative override, and `applyProfile` sets Electron's `userData` before anything asks for a path (called from `electron/boot.ts`). 9 tests in `tests/electron/profile.test.ts` | — |
| Electron smoke suite with a real window | **Done.** `tests/electron/smoke.test.ts` drives a real Electron window through Playwright against a built renderer and a disposable profile: boot, first screen, the profile being written (workspaces.json, the migration marker, logs), opening a project by pressing its row, a turn with no credential landing in the conversation and naming the tab, and a second conversation from the sidebar. `npm run test:electron` builds both halves and fails on the step that broke; a new `Electron smoke` CI job runs it on macOS | — |
| The nine phase 1.2 regressions | Partly. Covered by new tests: untrusted extension discovery (marker), extension asks (host + card), waiting panel ownership, listing honesty, workspace identity. Not covered by an automated test: "New B sees A's uncommitted edit", "selecting B changes nothing of A's", "A's image does not appear in B", "delayed A results after B selection", "restart resumes an isolated conversation's cwd". Each needs a real Electron run | phase 10 |
| Legacy unqualified-call counter | Not done | phase 5 |
| Q02, source-text wiring suites | Open, and counted below | phases 1, 3, 4, 5, 6, 8, 9, 10 by surface |

### Q01, closed by naming rather than by building

The finding is that the "e2e" scenarios run an in-process scripted harness, not
the actual Electron UI and IPC, so a green run there must not be read as the app
being driven. The harness is still in-process and still scripted — that is the
right shape for what it checks, since it runs the shell's own decision modules
(`electron/continuation-owner.ts`, `src/lib/projects.ts`, the step tools) with no
window. What changed is that nothing says "e2e" any more:

- The CI job is `integration:` / `name: Integration (in process)`
  (`.github/workflows/ci.yml:105-106`), with a comment naming the real-window job
  it is not: "integration coverage, not the real Electron suite, which is
  `electron-smoke` below".
- `tests/e2e/harness.ts` opens by saying what it is ("A whole Graphe turn,
  without Electron") and that the harness holds "the state those modules are not
  allowed to hold".
- The real-window layer exists and is a separate job and script
  (`npm run test:electron`, the `Electron smoke` job), so there is somewhere to
  point when somebody asks for the app driven for real.

What is still not claimed anywhere: that `tests/e2e` drives Electron. Closing
Q01 means saying so, which is now true in three places rather than one.

### Q02, which suites still assert source text, and who converts them

Thirteen suites read project source with `readFileSync` and assert over the text
rather than over behaviour. Each carries a `Source text, not behaviour:` note in
its header naming the seam that cannot be reached from a test — that convention
is invariant 20 of the plan's Appendix B, and these are the suites it applies to.
142 tests between them. Every one is green on this tree (run 2026-09-16).

| Suite | Tests | What it guards | Converted by |
| --- | --- | --- | --- |
| `tests/actions.test.ts` | 26 | The action registry and the palette's chords agree: every action has a name, a place and a chord, no two answer to one key, and what the palette prints is what the keyboard does | phase 8 — needs App mounted; the repo has no hook harness (`@testing-library/react` is not a dependency) |
| `tests/key-editor.test.ts` | 12 | The App key handler asks the registry rather than comparing keys, and the Settings chord row is the row itself | phase 8, same harness |
| `tests/panel-bands.test.ts` | 20 | The panel's bands, its markup, the App's review-queue and diff wiring, two stylesheets | phase 8 — nothing renders the panel today and jsdom never applies a stylesheet |
| `tests/screen-names.test.ts` | 10 | One name per thing across the remaining screens (U03), read off the modules that carry them | phase 8 — the honest form is the accessible names of a running window, which `scripts/visual-matrix.mjs` already reads through CDP |
| `tests/views-arrive.test.ts` | 13 | The window's render and effect wiring around twenty lazy views, so a press never suspends the root boundary to a blank frame | phase 9 — the vehicle is the real window (`tests/electron/smoke.test.ts` already reloads it mid-run) |
| `tests/listeners.test.ts` | 5 | Every `ipcRenderer.on` in the preload has a matching `off`, and every App subscription has a cleanup | phase 1 — count listeners on a real window before and after a conversation switch |
| `tests/close-is-a-view.test.ts` | 12 | The close, stop and interrupted-run handlers: closing is a view, Stop ends a run. The decision half already runs for real against `Sessions` | phase 4 — the handler half needs the channel addressable rather than closed over inside `register()`, which is the phase 1 contract's job |
| `tests/close-keeps-worktree.test.ts` | 6 | That closing puts nothing away and deleting keeps the copy — the git half is already run against real repositories | phase 3 for the handler half (the git half needs nothing) |
| `tests/app-sent-turn.test.ts` | 13 | The window reading the shell's `busy` flag, and the shell clearing a hold when a card is answered | phase 4 — joins unrendered `App.tsx` to `electron/main.ts`; the real window can drive it |
| `tests/always-wired.test.ts` | 10 | The three moments the always list runs at, only what the Guard allows, and an unreadable file being said out loud | phase 6/7 — the in-process harness (`tests/e2e/harness.ts`) builds a real session |
| `tests/durable-writes.test.ts` | 2 | That nothing writes a durable file in place, and the atomic helper's scratch is a neighbour | phase 10 — this one is a rule over every module rather than a surface; the conversion is a lint rule or nothing |
| `tests/newer-build.test.ts` | 5 | The update push from the shell to the sidebar row | phase 10 — needs Electron and a release feed; a stub feed in the real-window suite is the vehicle |
| `tests/overview-roots.test.ts` | 8 | That one overview answer is about one folder (W10). The resolver, the git readers and the two root-following pieces are lifted out of `electron/main.ts` and run for real; only the lift's wiring is read as text | phase 5 — half converted already; the remainder is the `CHANNEL.overview` handler |

Not counted here, because they run real code and read source only for a lift or
a scan: `tests/panes.test.ts` (the pane model is exercised directly; the App
wiring is read), `tests/recovery-surface.test.ts` (the decision runs; the open
branch is read), `tests/pr-checkout.test.ts`, `tests/migration-readout.test.ts`
and `tests/external-changes.test.ts` (all run their subject).

### A04's addendum in the plan does not describe this tree

The plan's Appendix D carries an "additional inspected checkpoint path" that
strengthens A04: it says `ProjectHistory.snapshot` stages `--all` within its root
and commits with `--no-verify`, and that `Timeline.snapshot` uses that method for
automatic boundaries, so a save interferes with a partially staged file and with
hook expectations. **Both halves are true of the audit's tree and false of this
one**, and the plan is gitignored so this is where the correction lives.

- `src/history/repo.ts` builds the tree in a scratch index of its own —
  `GIT_INDEX_FILE` set to a file in the temp directory, `read-tree` then
  `add --all` then `write-tree` (`candidateTree`, `:1188-1202`), committed with
  `commit-tree` (`:612`) and moved onto `refs/graphe/checkpoints` by
  compare-and-swap (`update-ref`, `:622`). Nothing reaches the folder's index, so
  a half-staged file stays half-staged.
- `--no-verify` appears **nowhere** in `src/`, `electron/` or any test the suite
  runs; the only occurrence in the repository is
  `scripts/package-app.mjs:36`, a flag on the packaging script's own command line,
  and `tests/landing-squash.test.ts:83` passes one to a git commit it makes itself.
  A `commit-tree` does not run hooks and does not sign, which is why the concern
  does not apply to the checkpoint path at all.
- `Timeline.snapshot` (`src/history/timeline.ts:137`) does call `this.folder.snapshot`
  for automatic boundaries, as the addendum says — but it is the rewritten
  `ProjectHistory`, so it inherits the scratch index rather than the interference.

`tests/checkpoint-safety.test.ts` (8) is the regression that replaces the
addendum's conjecture: it compares HEAD, branch, status, staged diff, working
diff, local config and `refs/heads` byte for byte around a save with a partially
staged file, and includes a case with `commit.gpgsign` on and a hook that would
have stopped a commit. The plan's own totals are wrong for the same reason and
are recorded in the phase 10 handoff.

Exit criteria: the three containment changes are in, tested and green, and the
real-window layer now exists and runs in CI (`Electron smoke`), where it boots
the shipped app on a disposable profile, opens a project by pressing its row and
holds two conversations apart — and runs a real turn through the scripted
provider (`GRAPHE_TEST_MODEL`, `tests/electron/scripted-model.ts`), which is what
closed T01's window half and T47's streaming half. Still missing at that layer:
T21 needs two live panes, T25 needs a hook harness, and the rest of the 1.2 list
above needs a script in the suite.
