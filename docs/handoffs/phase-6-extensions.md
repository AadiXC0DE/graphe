# Phase 6 handoff: a complete, honest extension host

Findings: E01 done (dialogs), E03 done (phase 1), E04 partial, E05 open, E06
open, E07 open, E08 done (phase 7), E09 open, E10 open, E11 open, E12 open.

## Done

**E01, Pi's extension UI is bound.** Graphe never called `bindExtensions`, so
every installed add-on got Pi's default interface, which selects nothing,
declines every confirmation and drops notifications, while the add-on carried on
as though somebody had answered.

- `src/agent/pi/extension-ui.ts`: `dialogsOver()` implements select, confirm,
  input and editor for real; `unsupportedTerminal()` records each terminal-only
  call once and says so. `cancelledLike()` is the fallback when there is nobody
  to ask: a cancelled answer in the shape of the question, never a made-up yes.
- `src/agent/pi/adapter.ts`: `createSession` binds a UI context with
  `mode: 'rpc'` after the session exists and before the first prompt. Values are
  kept apart from labels on select; a cancelled dialog returns undefined; a
  confirmation nobody answered is `false`. `notify` arrives as a `notice` with
  its severity in the words; `setStatus`, widgets, footers, headers, custom
  components, terminal input, the theme APIs and the editor component hooks are
  recorded as terminal-only rather than silently succeeding, and the ones that
  return promises reject. An add-on that throws is reported through `onError`
  instead of vanishing.
- `src/lib/extension-ask.ts`: the wire shapes, dependency-free and Pi-free.
- Channels: `extensionAsk` (main to window) and `extensionAnswer` (window to
  main). The main process holds the pending requests, honours an add-on's own
  timeout, and settles everything still waiting as cancelled when the run stops
  or the conversation closes.
- `src/components/ExtensionRequest.tsx`: the card, with a way out of every
  question that means "nobody answered", which is not the same as "no".
- Evidence: `tests/extension-ui.test.ts` (15) and
  `tests/extension-request.test.ts` (10).

## What is not done, and what it costs

| Finding | Status |
| --- | --- |
| E02, a real terminal surface | Not started. The Commands drawer is still output-only. `@xterm/xterm` and a PTY implementation are new dependencies the plan asks to evaluate before adopting; none was added |
| E04, probe timeouts | Partial. The gate removes pre-trust execution; a trusted extension's factory that spins synchronously still cannot be interrupted by a `Promise.race`. The plan's answer (a disposable process) is not built |
| ~~E05, card cache~~ | Done after the first draft of this handoff. The cache is keyed on a SHA-256 fingerprint of the extension's own files (the whole folder, not just the entry file, since a local add-on is usually a directory of modules) plus the installed Pi version, and written through the atomic writer so two sessions probing at once cannot leave half a file. Corrupt rows are dropped one at a time, and a cache that cannot be parsed is empty rather than fatal. Two new tests: a file the entry does not name changing invalidates the card, and a truncated cache re-probes and rewrites |
| E06, tools-only policy | Open. `policyFor` still returns 'on' for a conversation, so no hooks are deleted there, but the plan's coherent enable/disable story is not built |
| E07, admission before a turn starts | Open. `forwardTo` still accounts after a turn has begun |
| E09, tool collisions | Open. Duplicate names between Graphe's built-ins and an installed add-on are not detected at registration |
| E10, package lifecycle | Open. Installing or removing a package does not rebuild live session instances, and there is no `Installed; reload this chat to activate` state |
| E12, advisor settings | Open. The advisor choice is still a global file rewritten around turns |
| 6.2, agent runtimes in a child process | Not started. Extension code still runs on Electron's main event loop, which is what makes a synchronous loop in a trusted add-on a hang for the whole app. This is the largest unbuilt piece of the plan |

Exit criteria: "no executable code before the trust decision" is met and tested;
"generic extension UI requests work in two concurrent conversations without
cross-answering" is met by construction (each request carries the conversation
that asked, and an answer settles exactly one request id) but is not exercised
end to end in Electron; the hung-extension, package-lifecycle and terminal
criteria are not met.
