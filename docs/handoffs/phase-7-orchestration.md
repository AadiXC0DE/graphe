# Phase 7 handoff: one orchestration model, and tools that tell the truth

Findings: A01 done, A02 done, E06/E07/E08 done, E12 open, A03 done except the
second pane, S05 open.

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

**E07, one admission point for every turn.** `src/work/admission.ts` is the door,
and the decision is pure: one typed request — `user`, `steer`, `follow-up`,
`explicit-goal`, `child-result`, `extension` — against the facts the seam that is
asking can actually see. Those are the run in hand and whether it was stopped,
the cancellation epoch the request was made in, whether there is a run in flight
to steer into, somebody being asked something, who is writing in the folder,
whether anything can answer, and the rounds spent of the budget. A seam leaves
off a fact it cannot see rather than guessing, and what is unknown admits: a fact
nobody can see may not stop somebody's work. A refusal that has something to say
carries the sentence the person is shown — a turn that did not start is
otherwise indistinguishable from one that started and did nothing — and where
saying it would only be noise (a stop they pressed themselves, a question they
are reading) it says nothing at all.

| Seam | Requests it makes | What it can see |
| --- | --- | --- |
| `src/agent/pi/adapter.ts` `mayBegin`, the first statement of `prompt` and of `steer` | `user`, `steer` | whether a run is in flight |
| `electron/continuation-owner.ts` `settled`, before its single send path | `follow-up`, `explicit-goal`, `child-result`, `extension` | the run, its epoch, the round budget, whether somebody is being asked something |
| `electron/continuation-owner.ts` `extensionAsked` | `extension` | the same, and that Pi has already begun the turn |

A message the app sends on somebody's behalf arrives at the adapter as an
ordinary `prompt`, so the seam that can tell a message the person typed from one
the app decided on is the owner's, and every reason of the app's is admitted
there before it is sent.

The order the owner decides in is the order the reasons are tried in
`src/work/continuation.ts` `decide`: an add-on's ask, a board piece landing, the
checklist, the goal, recovery — and one send per settle whatever of them is
present. Where the file leaves off: the folder lease, which the shell enforces by
making the second conversation wait for the lock rather than refusing it, and
whether a model can answer, which nothing before a call can know — Pi binds one
when the session is made and says so itself when it cannot. Both facts are in the
decision and neither is claimed at a seam that cannot see them.

`Stop` moves the epoch on: `electron/continuation-owner.ts` `stopped`, reached
from both the carrying-on `Stop` and the ordinary one (`electron/main.ts`,
`CHANNEL.stop` and `CHANNEL.continuationStop`). A board piece or an add-on's ask
that arrives after Stop then belongs to a run that is over — the door turns it
down as a stale epoch, and it is a result to read when the person comes back
rather than a reason to start again. A steered line with nothing running is
refused with a sentence rather than pushed onto Pi's queue, where Pi would have
dropped it without a word.

**E06, hooks run whole or not at all.** `src/agent/pi/extension-policy.ts`
`policyFor` never half-loads an add-on. A conversation runs it whole, hooks and
tools together, because an add-on whose tool starts work and whose hook delivers
the result is otherwise launched and never heard from again — and what made those
hooks dangerous (a second thing deciding when work begins) is handled by the door
above, where an add-on's ask is one reason among the owner's own, counted against
the same budget and named out loud. `tools-only` is honoured only where the
add-on itself declares it, by exporting `grapheToolsOnly === true`
(`src/agent/pi/extension-probe.ts` `declaredToolsOnly`, carried as the card's
`toolsOnly`): a card read from the outside cannot tell a tool that finishes
inside its own call from one whose result arrives later. Asked for and not
available, the add-on runs whole and the person is told once, in
`saysToolsOnlyRefused`; where Graphe is driving (a board piece, a helper, a
canvas) an add-on that starts turns of its own is `off`, and `Off` is stated in
the list rather than left as silence. `tests/extension-policy.test.ts` (14
tests).

**The limit on turns an add-on starts, stated rather than covered.** Pi's
extension API has hooks that fire before a request goes out, and none of them is
a refusal. `before_provider_request` is a payload transform — a handler's return
value becomes the payload (`dist/core/extensions/runner.js`
`emitBeforeProviderRequest`), and a handler that throws is recorded as an error
and the call goes on. `before_agent_start` fires after a prompt has been
submitted and can add a message or replace the system prompt, not cancel;
`context` and `before_provider_headers` transform. There is no result type
anywhere in that list that means "do not make this call", so a turn an add-on
begins inside itself cannot be refused before it starts. What the host does is
everything short of a claim it cannot keep:

