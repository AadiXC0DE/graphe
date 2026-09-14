# Phase 6 handoff: a complete, honest extension host

Findings: E01 done (dialogs), E03 done (phase 1), E04 done, E05 done, E06
open, E07 open, E08 done (phase 7), E09 done (tool names; custom renderers and
commands open), E10 done, E11 open, E12 open.

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

## E02, the terminal surface (added after the first draft of this handoff)

`electron/services/terminal.ts` runs the person's own login shell in a real pty,
in the workspace a call names, with output streamed to the window in chunks and
input accepted as keystrokes only. There is no command parameter and no generic
execute door: the only way anything reaches the pty is `terminalWrite`, which
takes the id of a terminal this app started and a string of bytes. Scrollback is
bounded (512 KB per terminal, oldest dropped), a resize is clamped, an ended
shell refuses more input, and every terminal is killed when the app goes away.

- Contract: `terminalOpen/Scrollback/Write/Resize/Close/List` plus
  `terminalData`/`terminalExit` events, in `src/lib/ipc.ts`, the preload and the
  bridge. Output is untrusted text drawn by xterm, never HTML; link handling and
  window opening are left off so a printed escape sequence cannot reach the
  browser or the clipboard.
- UI: `src/components/TerminalPane.tsx`, reached from the Commands drawer (a
  switch between the read-only run log and the terminal, defaulting to the log),
  which states in the header that this is the person's shell and that the agent
  is not watching it.
- Evidence: `tests/terminal.test.ts` (7 tests against a real pty and a real
  shell: the folder is the one asked for, typed bytes arrive, scrollback is
  kept, the exit is reported once, resize works, and a closed terminal refuses
  input).

**The packaging requirement, measured rather than assumed.** node-pty 1.1.0
ships N-API prebuilds, and its darwin-arm64 binary loaded and spawned correctly
inside this Electron (`pty-ok`) with no rebuild. But `npm install` can leave
`prebuilds/<arch>/spawn-helper` mode 644, and without the execute bit `spawn`
fails with `posix_spawnp failed` — in Node and in Electron alike. The packaged
app answers that now: `electron-builder.js` unpacks `node_modules/node-pty/**`
out of the archive and runs `scripts/adhoc-sign.mjs` as its `afterPack` hook,
which sets 0o755 on every `prebuilds/<arch>/spawn-helper` before the bundle is
signed, and `scripts/verify-package.mjs` faults when the helper in a built app is
missing or not executable. What is missing is the run: `npm run verify:package`
against `release/mac-arm64/Graphe.app` (Pi 0.85.1, the version installed here)
passes with "node-pty is in the bundle with an executable helper", but nothing in
the suite opens a terminal inside a packaged app, and the x64 bundle in
`release/mac` predates node-pty (Pi 0.84.3), so it ships without it and reports
the terminal unavailable. That is the one step left in E02.

## E04, a factory that never yields is killed in a process of its own

**The probe used to run an add-on's factory in Electron's main process behind a
`Promise.race`, which cannot interrupt a synchronous loop** — the thread such a
race would need is the one the factory is holding. So the factory runs in a child
the parent can end.

- `src/agent/pi/probe-runner.ts`: the disposable half. It calls the same
  `recordEntry` the in-process probe uses, writes one `graphe-probe ` line of
  JSON on stdout and exits outright rather than waiting on a timer, socket or
  watcher the factory left behind. It only acts when it is the program that was
  started, so a test can import `probeLine` without side effects.
- `src/agent/pi/extension-probe.ts`: `probeInChild` spawns `process.execPath`
  with `ELECTRON_RUN_AS_NODE=1`, keeps the deadline in the parent, and on the
  deadline sends `SIGKILL` and settles only once the process is gone (a two
  second grace covers a kill that never lands). It keeps the last megabyte of the
  child's output and reads the last whole marker line in it, so a factory that
  logs a great deal, or prints a line shaped like ours, cannot push its own
  answer out or have its logging read as one; the child's stderr is ignored
  rather than piped, because nothing reads it and a factory that filled it would
  cost the whole deadline. `probeProgram()` resolves the built
  `probe-runner.mjs` beside the shell, or `GRAPHE_PROBE_PROGRAM` when a test
  names one; with no program at all the factory runs here instead, which `probe`
  says in its own words rather than hiding. The app's path is `cardsFor` →
  `cardFor` → `probe`, called from `adapter.ts` with `probePermitted` as the
  `mayRun` gate, so a card is read in a child and only for an add-on somebody has
  said yes to.
- `scripts/build-electron.mjs` builds `src/agent/pi/probe-runner.ts` into
  `dist-electron/probe-runner.mjs` (ESM for Node, `createRequire` banner), where
  the shell resolves it.
- Evidence: `tests/extension-probe-child.test.ts` (16). Two reads at once, one of
  them held for ever by its own child: the other finishes and the held one
  answers with nothing inside the budget, and the spinning child's pid is gone
  afterwards. A second pass over the same fixture leaves the first child dead. A
  garbage line, half a line, a factory that throws, an add-on that is not there
  and a program that does not exist all come back as no card rather than as a
  failure. The shipped runner — built with esbuild and the options the app's own
  build uses — reads `plain` for real through a process of its own, and is killed
  within six seconds when the factory never yields.

