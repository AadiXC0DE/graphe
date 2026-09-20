# Phase 6.2 — the child runtime, as a spike

**What this is.** 6.2 asks for a managed child process per live conversation
runtime. This is the compatibility spike the plan's own rule (6.5) requires
before any migration: *"First build a compatibility spike that proves public Pi
CLI/extension hooks can preserve all required Guard, request and transcript
semantics."* The seam is proven and the honest limits are listed below.

**What is not this.** The app does not use the supervisor. `electron/main.ts`
still hosts Pi in-process exactly as it did. Nothing here is wired into a
running conversation, and nothing changed about how Graphe behaves today.

## Files

| File | What it is |
| --- | --- |
| `src/agent/pi/rpc-protocol.ts` | The wire: framing, what the child says, what the shell answers. |
| `src/agent/pi/runtime-child.ts` | The child program. Hosts Pi and the trusted extensions; holds a tool call until the shell rules on it. |
| `electron/services/runtime-supervisor.ts` | The parent half. Start, readiness, Pi's RPC client, UI routing, hard kill, exit reporting. |
| `tests/runtime-spike.test.ts` | The spike's proof: 12 tests, all passing. |

## The seam, as the installed package documents it

Checked against `@earendil-works/pi-coding-agent@0.85.1` on disk, not assumed:

- `docs/rpc.md` documents `pi --mode rpc`: JSONL on stdin/stdout, commands in,
  responses and agent events out, with an extension UI sub-protocol on the same
  stream.
- The package ships an entry at the `./rpc-entry` export
  (`dist/bundle/rpc-entry.js`), which is `main(["--mode", "rpc", …])`.
- The SDK's `main(args, { extensionFactories })` is the documented Node
  embedding seam, and `InlineExtension` is a public exported type. The child
  uses `main` with an inline factory rather than spawning a CLI, so the shell
  can host **its** Guard hook in a child that has never seen a file of ours.

**Framing.** `docs/rpc.md` is explicit that records split on LF alone, because
U+2028/U+2029 are legal inside a JSON string and `readline` splits on them. The
reader is written to that rule and asserted (`records`), including that a
U+2028 survives `stringify` and does not break a record.

## What the child ran, what the parent owned

