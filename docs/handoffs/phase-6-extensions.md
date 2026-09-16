# Phase 6 handoff: a complete, honest extension host

Findings: E01 done (dialogs), E02 done, E03 done (phase 1), E04 done,
E05 done, E06 done (phase 7), E07 done (phase 7), E08 done (phase 7), E09 done
(tool names; custom renderers open), E10 done, E11 open (the bundled route), E12
open. E02's last step — the terminal inside a packaged app — landed 2026-09-16.
Read again on this tree on 2026-09-15.

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
missing or not executable. `npm run verify:package` passes on **both** bundles:
x64 (`release/mac`) and arm64 (`release/mac-arm64`) each report
`@earendil-works/pi-coding-agent 0.85.1`, Pi's 83-package tree, node-pty 1.1.0
with an executable `spawn-helper` (verified by hand as well:
`prebuilds/darwin-x64/spawn-helper` and `prebuilds/darwin-arm64/spawn-helper` are
both 0755) and a verifying ad-hoc signature.

**And it is now proven by running it, not by reading the bundle.**
`scripts/packaged-smoke.mjs` opens a project in the arm64 bundle, puts the
Commands drawer on its terminal, and types `printf graphe-pty-ok` at the xterm
textarea once the pane has named its shell; the pass is the marker appearing
**twice** in `.termpane .xterm-rows` — the pty's echo of the command line plus
printf's own output, so an echoed-and-never-executed line cannot satisfy it.
`npm run test:packaged` (2026-09-16, arm64, `Playwright drove the packaged
binary`) is green with `a real shell runs from the bundle: the pty executed what
was typed at it`, no error lines in the log, and the runtime still the pinned
0.85.1 out of the bundle. The step's own negative control was measured on a copy
of the bundle with `prebuilds/darwin-arm64/spawn-helper` at 644 (re-signed, so a
bad signature is not what fails): the shell never starts, `.termpane__where`
never appears, and the step faults — which is the build `afterPack` exists to
prevent.

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
- Evidence: `tests/tool-conflicts.test.ts` (14, run here). The rule first: an add-on's
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
  because a fresh session starts at `asking`. `tests/packages.test.ts` (65) holds
  the shelf: the version before and after, an install told from an update by the
  words, one at a time in the order asked for, a failed install not stopping the
  next, a watcher taken off, the installer's own progress through the same
  channel, and the change reported to a conversation in the words that say what
  to do about it.

## The commands, the eight states, and the install that can be stopped

**An add-on's commands are in the composer's picker, and they run as commands.**
`rowsForThePicker` (`electron/main.ts:579`, called at `:9396`) reads them live from
the session in front and lists them beside the ways of working, each row saying
where it came from; a typed `/name` goes to the add-on when only the add-on
answers to it, to a workflow when only one does, and to the one in front when both
do, and words that match nothing are not sent to a model at all. A command whose
add-on is not loaded here is forgotten, and one that left during a queued wait is
answered — `/${name} is not here any more` (`:10956`) — rather than sent as prose.
`tests/extension-commands.test.ts` (13) holds all of it, including a real chat
where a registered command runs in Pi's command context.

**The eight states are computed from facts, not from a screen's guess.**
`src/agent/pi/extension-states.ts:19` is the whole vocabulary — `discovered`,
`needs trust`, `installed`, `active here`, `activation pending`, `disabled`,
`incompatible`, `failed` — and `stateOf` (`:65`) decides one per row in one
order: a file the package's own manifest names and this disk does not have
(`incompatible`), then a load failure (`failed`), then a trust decision nobody
has made (`needs trust`), then a policy that says off (`disabled`), then the
truth that it is loaded here (`active here`), then a change that landed while a
chat was open (`activation pending`), then where it came from (`installed`, or
`discovered` for a file loose on this computer). Those facts come from this
computer's files, the project's own trust store, where Pi puts an npm package,
what an open conversation's loader actually did with it, and the ids a change
landed on. With no conversation open nothing is loaded anywhere, so a row shows
its install state and its own sentence says so.
`tests/extension-states.test.ts` (13) and `tests/addons-screen.test.ts` (10) are
the evidence.

**Installing add-ons without host npm (E11) is one step short.** The press asks
`npmOnPath()` first and says "Adding an add-on needs npm, and this Mac does not
have it on the path." in its own words rather than npm's, and the screen says so
before anybody presses anything: one line, the page that installs Node, and
`brew install node` offered only where there is a Homebrew to run it with
(`npmSetup`, `NODE_DOWNLOAD`, `BREW_NODE` in `src/agent/pi/packages.ts:707`;
`brewOnPath` in `src/work/storage.ts`; drawn at `src/components/AddMore.tsx:274`).
What it still does not do is the bundled route: add-ons are installed by host npm.
An install can be stopped: `PackageHost.stop()` ends the one in flight and says what it left behind (`src/agent/pi/packages.ts:340`, `StopOutcome`), and the press is on the add-ons screen (`tests/addon-install.test.ts`). See 6.6 above.

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

