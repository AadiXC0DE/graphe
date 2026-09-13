# Phase 7 handoff: one orchestration model, and tools that tell the truth

Findings: A01 done, A02 partial, E08 done, E06/E07/E12 open, A03 open, S05 open.

## Done

**A01, the built-in `lsp` tool is gone.** It scanned for TODO markers and called
the result diagnostics, and its rename matched text. `src/agent/pi/lsp.ts` became
`src/agent/pi/search-symbols-text.ts`, registering `search_symbols_text` and
saying in its own description that it searches text and uses no language server.
There is no rename path at all; `op: 'rename'` says so. The Guard's read/search
tool lists, `describe.ts` labels, `FEATURES.md` and the site copy were updated
with it; `tests/lsp.test.ts` became `tests/search-symbols-text.test.ts` (16
tests), and the old assertions about semantic capability were deleted rather
than re-pinned. An installed language server's own `getDiagnostics`/`renamePreview`
tools are untouched.

**E08, a hook timeout stops pretending.** `src/agent/pi/hook-budget.ts` records
whether an overrun handler is known to have stopped, threads an `AbortSignal`
where the handler declares a slot for it, refuses to re-run a handler whose
previous run was abandoned and never stopped, and exposes `hookStillRunning`.
The adapter's overrun notice and `showme`'s why-stopped line now say a handler
may still be running instead of implying it stopped. `tests/hook-budget.test.ts`
(14 tests).

## Not done

| Finding | Status |
| --- | --- |
| A02, prompt truncation | Open. `standing.ts` still truncates the combined prompt at fixed character counts; the structured sections and progressive resource reads the plan asks for are not built |
| A03, competing continuations | Open. The board/goal/checklist loops are untouched, and phase 8's retirements are not done, so nothing was unified |
| E06, lifecycle hooks | Open |
| E07, admission point | Open: no typed request/admission record, and no pre-turn interception |
| E12, advisor scope | Open |
| S05, held-work slots | Open |
| 7.5 removing designer-specific prompt instructions | Not done. `CLAUDE.md` was not edited either (it is untracked, see the phase 8 handoff) |

Exit criteria: the tool-truthfulness criterion passes (no fake LSP capability is
advertised, and the name says what the tool does). The admission-ordering,
no-false-checklist and long-instruction tests do not exist.