**The child ran:** Pi itself, in RPC mode; the trusted extensions (loaded from
paths the shell passes as ordinary `-e` arguments, which is exactly what the
existing trust filter's kept list becomes); the session, the transcript file and
the tool execution.

**The parent owned:**

- **The Guard.** The child's `tool_call` hook sends the call over the control
  channel and *does not return* until the shell answers. The Guard therefore
  never leaves the process that owns the facts behind it: same
  `createGuardInterceptor`, same `evaluate`, same policy module. Proven by
  `tests/runtime-spike.test.ts` — a refused `write` does not reach the disk and
  the model reads the shell's own refusal sentence; an allowed one really runs.
- **The window.** Pi's `extension_ui_request` records are translated to our own
  `ExtensionAsk`, handed to the host's `ask`, and answered back in Pi's
  documented shape. A select answers with its option value, a confirm with a
  boolean, a dismissal with `{ cancelled: true }`. A method with no honest
  dialog (widget, title, status, editor prefill) is reported via
  `onUnsupportedUi` and **not** answered with an invented value.
- **Lifecycle.** `startRuntime` resolves only when the child's control extension
  says `ready`, never when the fork succeeded. A hard kill is classified as
  `died` (the child's own death, i.e. an interruption) versus `killed` (this
  side's doing, e.g. a stop or eviction) — the distinction 6.2 needs for "a
  worker exit marks the run interrupted".

## The protocol

Two channels, deliberately separate.

**Pi's own RPC, on stdin/stdout.** Commands out with a `graphe-N` id; responses
matched by id; agent events and UI requests in.

**A private control channel, on fds 3 and 4.** The one question Pi's protocol
has nowhere to put: *may this tool call run*. Every line on it carries a nonce
the shell minted for that one child, so a line from another process — or a line
the model talked an extension into printing — is not a Guard verdict. A verdict
that times out is a **refusal**, never an approval: a shell that has stopped
answering is not an answer.

**No Electron object, no renderer bridge handle, no privileged API crosses
either stream.** The child receives Pi's own CLI arguments and a folder it
resolves Pi from; that is the whole surface.

## The numbers

Measured on this machine (Apple M1, Node 22.21.1), from the passing test run:

- **Start latency**, `startRuntime` → `ready`: ~1.3–3.0 s cold per child. That
  covers a full Pi boot — settings, catalogue, session manager, extensions.
- **Per-test cost** in the spike, each starting one real child: 0.6–5.0 s.
- **Memory per runtime: 105 MB** (Apple M1 8 GB, macOS 24.6.0, Electron 44.4.1
  / Node 24.21.0, Pi 0.85.1). Read with `ps -o rss=` from the shell on a child
  that has booted Pi and settled: 100–105 MB at rest, 145–155 MB in the first
  seconds of boot. A whole app with children open measured **51.5 MB per
  booted child, 112.6 MB for the shell, 410 MB for the whole tree** under
  `node scripts/measure-runtime.mjs --scenario=child`. The two disagree because
  the second is taken seconds after boot, before Pi's lazily-loaded parts are
  resident; the ceiling is worked out from the settled figure, since
  under-counting memory is the direction that hurts. `RSS_PER_CHILD_BYTES` in
  `electron/services/runtime-supervisor.ts` holds it.
- **The ceiling**, `floor(free × 0.5 / 105MB)` clamped to `[2, 8]`: **2** on
  this machine at launch (117 MB free), 5 on a machine with 1 GB free. Written
  to the app log the first time a child is registered. Verified end to end:
  three conversations opened with `GRAPHE_CHILD_RUNTIME=1` left **two children
  alive** — the third evicted the quietest, and the window switched tabs in
  36 ms with both alive.
- **Confirm-dialog deadline.** The child refuses a call the shell has not
  answered within `JUDGE_PATIENCE_MS` = **120 s** (`src/agent/pi/runtime-child.ts`).
  A `confirm` verdict therefore has 120 s to reach a person and come back, and
  the card in the window carries no timer of its own — a person who leaves it
  is answered by that refusal, which is the documented outcome rather than a
  made-up yes.
- **Child boot under Electron's Node: verified** during the spike, separately
  from the suite — the shipped `dist/bundle/rpc-entry.js` served a full
  scripted turn under `ELECTRON_RUN_AS_NODE`, which is the packaged-worker
  question answered.

## What crossed, proven

Twelve tests, all passing:

1. **A turn runs in the child**, Pi's own protocol answers `get_state`, and the
   transcript it wrote replays through the app's existing `readTranscript`.
   Usage is accounted once: the model saw each turn exactly once, so there is no
   duplicate attempt anywhere in the path.
2. **The Guard judges in the shell.** A refused call never reaches disk and the
   model reads the shell's own reason; an allowed call really runs; and the call
   that arrives over the wire is the call the policy judges, so the verdict
   cannot differ because the boundary reshaped it.
3. **A trusted extension loads in the child** and its `ctx.ui.select` reaches
   the window, which answers, and the extension is told that answer.
4. **A question with no window is cancelled**, never a made-up yes.
5. **A hard kill** (SIGKILL on the child's own pid) reports `died` with the
   dialog it was holding named in `unanswered`, refuses later prompts rather
   than reissuing them, and starts nothing.
6. **A stop by this side** reports `killed`, not an interruption.

## What could **not** cross, and why

Stated plainly, as 6.5 requires:

- **A parked Guard question is not resumable from inside the child.** When the
  shell answers "no", the child's hook returns `{ block: true, reason }`; when
  the shell cannot answer at all, the call is refused with a sentence saying
  nothing changed. So the *verdict* crosses, but a `confirm` verdict's
  interaction with `Confirmations`/`Asking` (the parking, `abandonAll`, the
  `questions-withdrawn` events) stays on the shell's side and is *not* exercised
  across the boundary in this spike. The shell's `judge` callback is where that
  wiring would go; it is not written here.
- **`snapshot-first` / restore points are unproven across the boundary.** The
  interceptor's `takeRestorePoint` calls `Timeline.snapshot`, which needs the
  checkout path and git. `judge` can call it in the shell, but no test here
  covers a snapshot taken for a child-hosted call.
- **Skills, prompt assembly, the advisor, MCP, `task` and the browser are not
  hosted in the child.** They are `customTools` and `extensionFactories` built
  in-process today (`graphe-guard`, `graphe-prompt`). Only `graphe-guard`
  (as the control extension) crossed. Moving `graphe-prompt` means moving
  `assemblePrompt`, the standing block and the memory notes — none of which is
  a Pi hook, so this is ordinary work rather than a boundary limit, but it is
  not done.
- **TUI-only extension APIs are unsupported, as expected.** `custom()`,
  component factories, `setFooter`/`setHeader`, direct terminal input: Pi's RPC
  mode returns `undefined`/no-ops for these. They are *reported* by the host,
  not simulated. Phase 6.3 grades this terminal compatibility mode.
- **Secrets in extension output are masked in the child** (`maskToolResult` on
  `tool_result`), which is the same masker the in-process path uses — but the
  masking now runs on the untrusted side of the boundary. An extension that
  chose to write credentials itself is no more restricted here than in-process;
  no claim of extra safety is made.

## What a full migration would still need

1. **A build entry for the child.** Done: `scripts/build-electron.mjs` builds
   `src/agent/pi/runtime-child.ts` → `dist-electron/runtime-child.mjs`, ESM with
   the same `createRequire` banner, and `npm run app:build` names it. A packaged
   copy resolves it through `app.asar.unpacked` — see `childProgram()` and the
   `asarUnpack` entry in `electron-builder.js` — and
   `scripts/verify-package.mjs` checks the file is unpacked and that the real
   binary starts it far enough to say `ready`.
2. **Wiring `electron/main.ts`.** Done: all three `createSession(` sites call
   `openSession`, and the choice comes from `prefs.runtime`. The default is
   still `in-process`.
3. **The `judge` callback wired to the real Guard**, including `Confirmations`,
   `Asking`, `Paused` and the restore-point timeline. Done: `guardFor()` builds
   it in the shell and `judge` is the one part that crosses.
4. **`ChildExit.unanswered` connected to the shell's dialog registry.** Done:
   `Hosted.exited` calls `guard.releaseEverything()` and emits
   `questions-withdrawn`/`asking-withdrawn`.
5. **The durable run journal.** Still open. `wroteRunNote` / `readRunNotes` /
   `recoverAfterRestart` exist; a child-hosted prompt does not yet write a note,
   so a child that dies leaves the ordinary transcript marker and nothing at the
   next launch.
6. **Idle eviction and a concurrency ceiling.** Done: `ChildRuntimes` in
   `electron/services/runtime-supervisor.ts`, with `IDLE_TAKE_DOWN_MS` = 10
   minutes, the ceiling above, and `tests/child-eviction.test.ts` driving both
   with an injected clock and injected readings.
7. **A `pi` upgrade contract test** for the RPC shapes. Done:
   `tests/rpc-contract.test.ts`, which asserts the command and event names
   against the installed `docs/rpc.md` and pins the version they were read off.

## What is still needed before the child path can be the default (2.8)

The switch is honoured end to end — `npm run test:electron` with
`GRAPHE_CHILD_RUNTIME=1` is a second entry of the Electron smoke job — and the
default deliberately stays `in-process` until all four of these are true:

1. **The packaged smoke starts a child in the bundle.** `verify:package` starts
   one by hand and waits for `ready`, which is most of it; what is missing is
   the same thing through `scripts/packaged-smoke.mjs`, in a window, with a real
   turn. That script is not this ticket's.
2. **The memory numbers are recorded.** Done — see above.
3. **The `spins` fixture no longer freezes the window.** *Not done, and this is
   the plan's own stated acceptance test.* `tests/fixtures/extensions/spins/index.mjs`
   is a factory with `for (;;) {}` in it, and the plan's reason for 6.2 is that
   such an add-on must not freeze the window. Today the fixture is only
   exercised by `tests/extension-probe-child.test.ts`, which runs it in the
   *probe* process — never as a conversation's add-on. The acceptance needs an
   Electron smoke case: a project whose agent folder carries `spins`, a
   conversation opened with `GRAPHE_CHILD_RUNTIME=1`, and the window still
   answering while that factory does not. That belongs in
   `tests/electron/smoke.test.ts`, which **this ticket may not edit** — it is
   owned by the canvas work this round. See the integration delta in the report.
4. **A conversation whose host died says so at the next launch.** Item 5 above:
   the run note is not written for a child-hosted prompt.

## Reproducing

```
npx vitest run tests/runtime-spike.test.ts tests/child-session.test.ts \
  tests/rpc-contract.test.ts tests/child-eviction.test.ts
```

The spike's twelve are green. The child session's ten and the contract test's
eleven build their own child with esbuild (the same options
`tests/extension-probe-child.test.ts` uses for the probe runner) into a temp
folder and point `GRAPHE_RUNTIME_CHILD` at it, so they need no built app. The
eviction test starts nothing at all: the clock, the free-memory reading and the
per-child figure are injected, which is what makes a ten-minute deadline
testable in a second.

The measurements above come from:

```
node scripts/measure-runtime.mjs --scenario=child,child-worked
```
