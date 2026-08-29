# Task for reviewer

Lane 4 — Plan gate + Goal + Advisor + LSP + AGENTS.md (fresh, read-only).
Repo: /Users/ownpathdesign/Desktop/graphe, PR #41.
Inspect sources:
- src/work/goal.ts, src/projects/goals.ts, electron/main.ts planMode Held (held.planMode, deskFor planHeldOn, runWhatCan early return when planHeldOn, checkItFirst planMode capture), goalVerify/real checks, ROUNDS=12/20, goal persistence.
- src/work/canvas.ts goal block words, src/agent/plan.ts
- src/lib/agentsMd.ts (86 lines), AGENTS.md handling, non-git walk
- src/agent/pi/lsp.ts (596 lines): MIN_SYMBOL 3, MAX_FILES 3000, MAX_RENAME_FILES 100 / 1000 occurrences, SOURCE_EXTENSIONS allowlist, GENERATED/MANIFEST/BINARY_EXTENSION/BINARY check looksBinary \u0000/\uFFFD, SKIP_DIRS, escapeRegExp, isRenameable, ignoredNames reads root .gitignore only, rename writes every matching file, preview, credentials left alone.
- src/agent/advisor.ts (192 lines), advisorThinking
- src/agent/guard/policy.ts changes
- tests/advisor.test.ts etc.
Enumerate edge cases: plan toggle mid-copy vs mid-piece, goal baselineN, verify no tsconfig/tsc missing -> passed:false, settle only on checked.ok&&passed, goal leak across projects, advisor depth, LSP short symbol 2 chars rejected, huge rename >100 files refused, binary file destroyed via \uFFFD rewrite, GENERATED/MANIFEST skip, .gitignore glob ignored, hidden .git paths, credential paths, word-boundary rename catching comments/strings, case sensitivity.
Do NOT edit.

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