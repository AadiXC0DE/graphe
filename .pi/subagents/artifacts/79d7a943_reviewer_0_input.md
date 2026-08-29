# Task for reviewer

Lane 3 — Canvas DAG + migration (fresh, read-only).
Repo: /Users/ownpathdesign/Desktop/graphe, PR #41 canvas changes in src/work/canvas.ts (Block after: string|null -> readonly string[], LOOPS blocks after: number|null -> readonly number[], new join/unjoin/joined/canWaitFor BFS, remove splice, columns far()+walking set, tidy row=min(parents), nextUp every(parents), place/placeLoop, readFlow/readAfter compat, layOut).
Also UI in src/components/CanvasView.tsx + CanvasView.css (pulse line, traveling dot).
Inspect:
- Backward compat: readAfter handling of string, string[], null, '' , array with duplicates/empty/non-string, old files with single wait. Forward compat not needed but mention.
- DAG correctness: canWaitFor BFS vs old single-chain, cycle detection through diamonds, self-loop, missing id, null parent.
- join idempotency, unjoin nonexistent, joined toggle.
- remove splice: gone.after spliced into child's after, dedup + self-filter, case where gone.after empty or duplicate.
- columns far() memo + walking set for hand-edited cycles, tie-breaking for multi-parent depth (max).
- tidy row = min(parent rows) vs max far column — does a 2-parent block with parents at different rows pack incorrectly? Column collision only within column.
- nextUp every(done) vs old single-parent — stalls if OR semantics expected.
- place/placeLoop sanitization of unknown after ids.
- LOOPS migration after: [] vs [n], blocks referencing made[] ids.
- Performance with many blocks (far recursion).
List every scenario that can break rendering or start order, with file+line, and test gaps vs tests/canvas.test.ts (350 new lines).
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