## E12 and 6.1's last gap, landed in this pass

**What Pi allows, read off the installed package.** `@earendil-works/pi-coding-agent`
0.85.1 exposes no per-session seam for an extension's settings:
`CreateAgentSessionOptions` takes `model`, `thinkingLevel` and `scopedModels`, and
nothing that reaches an extension's own config; `ExtensionAPI` has
`registerFlag`/`getFlag` and no per-session settings object, and the flags are
process-wide anyway; `ExtensionContext` carries `cwd`, the model, thinking level
and the session manager, and no settings slot. `pi-advisor-flow` 0.4.0 (the
version installed here) resolves its configuration from
`join(getAgentDir(), "advisor.json")` on every load, deliberately refuses
project-local config with the comment "Repository-controlled project
configuration is never applied", and never reads a flag. So there is no version
of "pass the choice through the extension instance" that Pi supports today.

**What was chosen.** The plan's second branch: serialize the integration and
label it. One conversation holds the machine's one advisor file while it is
open; a second asking for a *different* advisor is refused, left running with no
second opinion, and told why in a sentence naming both models — it is never
quietly answered by the first conversation's model. A second conversation asking
for the *same* setting is granted, because that serves nobody else's model. The
rule now lives in `AdvisorFile` in `src/agent/advisor.ts` (with the reasoning in
the `AdvisorChoice` comment, where the next person will read it), not in loose
state inside the adapter's `createSession` closure.

**What the UI says.** The advisor's row on the add-ons screen carries the
limitation, in whichever of three states is true: nobody holding it (what the
addition does), this conversation holding it (with the model it is set to), or
another conversation holding it. The picker itself was deliberately not touched:
`src/components/ThinkingWith.tsx` and `src/components/Composer.tsx` are
`PanesAndIdentity`'s during this pass, and the fact is per-project rather than
per-control, so the add-ons screen is where it belongs.

**6.1's last gap.** The row already carried a count of conversations; it now
names them (`Loaded in <chat>, <chat>`, from the same `activeIn` the count came
from), and a failed add-on draws its one-sentence error with the loader's own
output behind a `<details>`. Both were already in the data and are now drawn and
tested: `tests/addons-screen.test.ts` (13) renders the row with a chat name, with
no chats, with a stated limit, with no limit, and with a failure whose logs are
folded; `tests/extension-states.test.ts` (16) holds the join that produces them.

**The limit on turns an add-on starts, labelled.** Phase 7 reported that limit
in the handoff and nowhere a person could see it. `limitWords.startsTurns` in
`src/agent/pi/extension-states.ts` states it on the row of any add-on whose own
capability card says it starts turns — read from the loaded session's report, not
from a package name — naming the round budget that ends an overrun. An add-on
that starts nothing gets no such line.

## What is not done, and what it costs

