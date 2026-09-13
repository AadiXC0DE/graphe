# Phase 1 handoff: the contract, the regressions, and the dangerous paths

Findings: W02, E03, A05, S08 (partial), Q01 (open), Q02 (partial).
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

## What phase 1 did not finish

| Item | Status | Owner |
| --- | --- | --- |
| Disposable application profile for tests | Not done. The shell still resolves everything under `app.getPath('userData')`; the fixtures and the migration runner take paths, so the seam exists, but no `--profile` switch or `GRAPHE_PROFILE` override was added | phase 1, retry |
| Electron smoke suite with a real window | Not done. `tests/e2e/scenarios.test.ts` is still the in-process scripted harness; its CI job is still named `e2e` | phase 10 |
| The nine phase 1.2 regressions | Partly. Covered by new tests: untrusted extension discovery (marker), extension asks (host + card), waiting panel ownership, listing honesty, workspace identity. Not covered by an automated test: "New B sees A's uncommitted edit", "selecting B changes nothing of A's", "A's image does not appear in B", "delayed A results after B selection", "restart resumes an isolated conversation's cwd". Each needs a real Electron run | phase 10 |
| Legacy unqualified-call counter | Not done | phase 5 |

Exit criteria: not met as written (the Electron-level evidence is missing). The
three containment changes are in, tested, and green.
