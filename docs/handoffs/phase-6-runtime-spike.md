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
- **Memory per runtime: not measured.** This is the honest gap. Measuring it
  needs a packaged worker under Electron's Node on a settled conversation, and
  that needs the build entry (below) and the `notePackagedApp` seam; a Node-only
  figure would be a different number for a different process and is not worth
  printing as if it were this one. 6.2's "bound concurrent runtimes using
  measured memory capacity" therefore remains unstarted.
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

1. **A build entry for the child.** `scripts/build-electron.mjs` needs one item
   mirroring the probe-runner's (`src/agent/pi/runtime-child.ts` →
   `dist-electron/runtime-child.mjs`, ESM, the same `createRequire` banner), and
   `runtime-child.mjs` added to the final `console.log`. **Not done** — the file
   is outside this ticket's ownership. The supervisor falls back to the built
   path and to `GRAPHE_RUNTIME_CHILD`, which is how the test builds it with
   esbuild itself, so nothing here is blocked by it.
2. **Wiring `electron/main.ts`.** Replacing the in-process `createSession` in
   the runtime-launch regions with `startRuntime`, and routing
   `onEvent` → `forwardTo`. Deliberately untouched: the instruction is that the
   app keeps working exactly as it does now while the spike proves itself.
3. **The `judge` callback wired to the real Guard**, including `Confirmations`,
   `Asking`, `Paused` and the restore-point timeline — see the gap above.
4. **`ChildExit.unanswered` connected to the shell's dialog registry**, so a
   named pending question settles as cancelled with the documented value. The
   supervisor reports the ids; nobody consumes them yet.
5. **The durable run journal.** `wroteRunNote` / `readRunNotes` /
   `recoverAfterRestart` already exist and already answer "interrupted" for
   in-flight work. A child exit should write and clear those notes; not wired.
6. **Idle eviction and a concurrency ceiling**, which need the memory figure
   that is still missing.
7. **A `pi` upgrade contract test** for the RPC shapes, so a pre-1.0 breaking
   change fails loudly rather than silently.

## Reproducing

```
npx vitest run tests/runtime-spike.test.ts
```

Twelve tests, green. `npx tsc --noEmit` and `npx eslint` on all four files are
clean. The spike builds its own child with esbuild (the same options
`tests/extension-probe-child.test.ts` uses for the probe runner) into a temp
folder and points `GRAPHE_RUNTIME_CHILD` at it, so it needs no built app.