## E09, two providers and one tool name

**Pi keeps one definition per name and says nothing, so the loser was simply not
there**: an add-on's `task` vanished behind Graphe's, or — worse — an add-on's
tool of the same name as `bash` or `read` took the definition the Guard is
attached to while every row of the transcript still read as Graphe's.

- `src/agent/pi/tool-conflicts.ts`: `apartTools(mine, addons)` decides in one
  pass, in the order the caller read things rather than the order they happened
  to load. The seven names a tool call is guarded through (`GRAPHE_ONLY`: `read`,
  `bash`, `edit`, `write`, `grep`, `find`, `ls`) stay Graphe's and come off the
  add-on that wanted them. Any other name an add-on wants is the add-on's, so
  Graphe's own convenience tool of that name is not registered at all —
  installing an add-on was the explicit act. Between two add-ons the first to ask
  keeps it. `saysToolConflict` is one sentence naming the tool somebody will
  actually get, and what to do about the one they will not.
- `src/agent/pi/adapter.ts`: the decision runs before the session is created,
  while both lists are still in hand. Every conflict goes to the window as a
  `notice`; a name an add-on loses is deleted from that add-on's own registry;
  `tools:` and `customTools:` are built from what each side kept, so the loser is
  not registered a second time; and the session exposes `toolConflicts`, each
  with its sentence.
- The name itself never changes, so an old transcript still reads as the tool
  that ran.
- Evidence: `tests/tool-conflicts.test.ts` (10). The rule first: an add-on's
  `task` wins and Graphe's is left out; `bash` and `read` stay ours and come off
  the add-on; a name nobody wants twice is kept in silence; Graphe naming one
  twice keeps it once; the first add-on to ask wins. Then the registry, with the
  real SDK loaded exactly as `tests/adapter.test.ts` loads it: undecided, Graphe's
  wins in silence, which is the finding; with the decision applied, an add-on's
  tool is the one that runs for a name it owns, Graphe's is the one that runs for
  a name carrying the Guard, and a name an add-on loses is not in the session at
  all.

## E10, an add-on that is installed but not yet active

**A session holds the add-ons that were installed the moment it opened** — their
factories ran, their tools were registered into it — so installing, updating or
removing one afterwards changed nothing about a conversation already going, and
somebody watched a new add-on do nothing with no way to tell broken from not
loaded.

- `src/agent/pi/package-lifecycle.ts`: `oneAtATime()` runs changes one at a time
  in the order they were asked for, because two installs at once is a
  half-populated `node_modules` that a probe then fingerprints. `PackageChange`
  records what was there before and what is there after; `PackageProgress` is one
  line while it happens and one when it is over; `reloadWords` gives the exact
  sentence, `Installed; reload this chat to activate` or the mirror for a
  removal.
- `src/agent/pi/packages.ts`: `packageShelf` runs every `add`, `update` and
  `remove` through that queue, reads the version before and after from the host's
  `installed()`, reports through `watching`, and turns a failure into a sentence
  rather than an exit code or a stack. A change that failed returns `ok: false`
  and marks nothing.
- `src/agent/pi/adapter.ts`: the session carries `activationPending` and takes
  `markActivationPending(says)`.
- `electron/main.ts`: after an install or an update, and after a removal,
  `markActivationPending` marks every conversation open in every open project —
  an add-on is installed for the whole app, so a session in another project is
  built from a set of add-ons that no longer matches too — and sends the
  sentence to each as a `notice`. `startConversationUnlocked` hands back a live
  session only when its `activationPending` is `null`; a pending one is stopped,
  closed and built again at the same address, which is what "reload this chat"
  means. The transcript is the same file, and the workspace and the permission
  rung are read for the rebuild the way they are read for any conversation.
- Evidence: `tests/package-activation.test.ts` (3): the sentence is one sentence
  everywhere and it says what to do; a session is clean before a change and
  `Installed; reload this chat to activate` after one; and a session built again
  at the same address comes back with the same transcript, the same model and the
  same permission rung — the test shows the rung has to be carried across,
  because a fresh session starts at `asking`. `tests/packages.test.ts` (50) holds
  the shelf: the version before and after, an install told from an update by the
  words, one at a time in the order asked for, a failed install not stopping the
  next, a watcher taken off, the installer's own progress through the same
  channel, and the change reported to a conversation in the words that say what
  to do about it.

## 6.2 and 6.5, and why they are not here

- **6.2, runtimes out of the Electron main process.** Pi documents a supported
  subprocess seam (`pi --mode rpc`, JSONL over stdio, with a shipped
  `rpc-entry` and a documented client), so the transport exists. What does not
  exist is Graphe's half of it: the Guard is an in-process extension factory
  registered through `DefaultResourceLoader`, and the extension trust filter is
  the loader's `extensionsOverride`. Both live in the parent process by
  construction; a child runtime would have to re-host them as on-disk artifacts
  with their own policy bridge, and Pi's own docs say plainly that extensions run
  with the user's permissions and that there is no sandbox ("Project trust is
  only an input-loading guard... It is not a sandbox"). Moving the runtime
  without moving those first would leave a shell that cannot be frozen *and*
  cannot be guarded, which is worse than what is here now. This stays open, and
  it is the largest unbuilt piece of the plan.
