# PR 51 targeted release audit, 20 September 2026

Scope: the three reported UI glitches and the supplied PR review findings. This is not a claim that every possible bug has been eliminated.

| Finding | Confirmed cause | Targeted correction |
| --- | --- | --- |
| Copy feedback covers Fork here | Both labels were absolutely positioned into the same space. | Flow-based footer controls; feedback takes horizontal room without changing row height. Real Chromium geometry checked at 240, 280, 320 and 400px. |
| Work Value/Used headings overlap | Percentage columns and a fixed Used column left Value with too little width. | Reserve 64px for Value and let the location column take remaining space. Same geometry checks. |
| Phantom space before Worked for | Appending rows to the Fenwick height tree omitted older rows covered by each new tree node. Total height and prefix sums diverged, leaving a nonzero trailing spacer even at the last row. | Initialize each appended node with its full covered prefix. Regression appends and measures 129 variable-height rows and asserts zero trailing space. |
| P0 landing uncommitted work | A branch merge cannot carry changes held only in a checkout; force-removing it loses those bytes. | Refuse unsafe source removal; route reviewed uncommitted files through file-based landing and retain the source checkout. |
| P0 reopening a saved ID | A registry ID was passed to Pi as a transcript filename. | Resolve the registry's sessionFile before opening; draft-only IDs start a fresh session instead of continuing an unrelated one. |
| P1 queued send lock leak | The original admission object remains granted:false after its wait resolves. | Record acquired ownership after queue admission and release it on normal and early-exit paths. |
| P1 migration overwrites newer state | Migration used a registry snapshot across asynchronous discovery and backup operations. | Rebase on current registry state and check identity immediately before assignment; defer safely if updates keep racing. |
| P1 stale migration lock | A killed process left a permanent mkdir lock. | Owner records, dead-owner recovery and age-based recovery only for ownerless/invalid locks. |
| P1 canvas capacity stall / cross-run failures | Per-run capacity differed from process-wide limits; no mechanism resumed blocked lanes. | Shared capacity admission with cancellation wakeups and per-wave release. Regression coverage must include more lanes than capacity and concurrent flows. |
| P1 resumed lane has no runtime | Restored lane metadata acquired a lease without reopening its session. | Reopen the recorded conversation before a turn and retain its canonical identity. |
| P1 deleted chat leaves tabs/panes | Transcript filenames were passed to view state keyed by registry address. | Expose canonical address on conversation list rows and remove views by that address. |
| P1 child CI false/failing coverage | Child process could not see the parent's scripted provider; extension trust test never called trust. | Register the test provider inside the child and replace the no-op with exercised trust/runtime behavior. |
| P2 terminal helper error | Unpackaged CI helper lacked execute permission; spawn failure surfaced a raw native error. | Repair helper permissions in CI and provide an actionable, non-diagnostic-overclaiming error. |

## Verification

- UI/unit regressions: 87 passed across windowed rows, message copy, Work tokens and pane state.
- Real Chromium layout: all eight width/feedback combinations passed.
- Final backend verification, release build and publication: pending below; do not treat the table alone as release sign-off.

## Release accuracy

The prepared ownership release is 1.1.0. Package and site metadata are aligned. Landing-page wording now describes private checkpoints rather than commits on the user's branch. Release notes no longer claim the already-fixed empty-history bug is outstanding, and explicitly disclose test-only child runtimes and lack of notarization. Existing screenshots were not replaced without evidence that they misrepresent these changes.
