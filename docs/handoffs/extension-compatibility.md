# Extension compatibility matrix

Phase 6.3 binds Pi's extension UI for real, and the plan asks for the result to
be recorded honestly rather than described: what an add-on may call here, what
it gets back, and where the answer is a refusal rather than a feature.

Every row below is marked **native GUI**, **terminal-only** (refused out loud),
**unsupported** (the app has no surface for it, and the row says so where the
pause is) or **failed** (the plan's required behaviour is not met). Each row
carries the file and line the behaviour lives at, and the test that proves it —
or says plainly that nothing proves it yet.

The add-ons the rows are exercised with are real factories in
`tests/fixtures/extensions/` — `notices`, `asks`, `abortable`, `custom-tui`,
`streamed`, `media`, `messages`, `unknown-tools`, `hook-throws`, `hook-never`,
`async-results`, `transitive`, `removed-midrun`, `install-fails`,
`agent-brief`, `agent-tally` and the rest. The inventory at the end maps each
one to the operation it stands for. `tests/extension-compat.test.ts` imports
each of them, hands it the API this host binds, and drives the hooks and tools
it registered.

## Where `hasUI` is advertised, and what it does not promise

`createSession` binds a UI context after the session exists and before the first
prompt (`src/agent/pi/adapter.ts:3137`, the face itself built by
`uiContextOver`, `src/agent/pi/extension-ui.ts:203`), and it binds it with
`mode: 'rpc'` (`src/agent/pi/adapter.ts:3147`).

Pi answers `hasUI` with "there is a UI context at all" — `hasUI() { return
this.uiContext !== noOpUIContext }`, `node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/runner.js:318`
— so an add-on here sees `ctx.hasUI === true` and `ctx.mode === 'rpc'`
(`runner.js:269`, `runner.js:512`). That is the only sense in which UI presence
is advertised: **it is not a promise that any particular method works.**

What is deliberately not promised, and what an add-on actually gets:

| Advertised as | What it really is here |
| --- | --- |
| `hasUI: true` | Dialogs are answered by the window; every terminal-only method is refused with a reason (rows 6–12). |
| `mode: 'rpc'` | What an add-on is supposed to check before asking for composited terminal UI. Nothing composites it: a widget, footer, header, component, theme or raw key handler is refused. |
| `notify` | The notice arrives, and the add-on's own name is on it: Pi's `notify` carries no origin (`runner.js:273`, which wraps only select/confirm/input/editor/custom), so the name is read off the call stack at the moment of the call and prefixed by `uiContextOver` (`src/agent/pi/extension-ui.ts:214`, `:301-303`). A frame no add-on owns is no name rather than a guess. |
| command context | Pi fills the command context with no-op actions when none are bound (`runner.js:258`), and none are bound here (`src/agent/pi/adapter.ts:3137-3155`). |

## The plan's table, row by row

| # | Operation (6.3) | What the plan requires | What happens now | Where | Proof |
| --- | --- | --- | --- | --- | --- |
| ~~1~~ | `notify` | Notice with extension name and severity; accessible history entry; never silently discarded | **native GUI**, all three. The add-on's own words arrive as a `notice` event with the severity in them (`warning: …`, `error: …`) and the add-on's **name** in front, read off the call stack at the moment of the call — a frame no add-on owns is no name rather than a guess (`whoCalled`, `src/agent/pi/extension-ui.ts:214`). The notice is written into the conversation's own record as Pi's `custom` entry, so reading the conversation back brings it while the model never sees it. What is still not a *history* entry in Pi's sense: a notice is shown to the person and not offered to the model, which is the point of the entry chosen | `src/agent/pi/adapter.ts` (`recordNotice`, `sayAboutAddon`), severity at `src/agent/pi/extension-ui.ts:301`, record read at `src/agent/pi/history.ts:407`, event shape `src/agent/types.ts:393` | `tests/extension-compat.test.ts` ("says all three severities", "names nobody when two add-ons could both claim the frame"); `tests/addon-notice.test.ts` (7: the name on every path, and the notice still readable after the conversation is opened again) |
| 2 | `select` | Standard choice dialog or inline request; values kept apart from labels; cancel returns the supported cancellation value | **native GUI** — the question goes to the window, `label` and `value` travel separately, a cancelled select is `undefined` | `src/agent/pi/extension-ui.ts:61-76`, request id and ownership `electron/main.ts:5892-5932`, withdrawn on stop/close `electron/main.ts:5875` | "reach the person as the add-on wrote them…", "come back as an answer nobody gave"; `tests/extension-ui.test.ts`; concurrent conversations `tests/scenarios/writer-lease.test.ts` |
| 3 | `confirm` | Explicit yes/no showing origin/action; no default auto-yes; no silent no caused by missing UI | **native GUI (partial)** — a yes only when the window says yes; nobody answering is `false`, never a yes; the origin/action the add-on wrote is shown, but the add-on's name is not | `src/agent/pi/extension-ui.ts:77-83`, fallback when there is no window `electron/main.ts:5866` | "come back as an answer nobody gave…"; `tests/extension-ui.test.ts` |
| 4 | `input` | Text input request; honour abort/timeout; secret field if the contract supports it | **native GUI (partial)** — timeout honoured end to end (`extension-ui.ts:48` → `extension-ask.ts:17` → `electron/main.ts:5916`); **the abort signal is not carried** (see gap G1); Pi's `input` has no secret option, so there is nothing to honour | `src/agent/pi/extension-ui.ts:84-91`, `electron/main.ts:5916-5919` | "is not settled by the add-on's own abort today"; timeouts in `tests/extension-ui.test.ts` |
| 5 | `editor` | Multiline editor dialog; preserve draft; cancel without sending | **native GUI** — the prefill travels, a closed editor returns `undefined` and nothing is sent | `src/agent/pi/extension-ui.ts:92-96`; the card's draft `src/components/ExtensionRequest.tsx` | `tests/extension-request.test.ts:122-134` (prefill shown, cancel answers `null`); `tests/extension-compat.test.ts` ("the editor was closed") |
| 6 | `setStatus` / working message | Namespaced status entries; clear by extension key and instance; old instance cannot clear new status | **unsupported** — there is no status surface: every `setStatus` is refused once per session with a notice, and the working message is accepted and drawn nowhere with no notice. Nothing is stored, so two add-ons cannot clobber each other, but nothing is shown either (gap G2) | `src/agent/pi/extension-ui.ts:216` (`setStatus`), `:218-222` (working message and friends), refusal words `saysAddonCannot`, `:257` | `tests/extension-compat.test.ts` ("does not pretend to have a footer", "accepts the working message and draws it nowhere") |
| 7 | Plain text widget | Collapsible extension section; bounded output; owner-scoped; survives replay where appropriate | **unsupported** — a string-array widget is refused with the component form and told it needs a terminal, although the plan's row is about plain text, which a window could draw (gap G3) | `src/agent/pi/extension-ui.ts:226` | "has every terminal-only call refused out loud, once each" |
| 8 | Custom messages | Generic message with text/content/resources; preserve display intent/provenance and durable payload | **native GUI** — `extension-said` with the add-on's `customType` as provenance, `display: false` honoured, pictures drawn and files named; a message that starts a turn is announced as `extension-turn` | `src/agent/pi/history.ts:208` (`saidByAddon`), `:94` (content reader), live turn `src/agent/pi/events.ts:154` | `tests/extension-compat.test.ts` ("travels with the add-on's name", "keeps a message it asked to hide", "is announced as the add-on's turn"); `tests/session-replay-fidelity.test.ts:238`, `tests/scenarios/transcript-replay.test.ts:178` |
| 9 | Custom tool call/result | Generic tool record: name, structured input, output, status, duration; expand/download large output; show unknown content type explicitly | **native GUI (partial)** — the name is whatever the add-on called it, the step closes `ok`/`failed`, a `details.note` line travels, streamed output arrives as `tool-progress`, big output is summarised and kept, and the replay names what a line has no room for. Live, a non-text, non-image content block is dropped (the record names it); the event carries **no duration** (gap G4) | translation `src/agent/pi/events.ts:244-268` (progress, end, picture at `:303`), record `src/agent/pi/history.ts:170` and `:138` | "two third-party helpers with different schemas", "a step that says what it is doing", "draws the picture on the step", "names the file when the conversation is read back" |
| 10 | Slash command | Command registry item with extension origin; respect command context, current conversation and busy-state rules | **unsupported** — the command is counted on the capability card (`extension-probe.ts:81`) and goes no further: the composer's `/` list is built from the project's prompt files (`src/components/Composer.tsx:365`, `src/agent/pi/workflows.ts:48`), and no command context actions are bound, so Pi fills `waitForIdle`/`newSession`/`fork`… with no-ops (`runner.js:258`) | `src/agent/pi/adapter.ts:3137-3155`, `src/components/Composer.tsx:365`, `runner.js:258` | "counts an add-on's command on its card, and registers none in the picker" (gap G5) |
| 11 | Shortcut | Registered action in a scoped keyboard layer; detect conflicts; reserve Stop and core navigation; show resolution | **unsupported** — nothing in `src/` or `electron/` reads `api.registerShortcut` registrations or Pi's `shortcutDiagnostics`. Worse than silent: Pi warns to the console only when there is *no* UI (`runner.js:369-371`), and there is a UI here, so a conflict (including one over a reserved keybinding, `runner.js:7-18`) is not reported anywhere at all (gap G6) | `runner.js:360-372`, `runner.js:7-18`; no app-side reader exists | "records a shortcut claim twice over, and Pi is where a conflict is worked out" |
| 12 | Custom TUI/component, custom editor/footer/header, terminal input | Terminal compatibility mode; never serialize executable component factories to the renderer or simulate success | **terminal-only, refused out loud** — `custom` rejects, the theme getter throws, every other terminal-only call is recorded once per session and reported as a notice naming the method. No component factory crosses to the renderer, because none is asked for one. There is no terminal mode to hand off to: 6.5 is not shipped | `src/agent/pi/extension-ui.ts:111-131` (once per method), `:224-241` (the refusals), named refusal `saysAddonCannot`, `:257` | "has every terminal-only call refused out loud", "is refused the component it asked to draw", "is refused a theme" |

## Beyond the table: the rest of the fixture list

| Operation | What happens now | Where | Proof |
| --- | --- | --- | --- |
| Unknown tool names | A tool named anything at all becomes an ordinary step carrying that name; nothing is keyed to a known set of names | `src/agent/pi/events.ts:254` | "a tool whose name nothing here recognises" |
| Streamed tool output | Each partial result becomes `tool-progress`; the final result closes the step | `src/agent/pi/events.ts:244` | "a step that says what it is doing while it does it" |
| Image / resource results | Live: a picture is drawn on the step, a file is not. In the record: the picture is drawn and the file is named | `src/agent/pi/events.ts:303`, `src/agent/pi/history.ts:94-165` | "a picture and a file handed back" (all three cases) |
| Abortable questions | See row 4 and gap G1 | — | "a question an add-on wants to take back" |
| Provider registration | **unsupported in the window** — the registration reaches Pi's model registry (`runner.js:196`), and the picker's list is read from the agent folder instead, so the provider is never offered | `src/agent/pi/adapter.ts:1296` (`connection`), `electron/main.ts:11644` | "lets a provider registration reach Pi, where the window's own list does not read it" (gap G7) |
| Duplicate / shadowed tool names | Decided before the session is created; names carrying the Guard stay Graphe's, any other name an add-on claims is the add-on's, and the loser is not registered a second time | `src/agent/pi/tool-conflicts.ts:82`, `:143` | `tests/tool-conflicts.test.ts` (14) |
| Throwing load | No card, and the factory is not called again for a cached read that also failed | `src/agent/pi/extension-probe.ts:408` | `tests/extension-probe.test.ts`; `tests/extension-compat.test.ts` ("is never a card") |
| Throwing hook | The failure is rethrown rather than swallowed, so Pi's own emit reports it and the adapter turns that into a notice naming the add-on | `src/agent/pi/hook-budget.ts:66`, `src/agent/pi/adapter.ts:3150` | "lets a throwing hook through to Pi's own reporting" |
| Infinite synchronous loop | The factory runs in a disposable child that is killed at the deadline; the app keeps its thread | `src/agent/pi/extension-probe.ts:353`, `src/agent/pi/probe-runner.ts:20` | `tests/extension-probe-child.test.ts` (16) |
| Unresolved async hook | The event moves on; the record says the handler is still running until it actually stops, and its late answer is fed back to nobody | `src/agent/pi/hook-budget.ts:168-241` | "lets go of a hook that never answers"; `tests/scenarios/extensions.test.ts` (T38, T39) |
| Asynchronous result delivery | The host does not wait for it: the turn settles, and the add-on's own delivery still happens on its own terms | `src/agent/pi/hook-budget.ts:241` | "does not keep a turn waiting for a result the add-on delivers later" |
| Installation failure | The fixture's own install step exits 1, and a package that cannot be read is never a card, so it can never be marked active. The shelf turns a failing install into a sentence, and a failed change marks nothing | `src/agent/pi/packages.ts:373`, `src/agent/pi/package-lifecycle.ts:64` | "an add-on that cannot be installed or read"; `tests/packages.test.ts` (50) |
| Transitive-file trust change | The fingerprint is the whole folder, not the entry file, so a module the entry imports is part of what was agreed to and a change re-asks | `src/agent/pi/extension-probe.ts:553`, `:594` | "is read from the whole folder", "is asked again when a module the entry imports changes" |
| Removal during a running tool | The call that is already out finishes and its result stands; the next look finds nothing | `src/agent/pi/extension-probe.ts:461` | "finishes the call that is already out, and is gone from the next look" |
| Two independently authored helpers, different schemas | Both are read on their own evidence and their results are shown as ordinary steps, with no bespoke UI for either (T36) | `src/agent/pi/events.ts:254`, `src/agent/pi/extension-probe.ts:81` | "two third-party helpers with different schemas (T36)" |

## The gaps this matrix records

- **G1 — an aborted question is not settled by the abort signal.** `ExtensionUIDialogOptions` carries `signal` and `timeout`; only the timeout crosses the wire (`src/agent/pi/extension-ui.ts:48`, `src/lib/extension-ask.ts:17`, `electron/main.ts:5916`). An add-on that aborts its own question waits until the window answers or the run stops (`electron/main.ts:5875`). Plan: "Honor abort/timeout".
- **G2 — no status line and no working message.** Both are refused or dropped rather than drawn, so T35's namespacing question is not yet a live one. Nothing is shown at all.
- **G3 — a plain text widget is refused with the component form.** It is the one widget shape a window could render without executing an add-on's factory.
- **G4 — no duration on a tool record.** The plan's row asks for it; neither `tool-progress` nor `tool-end` carries one (`src/agent/types.ts:254`, `:264`).
- **G5 — the command context an extension command runs in is inert** (`runner.js:258`). The command itself does reach the composer's `/` list: the window reads `CHANNEL.workflows` (`src/App.tsx:692`), which is the project's prompt files plus the session's own add-on commands (`electron/main.ts:9392`, `rowsForThePicker`).
- **G6 — shortcut conflicts are not reported anywhere**, not even by Pi's own console warning, because a UI is bound (`runner.js:369-371`).
- **G7 — an extension-registered provider is not in the window's model list**, which is read from the agent folder (`electron/main.ts:11644`).
- **~~G8 — a notice does not carry the add-on's name and is not durable.~~ Closed.** Both halves. The name is read off the call stack at the moment of the call (`whoCalled`), because Pi's `notify` hands the host no origin; the refusal and failure notices take theirs the same way, from the stack and from Pi's own `extensionPath`. And the notice is written into the conversation's own record as Pi's `custom` entry — kept in the transcript, never handed to the model — so one that arrived while nobody was watching is still readable after a relaunch, recorded beside the conversation rather than only in the window that drew it. `tests/addon-notice.test.ts` (7). One limit worth knowing: the stack is the only account of who called, so a notice fired from a timer has no add-on in its frames and is said without a name rather than with a wrong one.

None of these is a claim that the plan's floor is met. Phase 6's own exit
criteria record the same: the compatibility matrix exists as of this document,
and 6.5 (terminal mode) is not shipped, so "unsupported TUI behavior is
explicit" is met and "terminal mode passes the spike" is not.

## Fixture inventory

| Fixture | Operation | Run by |
| --- | --- | --- |
| `plain` | plain tools, one command | `tests/extension-probe.test.ts`, `tests/scenarios/extensions.test.ts` |
| `orchestrating` | second driver: turns of its own, background work, prompt weight | `tests/extension-probe.test.ts`, `tests/e2e/scenarios.test.ts` |
| `marker` | discovery must not run code before trust | `tests/extension-trust.test.ts`, `tests/scenarios/extensions.test.ts` |
| `throws` / `install-fails` | throwing load / installation failure | `tests/extension-probe.test.ts`, `tests/extension-compat.test.ts` |
| `spins` | infinite synchronous loop | `tests/extension-probe-child.test.ts` |
| `unknown-tools` | unknown tool names, unknown content type | `tests/extension-compat.test.ts` |
| `messages` | custom text messages, display intent, provenance | `tests/extension-compat.test.ts` |
| `streamed` | streamed tool output | `tests/extension-compat.test.ts` |
| `media` | image and resource results | `tests/extension-compat.test.ts` |
| `notices` | notify / setStatus / working message | `tests/extension-compat.test.ts` |
| `asks` | select, confirm, input, editor | `tests/extension-compat.test.ts` |
| `abortable` | abortable questions | `tests/extension-compat.test.ts` |
| `custom-tui` | custom TUI, footer/header, editor component, terminal input, theme | `tests/extension-compat.test.ts` |
| `providers` | provider registration | `tests/extension-compat.test.ts` |
| `slash` | slash commands | `tests/extension-compat.test.ts` |
| `shortcuts` | shortcut conflicts | `tests/extension-compat.test.ts` |
| `async-results` | asynchronous result delivery | `tests/extension-compat.test.ts` |
| `hook-throws` | throwing hook | `tests/extension-compat.test.ts` |
| `hook-never` | unresolved async hook | `tests/extension-compat.test.ts` |
| `transitive` | transitive-file trust change (two files) | `tests/extension-compat.test.ts` |
| `removed-midrun` | removal during a running tool | `tests/extension-compat.test.ts` |
| `agent-brief`, `agent-tally` | two independently authored helpers, different schemas (T36) | `tests/extension-compat.test.ts` |

Duplicate tool names have no fixture of their own: the case is built from names
in `tests/tool-conflicts.test.ts`, where the two providers and the registry are
the subject rather than a fixture folder.

## Re-reading this table

```
npx vitest run tests/extension-ui.test.ts tests/extension-trust.test.ts \
  tests/extension-probe.test.ts tests/extension-compat.test.ts
```

The line numbers above were read from this tree at the commit that added this
document; the test names are the durable part, since a fixture and a test move
together and a line number does not.
