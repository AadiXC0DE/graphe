# Task for reviewer

Lane 2 — Branch naming + git worktree + PR worktree (fresh, read-only).
Repo: /Users/ownpathdesign/Desktop/graphe, PR #41 diff 360277c..3bd145c (32 files) and full PR 100 files.
Inspect sources:
- src/history/naming.ts (slugFor, isSafeBranchName, branchNameFor, freeName, renameTo, NEUTRAL, MOST=44, NOISE/FILLER/RESERVED, isSafeBranchName regex control chars)
- src/history/worktree.ts (branchFor, folderLeaf, createWorktree, landWorktree, dropWorktree, putAwayWorktree, holdsWork/isDirty, writingLeftBehind/smallFilesUnder with MADE_AGAIN, RESCUE_FILES 2000 / 64MiB, branchNames, renameCheckoutBranch with %(upstream) + branch.*.remote checks, nextCheckoutName ENOUGH=200)
- src/history/checkouts.ts, repo.ts, timeline.ts
- electron/main.ts:nameBranchAfter (TOCTOU between branchNames snapshot and rename, concurrent first-message race, marked named:true even on rename failure, saveCheckouts), and worktreeLand/worktreeDrop guards for graphe/pr-* .
- electron/prWorktree.ts:preparePrWorktree (fetch origin pull/N/head, worktree remove --force + prune, branch -f graphe/pr-N FETCH_HEAD, fallback worktree add, error throws) + electron/main.ts:prReviewOpen / prWorktreePrepare handlers
- tests/branch-naming.test.ts
Enumerate edge cases: empty/filler-only/unicode/emoji/traversal/graphe/pr collision, MOST clipping, RESERVED, length>200, control chars/DEL/.lock/@{/ //, taken fallback 2..50 then null, two-tabs same-slug race, neutral check, pushed check, isSafeBranchName never rejects own mint, worktree folder/branch sanitization, isDirty vs holdsWork distinction, writingLeftBehind rescue tooBig leak, fetch failure/offline/origin renamed/private PR, concurrent prReviewOpen same PR, land blocked for pr worktrees but drop allowed, branch leak.
Output: tables of edge cases with expected vs actual, race windows, data-loss vs leak tradeoffs, test gaps. Do NOT edit.

## Acceptance Contract
Acceptance level: attested
Completion is not accepted from prose alone. End with a structured acceptance report.

Criteria:
- criterion-1: Return concrete findings with file paths and severity when applicable

Required evidence: review-findings, residual-risks

Finish with a fenced JSON block tagged `acceptance-report` in this shape:
Use empty arrays when no items apply; array fields contain strings unless object entries are shown.
`criteriaSatisfied[].status` must be exactly one of: satisfied, not-satisfied, not-applicable.
`commandsRun[].result` must be exactly one of: passed, failed, not-run.
`manualNotes` and `notes` are optional strings; an empty string means no note and does not satisfy `manual-notes` evidence.
```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "specific proof"
    }
  ],
  "changedFiles": [
    "src/file.ts"
  ],
  "testsAddedOrUpdated": [
    "test/file.test.ts"
  ],
  "commandsRun": [
    {
      "command": "command",
      "result": "passed",
      "summary": "short result"
    }
  ],
  "validationOutput": [
    "validation output or concise summary"
  ],
  "residualRisks": [
    "none"
  ],
  "noStagedFiles": true,
  "diffSummary": "short description of the diff",
  "reviewFindings": [
    "blocker: file.ts:12 - issue found, or no blockers"
  ],
  "manualNotes": "anything else the parent should know"
}
```