- **Host admissions are enforced** for every turn Graphe starts, at the door
  above, before the call.
- **Extension-origin turns are monitored.** Pi's own `message_start` for a
  message carrying the add-on's `customType` is read as an `extension-turn`
  (`src/agent/pi/events.ts` `extensionTurnOf`), dropped while a person's own turn
  is in flight because it is part of that turn, and otherwise handed to the
  authority (`electron/main.ts` `forwardTo`), which counts it against the same
  round budget and names the add-on when the job rests.
- **An overrun is interrupted.** Past the budget the authority calls `halt`,
  which stops the session that is already running, and says the same sentence
  every other stop says.

What is *not* claimed: a hard preflight spend cap for extension-origin turns. Pi
begins such a turn inside the add-on, and a trusted add-on calling a provider
directly — its own client, or a provider it registered — never crosses any seam
Graphe has; the Guard sees tool calls, and that code does not make a tool call.
A ceiling over that would be a guard in the shape of a lie. The lever that does
exist is `policyFor`: an add-on that starts turns of its own can be run tools
only where it says it can, or turned off, per conversation. A real quota needs
process or network architecture rather than a prompt rule.

Tests: `tests/admission.test.ts` (15; the order of the decision, the words, and a
real session refusing a steered line with nothing running),
`tests/extension-turn.test.ts` (11), `tests/continuation-owner.test.ts` (25; the
epoch, a child that finishes after Stop starting nothing, and a run that failed
after Stop not being picked up), `tests/continuation.test.ts` (71).

## Not done

| Finding | Status |
| --- | --- |
| ~~A02, prompt truncation~~ | **DONE after the first draft.** `src/agent/pi/prompt.ts` assembles named sections in fixed precedence (runtime, repository, skills, extensions, plan, optional memory) with caps that carry a pointer to the file rather than a silent cut; optional memory is what gives way, and the drop is stated in the prompt; a required instruction survives any budget (tested); the estimate is labelled an estimate. Project instruction files now come from Pi's own context paths, so Graphe's duplicate `<agents_md>` block is gone (`src/lib/agentsMd.ts` deleted). Advisor settings are held by one conversation at a time instead of being rewritten on every turn. 11 new tests in `tests/advisor-scope.test.ts` |
| A03, competing continuations | Done except the second pane. The last competing loop was the canvas flow's settle-driven continuation, and it went with phase 8's row 5; `electron/continuation-owner.ts` is the one send path per conversation, with `tests/continuation-owner.test.ts` holding one send per settle and the ordering when a person's message, an add-on's ask and a child's completion arrive together. What remains is the second pane (8.3), which is what would make T21/T22 reachable |
| ~~E06, lifecycle hooks~~ | **DONE after the first draft.** Whole or not at all, with `tools-only` only where the add-on declares it — see above |
| ~~E07, admission point~~ | **DONE after the first draft.** One typed request against the facts the asking seam can see, and the limit on turns an add-on starts reported rather than covered — see above |
| E12, advisor scope | Open |
| S05, held-work slots | Open |
| 7.5 removing designer-specific prompt instructions | Not a defect on this tree. The prompt assembly (`src/agent/pi/prompt.ts`, `standing.ts`) names no designer workflow and hides no Git term; `CLAUDE.md` (untracked) was read and states the new product contract without naming a removed control, so it was deliberately left alone rather than rewritten for churn |

Exit criteria: the tool-truthfulness criterion passes (no fake LSP capability is
advertised, and the name says what the tool does). The admission ordering is
tested — `tests/admission.test.ts`, `tests/continuation-owner.test.ts` and
`tests/extension-turn.test.ts`, named above — including one send per settle when
a message somebody typed, an add-on's follow-up and a child's completion arrive
together, and a run that was stopped staying stopped when the settle after it
reports a failure, when a child finishes, or when an add-on starts a turn of its
own. A required instruction surviving any budget and the optional notes giving way
first are held by `tests/prompt-budget.test.ts`; long repository instructions keeping
their semantics with a pointer rather than a silent cut are held by
`tests/standing-block.test.ts`. What is not held: a test for the no-false-checklist
rule beyond `tests/continuation.test.ts`'s decision cases, and the second pane
(8.3) that would make two-view behaviour reachable.
