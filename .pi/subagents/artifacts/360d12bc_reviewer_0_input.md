# Task for reviewer

Lane 1 — CI / Lint / Typecheck / Build (fresh, read-only).
Repo: /Users/ownpathdesign/Desktop/graphe, PR #41 head 3bd145c feat/issue-35-plus-polish vs main.
Focus: CI run 33253795954 (Lint FAIL 41s, Typecheck PASS, Tests PASS, Build PASS). Previous head 360277c was green — this slice introduced regression.
Inspect:
- src/history/naming.ts:80 Regex /[\\s~^:?*[\\\x00-\x1f\x7f]/ flagged no-control-regex. Explain why, exact fix (eslint-disable vs charCode), and why local 'npx eslint .' shows 12 extra errors in notes/** (gitignored but not eslint-ignored) while CI shows only 1 error. Check eslint.config.js ignores, .gitignore, notes/**.
- 47 react-hooks/exhaustive-deps warnings in src/App.tsx + Annotate.tsx — are they safe? List missing deps and stale-closure risk.
- Build/typecheck gates: any hidden ts errors not caught?
- Propose minimal fix diff.
Output: JSON-ish report with files+lines, error vs warning, impact P0-P3, fix recommendation. Do NOT edit files.

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