| Finding | Status |
| --- | --- |
| ~~E02, a real terminal surface~~ | **Done.** The terminal is built and tested (`tests/terminal.test.ts`, 7 against a real pty and a real shell), and the packaging is done and verified: `electron-builder.js` unpacks node-pty and runs `scripts/adhoc-sign.mjs` as `afterPack`, which sets the execute bit on `prebuilds/<arch>/spawn-helper`. `npm run verify:package` (2026-09-15) passes on **both** bundles in `release/` — x64 and arm64 each report "node-pty is in the bundle with an executable helper", the pinned `@earendil-works/pi-coding-agent 0.85.1`, Pi's 83-package tree, and a verifying ad-hoc signature. The run inside a packaged app landed on 2026-09-16: `npm run test:packaged` opens a project in the arm64 bundle, switches the Commands drawer to its terminal and types `printf graphe-pty-ok` at the xterm textarea, and passes on the marker arriving **twice** in `.termpane .xterm-rows` — the pty's echo plus printf's output, so an echoed-and-never-executed line cannot satisfy it. Measured on a copy of the bundle with the helper at 644 and re-signed, the shell never starts and the step faults, which is what the check is for |
| ~~E04, probe timeouts~~ | Done, see above. A spinning factory is a killed child and a missing card rather than a frozen app |
| ~~E05, card cache~~ | Done after the first draft of this handoff. The cache is keyed on a SHA-256 fingerprint of the extension's own files (the whole folder, not just the entry file, since a local add-on is usually a directory of modules) plus the installed Pi version, and written through the atomic writer so two sessions probing at once cannot leave half a file. Corrupt rows are dropped one at a time, and a cache that cannot be parsed is empty rather than fatal. Two new tests: a file the entry does not name changing invalidates the card, and a truncated cache re-probes and rewrites. `tests/extension-probe.test.ts` (13) passes |
| ~~E06, tools-only policy~~ | Done in phase 7. Hooks run whole or not at all: a conversation loads the add-on complete, `tools-only` is honoured only where the add-on itself declares it (`grapheToolsOnly`), the choice that cannot be honoured says why once, and where Graphe is driving an add-on that starts turns of its own is `off` and listed. See the phase 7 handoff |
| ~~E07, admission before a turn starts~~ | Done in phase 7. One typed request against the facts the asking seam can see, asked first by the adapter's `prompt`/`steer` and by the continuation owner before it sends; Stop moves the epoch so a late child result starts nothing; an add-on's own turn is watched and interrupted at the budget, with the limit stated rather than covered. See the phase 7 handoff |
| ~~E09, tool collisions~~ | Done, see above, for names. The name itself never changes, so an old transcript still reads as the tool that ran |
| ~~E10, package lifecycle~~ | Done, see above. A change under an open conversation marks it activation pending, says so in one sentence, and the conversation is built again when it is opened |
| 6.6, the rest of that section | Open. Nothing reads a custom renderer an add-on registers: a custom tool call has no renderer of its own here. An add-on's commands do reach the composer's picker now, read live from the session in front (`electron/main.ts:9396`, `rowsForThePicker`), and a command that left during a queued wait is answered rather than sent as prose (`electron/main.ts:10956`, `/${name} is not here any more`); `tests/extension-commands.test.ts` (13) is the proof, including a command an add-on registered running in Pi's command context in a real chat rather than being sent as prose. An install that has started can be stopped, which the fifth wave changed: the installer runs as the app's own child with an `AbortSignal` (`change()` in `src/agent/pi/adapter.ts`, the `AbortController` it hands `installAddon`), `PackageHost.stop()` ends it and says what it left behind, the settings file is only written once the install came back with nothing to complain about, and a wrapper configured through Pi's `npmCommand` still goes through Pi's own route, which is the one case that cannot be ended. The shelf's half is whole and tested: `PackageHost.stop?`, `Shelf.stop()` answered with `StopOutcome { stopped, says }`, a bounded record of what the installer said on the way, `CANNOT_STOP` for a host that cannot reach the installer, and one channel carrying all of it (`CHANNEL.stopPackage`, `electron/main.ts:9249`), with `tests/packages.test.ts` and `tests/package-stop.test.ts` (5) on the route. **What is missing is the host, and this is the plain statement of it:** Pi's `DefaultPackageManager` (0.85.1) owns its npm child privately and has no `stop`, cancel or abort member at all — `packageHost` in `src/agent/pi/adapter.ts:1665` returns `search`, `list`, `add`, `update`, `remove`, `installed` and `watching`, and nothing else — so `canStop` is false and the screen prints the shelf's own sentence rather than drawing a Stop that could only ever fail (`AddonReport.stopping`, `src/components/AddMore.tsx:525`). The route that would make it real is hosting the install ourselves — npm run by the shell, which is also E11's bundled package-management route — after which the same channel ends installs with nothing else to change |
| ~~6.1, the states Extensions shows~~ | **Done.** The last gap was drawn in this pass: the row names the conversations the add-on is loaded into rather than only counting them, a failed add-on's error is drawn with its logs foldable, every add-on carries the limit that applies to it where the host imposes one, and the advisor's one-setting limitation is stated on its own row. Done for the display. The eight words are decided in `src/agent/pi/extension-states.ts` The eight words are decided in `src/agent/pi/extension-states.ts` (`stateOf`, `extensionRows`) from facts the shell and the open conversations already have, and drawn one row each on the add-ons screen with version, origin, scope, the conversations it is running in, the commands it offers and the loader's own reason behind a press (`electron/main.ts` `addonsHere`, `src/components/AddMore.tsx`). From real facts: `discovered` and `needs trust` from the files found on this computer and the project's own trust store; `installed` from where Pi puts an npm package; `active here`, `disabled` and `failed` from what an open conversation's loader did with it; `activation pending` from the ids a change landed on while a chat was open; `incompatible` from the files a package's own manifest names and this disk does not have. Defaulted, and honest about it: with no conversation open nothing is loaded anywhere, so a row shows its install state rather than a session's — which is what its own sentence then says. Evidence: `tests/extension-states.test.ts` (13), `tests/addons-screen.test.ts` (10) |
| E11, installing add-ons without host npm | Open, one step. `CHANNEL.addPackage` asks `npmOnPath()` before it hands the press to the installer and says "Adding an add-on needs npm, and this Mac does not have it on the path." rather than npm's own words, and the add-ons screen now says so before anybody presses anything: one line, the page that installs Node, and `brew install node` offered only where there is a Homebrew to run it with (`npmSetup` in `src/agent/pi/packages.ts`, `brewOnPath` in `src/work/storage.ts`, drawn in `src/components/AddMore.tsx`; `tests/packages.test.ts` and `tests/addons-screen.test.ts`). What the finding still asks for, and this does not provide, is the bundled package-management route: add-ons are installed by host npm. An install can be stopped — `PackageHost.stop()` ends the one in flight and reports what it left behind (`src/agent/pi/packages.ts:340`, `StopOutcome`), with the press on the add-ons screen (`tests/addon-install.test.ts`) — so the claim that an install cannot be cancelled is retired |
| ~~E12, advisor settings~~ | **Done, serialized and labelled.** The advisor choice is no longer rewritten around turns (that went in phase 7); what was still missing was the plan's label and a test that a second chat cannot reach the file. Pi has no per-session seam for an extension's settings: `CreateAgentSessionOptions` carries a model and a thinking level, not an extension's settings, `ExtensionAPI` has no per-session settings object, and `pi-advisor-flow` 0.4.0 resolves its path from `getAgentDir()` alone and refuses project-local config by design, with its two registered flags never read. So the plan's fallback stands: the integration is serialized, the reason is in the code (`src/agent/advisor.ts`, the `AdvisorChoice` comment), and the limitation is labelled on the advisor add-on's own row on the add-ons screen. `AdvisorFile` in `src/agent/advisor.ts` holds the rule and is driven directly by `tests/advisor-scope.test.ts` (15): one chat holding the file, a second asking for a different model refused with both model names in the sentence, the file's contents unchanged and the write never called, sharing granted where both want the same, and writes serialized one at a time. The adapter uses that object rather than its own map. See below |
| 6.2, agent runtimes in a child process | **The seam is proven; nothing is wired to it.** The spike is real and tested — `src/agent/pi/rpc-protocol.ts`, `src/agent/pi/runtime-child.ts`, `electron/services/runtime-supervisor.ts`, `tests/runtime-spike.test.ts` (14 tests, all passing), with the honest limits listed in `phase-6-runtime-spike.md`. What is not done is the migration: `electron/main.ts` still hosts Pi in-process exactly as it did, so extension code still runs on Electron's main event loop, which is what makes a synchronous loop in a trusted add-on a hang for the whole app. That remains the largest unbuilt piece of the plan |
| 6.5, terminal compatibility mode | Not shipped, deliberately. See the section above: the boundary hooks (Guard, extension policy, transcript ownership) are the ones that do not cross a process boundary yet, so there is no version of it that preserves them |
| Phase 6 fixtures | Done for the plan's list. `tests/fixtures/extensions/` holds `plain`, `orchestrating`, `throws`, `spins`, `marker` and the rest of the register: unknown tool names, custom messages, streamed output, image/resource results, notifications/status, the four dialogs, abortable questions, custom TUI, provider registration, slash commands, shortcut conflicts, asynchronous result delivery, a throwing hook, an unresolved async hook, installation failure, a transitive-file trust change, removal during a running tool, and two independently authored helpers with different schemas. What each one is and what proves it: `docs/handoffs/extension-compatibility.md` |

Exit criteria: "no executable code before the trust decision" is met and tested
(`tests/extension-trust.test.ts`, 6: an add-on nobody has said yes to is not
imported, not called and gets an unknown card, and is run once somebody does say
yes); "a hung extension does not freeze the Electron shell" is met and tested
(`tests/extension-probe-child.test.ts`, 16); "package install/update/remove/reload
states match what is actually active" is met for a change landing under an open
conversation (`tests/package-activation.test.ts`, 3, and `tests/packages.test.ts`,
65); "generic extension UI requests work in two concurrent conversations without
cross-answering" is met by construction (each request carries the conversation
that asked, and an answer settles exactly one request id) but is not exercised
end to end in Electron; the compatibility matrix is met —
`docs/handoffs/extension-compatibility.md` records every operation of the 6.3
table and the rest of the fixture register as native GUI, terminal-only,
unsupported or failed, each with the file and line and the test that proves it,
including the eight gaps it finds (an abort signal that is not carried, no
status line, a plain text widget refused with the component form, no duration on
a tool record, commands that never reach the picker, shortcut conflicts nobody
reports, a provider the window does not list, a notice with no add-on name and
no durable home). The terminal-mode criterion is not met: terminal compatibility
mode is not enabled (6.5).