- **6.5, terminal compatibility mode.** Not shipped, and deliberately. The plan's
  own rule is that a handoff must prove it preserves Guard, request and
  transcript semantics, and that if a required hook cannot preserve the boundary
  the capability is marked unsupported rather than silently falling back to an
  unrestricted agent. The spike above shows the boundary hooks are exactly the
  ones that do not cross the process boundary yet, so there is no version of this
  to ship honestly today. What a person gets instead is the real terminal above,
  which is a shell rather than a second agent, and which says so.

## What is not done, and what it costs

| Finding | Status |
| --- | --- |
| E02, a real terminal surface | Open, one step. The terminal is built and tested (`tests/terminal.test.ts`), and the packaging that was missing is written: `electron-builder.js` unpacks node-pty and runs `scripts/adhoc-sign.mjs` as `afterPack`, which sets the execute bit on `prebuilds/<arch>/spawn-helper`, and `scripts/verify-package.mjs` faults when it is missing. `npm run verify:package` passes against `release/mac-arm64/Graphe.app`. What is missing is the run itself: nothing opens a terminal inside a packaged app, the x64 bundle in `release/mac` predates node-pty and ships without the terminal |
| ~~E04, probe timeouts~~ | Done, see above. A spinning factory is a killed child and a missing card rather than a frozen app |
| ~~E05, card cache~~ | Done after the first draft of this handoff. The cache is keyed on a SHA-256 fingerprint of the extension's own files (the whole folder, not just the entry file, since a local add-on is usually a directory of modules) plus the installed Pi version, and written through the atomic writer so two sessions probing at once cannot leave half a file. Corrupt rows are dropped one at a time, and a cache that cannot be parsed is empty rather than fatal. Two new tests: a file the entry does not name changing invalidates the card, and a truncated cache re-probes and rewrites. `tests/extension-probe.test.ts` (11) passes |
| E06, tools-only policy | Open. `policyFor` still returns 'on' for a conversation, so no hooks are deleted there, but the plan's coherent enable/disable story is not built |
| E07, admission before a turn starts | Open. `forwardTo` still accounts after a turn has begun |
| ~~E09, tool collisions~~ | Done, see above, for names. The name itself never changes, so an old transcript still reads as the tool that ran |
| ~~E10, package lifecycle~~ | Done, see above. A change under an open conversation marks it activation pending, says so in one sentence, and the conversation is built again when it is opened |
| 6.6, the rest of that section | Open. Nothing reads a custom renderer an add-on registers: a custom tool call has no renderer of its own here. An add-on's commands are counted on its card and never registered in the composer's command picker, and a command removed during a queued interaction is not handled. An install that has started cannot be cancelled: `watching` returns a way to stop watching, not a way to stop the install |
| E11, installing add-ons without host npm | Open. `CHANNEL.addPackage` now asks `npmOnPath()` before it hands the press to the installer and says "Adding an add-on needs npm, and this Mac does not have it on the path." rather than npm's own words. There is no bundled package-management route and no setup action, which is what the finding asks for |
| E12, advisor settings | Open. The advisor choice is still a global file rewritten around turns |
| 6.2, agent runtimes in a child process | Not started. Extension code still runs on Electron's main event loop, which is what makes a synchronous loop in a trusted add-on a hang for the whole app. This is the largest unbuilt piece of the plan |
| 6.5, terminal compatibility mode | Not shipped, deliberately. See the section above: the boundary hooks (Guard, extension policy, transcript ownership) are the ones that do not cross a process boundary yet, so there is no version of it that preserves them |
| Phase 6 fixtures | Partly. `tests/fixtures/extensions/` holds `plain`, `orchestrating`, `throws`, `spins` and `marker`. The plan's custom TUI, duplicate-tool, provider, slash-command, shortcut-conflict, install-failure and transitive-trust fixtures are not there, and neither is a second independently authored add-on |

Exit criteria: "no executable code before the trust decision" is met and tested
(`tests/extension-trust.test.ts`, 2: an add-on nobody has said yes to is not
imported, not called and gets an unknown card, and is run once somebody does say
yes); "a hung extension does not freeze the Electron shell" is met and tested
(`tests/extension-probe-child.test.ts`, 13); "package install/update/remove/reload
states match what is actually active" is met for a change landing under an open
conversation (`tests/package-activation.test.ts`, 3, and `tests/packages.test.ts`,
50); "generic extension UI requests work in two concurrent conversations without
cross-answering" is met by construction (each request carries the conversation
that asked, and an answer settles exactly one request id) but is not exercised
end to end in Electron; the terminal-mode criterion and the compatibility matrix
are not met — there is no matrix, and terminal compatibility mode is not enabled
(6.5).
