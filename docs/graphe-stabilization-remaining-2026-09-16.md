# What is left of the stabilization plan, and how to finish it

Written 2026-09-16 against `fix/ownership-stabilization` at `aa86fbd` (PR #51).
This is the working document for whoever picks the branch up next. It says what
is done, what is still open, which of the recorded blockers are real, and for
each open item the exact steps, files and checks. The phase handoffs under
`docs/handoffs/` stay the record of evidence; this file is the plan for the rest.

## Read this first

**State of the branch, verified today on this machine (Node 22.21.1, arm64):**

| Check | Result |
| --- | --- |
| `npm run typecheck` | clean |
| `npm test` | 366 files passed, 1 skipped; 6614 tests passed, 14 skipped |
| CI on `aa86fbd` | Typecheck, Lint, Tests, Build, Package, Integration green. **Electron smoke red** (one test, see item 0) |

**Rules that still apply to every item below.**

- `npm run typecheck && npm test` clean before anything is called done. `npm run lint` and `npm run copy:check` are CI gates too.
- No `Co-Authored-By` or other assistant trailer on commits in this repo.
- Comments: one or two lines, why not what, no references to this document or to backlog ids.
- Buttons and labels name the operation (`Retry`, `Stop`, `Open in terminal`). No coinage.
- When an item lands, update the row in its phase handoff and the table in `docs/handoffs/STATUS.md` in the same commit. The handoffs are how the next agent knows what is true.

**Three corrections to the last status report.** The report listed "W09 rescue-root victims, recovery UI, the draft-in-a-new-chat edge" as open. Two of the three are done and recorded as done in `docs/handoffs/phase-3-workspaces.md`: rescue roots are hashed (`src/work/rescue.ts`, `tests/rescue-roots.test.ts`, 10 tests) and the recovery surface exists (`src/components/Recovery.tsx`, `tests/recovery-surface.test.ts`). The third is probably fixed too but unproven; see item 6.

**Two handoffs are stale and should be refreshed when their items are touched.**
`docs/handoffs/phase-6-extensions.md` still says an install cannot be cancelled and that 6.2 is "not started"; both changed in the fifth wave (install is the app's own child with an `AbortSignal`, and the runtime spike landed). `docs/handoffs/STATUS.md` quotes `test:visual` as both 49 rows and 38 rows in the same section.

## The open list, in the order to take it

| # | Item | Real blocker? | Who can do it |
| --- | --- | --- | --- |
| 0 | CI Electron smoke is red: a race in one streaming test | No, a test fix | an agent, now |
| 1 | Dependency majors: vitest 5, jsdom 29, eslint 10, mermaid 12, unpdf 1.8 | **No.** The stated reason (Node) is wrong; Node 22.21.1 satisfies every engine range | an agent |
| 1b | TypeScript 7 | **Yes, and permanent for now.** TS 7.0.2 ships no compiler API and typescript-eslint pins `<6.1` | nobody; record and stop reassessing |
| 1c | Electron 44 + electron-builder 26 | No. It is a packaging session, one to two hours | an agent with this machine |
| 2 | 6.2 child runtime, full migration | No. The seam is proven; the rest is ordinary wiring, listed step by step below | an agent, several sessions |
| 3 | 6.5 terminal compatibility mode | Depends on 2 | after 2 |
| 4 | Phase 6 remainder: terminal in the packaged smoke, the wrapper install route, custom renderers, fixture gaps | No | an agent |
| 5 | Person-only visual checks | Yes, needs a person, about 40 minutes | the owner |
| 6 | Phase 4 residue: the never-sent chat's draft, three session states, view records, and four small rows | No | an agent |
| 7 | A real provider, and measurements on other hardware | Needs an API key and an Intel Mac; part of it can be a machine test | the owner + an agent |

---

## 0. CI is red: the streaming smoke test races

**What fails.** `tests/electron/smoke.test.ts` line 537, "shows a reply arriving in
pieces, in the order they were sent": `expected 'one two' to be 'one'`. The CI
macOS runner is slower than this machine, so by the time the first `waitFor`
sees non-empty text the second piece has already arrived. The scripted model
paces pieces on a fixed timer (`BETWEEN_PIECES = 500` in
`tests/electron/scripted-model.ts`), which is a race by construction.

**Fix: let the test release each piece by hand.** Add an optional gate to a
`says` step and expose `next()` on the model.

```ts
// tests/electron/scripted-model.ts
export type Step =
  | { says: readonly string[]; byHand?: boolean }
  | { calls: { name: string; arguments: Record<string, unknown> } };

export type ScriptedModel = {
  // ...existing members
  /** Release the next piece of a `byHand` reply. */
  next(): void;
};

// inside the server, where the pieces are sent:
let release: (() => void) | null = null;
for (const piece of step.says) {
  send({ type: 'text_delta', contentIndex: 0, delta: piece });
  const between = Promise.withResolvers<void>();
  if (step.byHand === true) release = between.resolve;
  else setTimeout(between.resolve, BETWEEN_PIECES);
  await between.promise;
}
// and on the returned object:
next() { release?.(); release = null; },
```

Then in the test:

```ts
model.replies([{ says: ['one ', 'two ', 'three'], byHand: true }]);
// ...send
await vi.waitFor(async () => expect((await arriving.innerText()).trim()).toBe('one'), { timeout: 60_000 });
expect(await window.locator('.message__caret').count()).toBe(1);
model.next(); // 'two '
await vi.waitFor(async () => expect((await arriving.innerText()).trim()).toBe('one two'), { timeout: 60_000 });
model.next(); // 'three'
await vi.waitFor(async () => expect((await arriving.innerText()).trim()).toBe('one two three'), { timeout: 60_000 });
```

Note the gate is armed after the first piece is sent, so the first `next()`
releases piece two. Keep the timer default so the other tests are unchanged.

**Done when:** `npm run test:electron` is green locally three times in a row and
the Electron smoke job is green on the PR.

---

## 1. Dependency majors: the Node reason is wrong

`docs/handoffs/phase-2-upgrade.md` says vitest 5 is "coupled to a Node decision"
because it needs `^22.12.0`. This machine runs **22.21.1**, `.nvmrc` says `22`,
and `actions/setup-node` with `node-version-file: .nvmrc` resolves the newest
22.x. Every engine range below is already satisfied:

| Package | Target | Engine | Peers to watch |
| --- | --- | --- | --- |
| vitest | 5.0.x | `^22.12.0 \|\| ^24 \|\| >=26` | `vite ^6.4 \|\| ^7 \|\| ^8` (we have 8.3), `@types/node ^22` (we have 22.20.2) |
| jsdom | 29.1.x | `^22.13.0 \|\| >=24` | `canvas ^3` optional, not needed |
| eslint | 10.x | `^22.13.0 \|\| >=24` | `jiti` optional; typescript-eslint 8.70 accepts `eslint ^10` |
| eslint-plugin-react-hooks | 7.1.1 | `>=18` | accepts `eslint ^10` from 7.1.0 |
| mermaid | 12.0.0 | `>=22.12.0` | none |
| unpdf | 1.8.1 | none | `@napi-rs/canvas` optional (images only) |
| electron | 44.3.0 | `>=22.12.0` | packaging session, see 1c |

Make the requirement explicit so nobody re-derives it:

```json
// package.json
"engines": { "node": ">=22.13" }
```

and optionally pin `.nvmrc` to `22.21.1`. Do these as the first commit of the
pass.

**Method for every group, unchanged from the plan.** One group per commit. For
each: `npm install <pkg>@<version>`, then `npm run typecheck && npm run lint &&
npm test`, then `npm run licenses` and `npm run licenses:check` (the manifest is
generated from the lockfile and its test goes red otherwise), then the group's
own extra check listed below. A group that goes red and cannot be fixed inside
the session is reverted with `git checkout package.json package-lock.json && npm ci`
and its reason written into `phase-2-upgrade.md` with the exact error.

### 1a. vitest 5 (with jsdom 29 in the same session)

There is no `vitest.config.*` in the repo; the suite runs on defaults with
per-file `// @vitest-environment jsdom` comments (47 files). That removes most
of the migration surface. What this tree actually uses that changed:

- **`bench`** appears in 4 test files. In vitest 5 `bench` is no longer a module import; it is a fixture on the test context. Find them with `grep -rln "bench(" tests` and either convert to `test('name', ({ bench }) => …)` or, if they are benchmarks nobody runs, delete them.
- **`clearMocks` is on by default.** Any test that relies on `vi.fn()` call history surviving across `it` blocks in one `describe` will break. Run the suite and read the failures; the fix is to assert inside the test that made the calls.
- **Unawaited async assertions fail the test.** `expect(promise).resolves…` without `await` used to be auto-awaited. Grep for `expect(.*).resolves\|.rejects` not preceded by `await` or `return`.
- **`expect.poll` rejects on timeout** and its callback gets an `AbortSignal`. Not used here (0 hits).
- **`testNamePattern` joins names with ` > `**. `npm run test:extensions` and the CI `npx vitest run tests/e2e` pass paths, not patterns, so nothing changes.
- **Artifacts move under `.vitest/`.** Add `.vitest/` to `.gitignore`.

Order: `npm install -D vitest@5 @vitest/coverage-v8@5` (only if coverage is
installed; check `npm ls @vitest/coverage-v8`), fix, green; then
`npm install -D jsdom@29`, run the 47 jsdom suites together
(`npx vitest run $(grep -rl "vitest-environment jsdom" tests)`), then the whole
suite. jsdom 29's DOM changes that bit other projects: `innerText` layout
assumptions, `getComputedStyle` on detached nodes, and stricter `URL`/`Blob`.
The real-window suite is the backstop for anything jsdom cannot judge.

**Done when:** the whole suite, `test:electron`, and the CI Tests job are green on the new versions, and the two rows in `phase-2-upgrade.md` move to "landed" with the commands run.

### 1b. eslint 10 + eslint-plugin-react-hooks 7

`eslint.config.js` is a flat config already (`tseslint.config(...)`), so the
config format is not a migration. Steps:

1. `npm install -D eslint@10 eslint-plugin-react-hooks@7 @eslint/js@10`.
2. `npm run lint`. ESLint 10 removed a handful of core rules' legacy options; the config uses `eqeqeq`, `prefer-const`, `no-var`, `no-debugger`, `no-console`, `no-unused-vars`, all still present.
3. The hooks plugin 7 brings the React Compiler rules into `recommended-latest`. Expect new findings on `set-state-in-effect`, `refs`, `immutability`, `purity`. Do not blanket-disable: fix the ones in files this branch touched, and for the rest add a **temporary** `rules` block that sets each new rule to `'warn'` with a one-line comment naming the rule, so the gate stays green and the count is visible. Record the count in the handoff.
4. The plan's own ask was to review new findings "especially lifecycle effects and stale closures", which is exactly what these rules report; a day on the warnings is worth it, but it is a separate commit.

**Done when:** `npm run lint` clean, the CI Lint job green, warnings counted in the handoff.

### 1c. mermaid 12

`src/lib/mermaid.ts` calls `initialize({ securityLevel: 'strict', theme: 'base', themeVariables })` and `render(id, text)`. Both survive. What 12.0.0 changes:

- ELK is bundled and is the **default layout**; the look changes to `neo` and the default theme to `redux-color`. To keep today's picture, add `layout: 'dagre'` and `look: 'classic'` to the `initialize` call.
- `defaultRenderer` in the `flowchart`/`class`/`state` config is gone (not used here).
- Legacy diagram ids `flowchart`, `class`, `state` are gone in favour of `flowchart-v2`, `classDiagram`, `stateDiagram`. Diagram *text* still starts with `flowchart` and `classDiagram`; only the internal ids moved. Check with the five cases in `tests/mermaid.test.ts`.
- Target is ES2024. Electron 43 is fine.
- The bundle: bundled ELK is large. After the install run `node scripts/perf-report.mjs --check` and confirm mermaid is still only in the on-demand set (it is loaded on the first fence). If it moved into the launch set, the build budget test fails and that is the signal.

```ts
mermaid.initialize({
  startOnLoad: false,
  securityLevel: 'strict',
  theme: 'base',
  layout: 'dagre',
  look: 'classic',
  themeVariables: diagramTheme(colors, isDarkBackground(background)),
});
```

**Done when:** `tests/mermaid.test.ts` (5, including the hostile label) passes, the budget check passes, and one real diagram is looked at in the app (`npm run app`, paste a flowchart fence).

### 1d. unpdf 1.8.1

One importer: `src/agent/pi/pdf.ts` line 16, `extractText(buffer)`, reading
`{ totalPages, text }` and mapping `text` as an array. Checked against 1.8.1's
types today: `extractText(data)` without options still returns
`text: string[]`; with `{ mergePages: true }` it returns a string. **The call
site does not change.** Two things to check rather than assume:

1. 1.x resolves PDF.js differently. Run `tests/attached-pdf-wired.test.ts` and `tests/read-a-file.test.ts` (both touch the PDF path) and one manual paste of an arXiv link in the app.
2. Encrypted and corrupt PDFs: 1.x throws different error classes. `readPdfPages` is called inside a try in the tool; make sure the sentence the person reads for a bad PDF is unchanged (search `tests` for the words used today).
3. `@napi-rs/canvas` is a peer for `extractImages` only; we do not call it and should not install it (it is a native binary that would end up in the package).

**Done when:** the two suites pass, `npm run licenses:check` passes, and one real PDF is read in the app.

### 1e. TypeScript 7: do not attempt, and stop reassessing

Probed today in a scratch folder: `typescript@7.0.2` ships `bin/tsc` and
`lib/tsc.js` only. `require('typescript')` has no `main`; `transpileModule`,
`createSourceFile` and `SyntaxKind` are all `undefined`. The three compiler-API
consumers (`scripts/no-dashes.mjs`, `tests/asking-wired.test.ts`,
`tests/overview-roots.test.ts`) cannot run on it at all, and typescript-eslint
8.70 pins `typescript >=4.8.4 <6.1.0`, so the lint stack refuses it too.

Change the row in `phase-2-upgrade.md` to: **stay on 5.9.x (supported); revisit
only when typescript-eslint publishes a peer range that includes 7 and either a
JS compiler API returns or the three consumers are rewritten.** The rewrite, if
ever wanted: `no-dashes.mjs` can parse with `@typescript-eslint/typescript-estree`
(already in the tree), and the two tests can use `esbuild.transformSync` (esbuild
is a direct dependency since the Vite 8 move) in place of `transpileModule`.

### 1f. Electron 44 + electron-builder 26: the packaging session

This is one session, not a dependency row, and it needs this machine because
the x64 bundle is built here and run under Rosetta.

1. `npm install -D electron@44 @types/node@22` (types stay on 22 until Electron's Node moves past it; check `npx electron --version` and `npx electron -e "console.log(process.versions.node)"`).
2. `npm run typecheck && npm test`, then `npm run test:electron` (real window under the new Electron).
3. `npm install -D electron-builder@26`. Builder 26 changed the default for `npmRebuild` handling and the signing defaults; our config sets `npmRebuild: false`, `identity: null`, `asarUnpack`, and an `afterPack` hook (`scripts/adhoc-sign.mjs`). Read the builder 26 release notes for `afterPack` context shape changes before running.
4. `npm run package` (both arches), `npm run verify:package` (both bundles: Pi 0.85.1 in the unpacked tree, node-pty helper executable, signature verifies), `npm run test:packaged`, `node scripts/clean-machine.mjs` (arm64 and x64 under Rosetta).
5. `npm run licenses && npm run licenses:check`.

**Done when:** all of step 4 is green on both bundles and the phase 2 and phase 9 handoffs carry the new Electron/Node versions in their "started version=…" lines.

---

## 2. 6.2: hosting a conversation in a child, for real

The spike (`docs/handoffs/phase-6-runtime-spike.md`) proves the seam with 12
tests: `startRuntime` in `electron/services/runtime-supervisor.ts`, the child in
`src/agent/pi/runtime-child.ts`, the wire in `src/agent/pi/rpc-protocol.ts`.
The build entry already exists (`scripts/build-electron.mjs` builds
`dist-electron/runtime-child.mjs`; the spike handoff's step 1 is done). What is
left is ordinary wiring, and it should be done behind a switch so the
in-process path stays the default until the child path has the same evidence.

### 2.1 The shape: a `GrapheSession` backed by a child

`electron/main.ts` builds a session in three places (`createSession(` at about
lines 5022, 7020 and 10600) and everything downstream speaks `GrapheSession`
(the type in `src/agent/pi/adapter.ts`: `prompt`, `steer`, `stop`, `holdOn`,
`useModel`, `setThinking`, `takeBackQueue`, `dispose`, `subscribe`-style
`onEvent`, plus the read-only facts). The least invasive migration is a second
implementation of that type:

```ts
// src/agent/pi/child-session.ts
export async function createChildSession(options: CreateSessionOptions): Promise<GrapheSession> {
  const guard = guardFor(options);            // 2.2
  const runtime = await startRuntime({
    cwd: options.projectRoot,
    agentDir,
    args: argsFor(options),                   // model, session file, -e for each trusted extension path
    judge: guard.judge,                       // 2.2
    ask: options.ask,                         // the same askTheWindowFor the in-process path gets
    onUnsupportedUi: (request) => options.onEvent({ type: 'notice', ... }),
    onChatter: (line) => log.debug(line),
  });
  runtime.onEvent((event) => guard.relay.fromPi(event));   // 2.3
  runtime.onExit((how) => settleExit(how));                 // 2.4
  return {
    prompt: (text, images, o) => runtime.send({ type: 'prompt', message: text, ...attachments(images) }).then(() => undefined),
    steer:  (text, images)    => runtime.send({ type: 'steer',  message: text, ...attachments(images) }).then(() => undefined),
    stop:   ()                => runtime.send({ type: 'abort' }).then(() => undefined),
    useModel: (choice)        => runtime.send({ type: 'set_model', provider: choice?.providerId, modelId: choice?.modelId }).then((r) => r['success'] === true),
    setThinking: (level)      => { void runtime.send({ type: 'set_thinking_level', level }); return level; },
    dispose: ()               => { void runtime.stop(); },
    // ...the rest, one RPC command each; names are in
    // node_modules/@earendil-works/pi-coding-agent/docs/rpc.md, sections
    // Prompting, State, Model, Thinking, Queue Modes, Compaction, Session.
  };
}
```

Command names must be read from the installed `docs/rpc.md`, not from memory,
and the contract test in 2.7 is what keeps them honest. `holdOn`/`held`
(Paused) and `takeBackQueue` have no RPC equivalent: `holdOn` stays a shell-side
gate inside `judge` (the interceptor already waits on `paused.gate()` before
judging), and `takeBackQueue` maps to the queue commands in the "Queue Modes"
section (get and clear the follow-up queue).

Switch: read `GRAPHE_CHILD_RUNTIME=1` (env for tests) or a per-profile setting
`runtime: 'child' | 'in-process'` and pick `createChildSession` or
`createSession` in one helper called from all three sites. Default stays
`in-process` until 2.8 is green.

### 2.2 The Guard, in the shell

`createSession` builds the interceptor at adapter.ts about line 2603:
`createGuardInterceptor({ facts, relay, confirmations, paused, timeline,
planning, planMode, rules, world, filesMayHaveMoved, workBegan })`. Everything
it needs is shell-side state. Extract that block into

```ts
export function guardFor(options: CreateSessionOptions): {
  relay: Relay; review: (call: ToolCall) => Promise<Interception>;
  judge: VerdictForCall; asking: Asking; confirmations: Confirmations; paused: Paused;
}
```

and call it from both `createSession` and `createChildSession`. `judge` is a
one-line adapter over `review`:

```ts
judge: async (call) => {
  const decided = await review(call);
  return decided.block === true ? { block: true, reason: decided.reason } : { block: false };
},
```

Because `review` runs in the shell, `Confirmations`, `Asking`, `Paused`,
`abandonAll` and the `questions-withdrawn` events all keep working unchanged;
the child only ever sees the verdict. The restore point (`timeline.snapshot`)
also runs in the shell before the verdict is sent, which is what the spike said
was unproven; prove it with a test that a destructive call from a child-hosted
turn leaves a `refs/graphe/checkpoints` entry before the file changes.

A verdict that takes longer than the child's deadline is a refusal by
construction (rpc-protocol's rule). Keep the confirm dialog's own timeout below
that deadline or raise the child's deadline for `confirm` verdicts; either way,
write the number down in the handoff.

### 2.3 Events

The in-process path feeds Pi session events into `relay.fromPi(event)`
(`src/agent/pi/events.ts` line 420). Pi's RPC mode forwards the same session
events as JSON records. Feed `runtime.onEvent` into the same `relay.fromPi` and
prove the equivalence once: record the event stream of one scripted turn on each
path and assert the `AgentEvent` sequence the relay emits is identical (ignoring
timestamps). If a field differs (RPC uses `snake_case` type names such as
`message_update`, `tool_execution_end`), add the translation in one function
next to `fromPi` rather than in the child session.

### 2.4 Exit, unanswered questions, and the run journal

`ChildExit` carries `kind: 'died' | 'killed'` and `unanswered: string[]` (dialog
ids and a parked tool-call id). On exit:

1. For each id in `unanswered`, settle the pending request in the shell's registry as cancelled: the extension asks live behind `CHANNEL.extensionAsk`/`extensionAnswer` (main.ts about lines 5890 and 8880); the Guard confirmations in `Confirmations`. Use the existing "settle everything still waiting as cancelled when the run stops" path that closing a conversation already calls.
2. `died` marks the run interrupted: the note the app writes for in-flight work is `wroteRunNote` / `tookRunNoteAway` in `electron/services/run-record.ts` and `recoverAfterRestart` reports it at the next launch. Write the note when a child-hosted prompt starts and take it away when the turn settles or the child is `killed` by us; leave it in place on `died` so the existing launch-time sentence appears.
3. Emit the same `AgentEvent`s the in-process path emits for an interrupted turn, so the transcript's "interrupted" marker is drawn by existing code.

Test: SIGKILL the child mid-turn (the spike already does this) and assert the
dialog promise resolved as cancelled, the run note is present, and the window's
Stop button returned to Send.

### 2.5 Packaged worker

`BUILT_CHILD` resolves to `dist-electron/runtime-child.mjs` beside `main.mjs`,
which is **inside `app.asar`**. The spike verified `rpc-entry.js` under
`ELECTRON_RUN_AS_NODE`, but not an ESM child imported out of the archive. Check
it: `npm run package:quick`, then spawn the child from the bundle by hand
(`ELECTRON_RUN_AS_NODE=1 Graphe.app/Contents/MacOS/Graphe
Graphe.app/Contents/Resources/app.asar/dist-electron/runtime-child.mjs`). If the
import fails, add `dist-electron/runtime-child.mjs` to `asarUnpack` in
`electron-builder.js` and resolve `BUILT_CHILD` through `app.asar.unpacked` when
`app.isPackaged`. Either way add a check to `scripts/verify-package.mjs` that the
child file exists and starts (it already imports Pi's entry from the bundle at
about line 149; do the same for the child and expect the `ready` line).

### 2.6 Memory, eviction, and the ceiling

The spike did not measure memory. Measure it in the packaged run: after a
settled turn, read `ps -o rss= -p <runtime.pid>` from the shell and log it; add
a `child` scenario to `scripts/measure-runtime.mjs` that starts N conversations
with `GRAPHE_CHILD_RUNTIME=1` and records RSS per child and the shell's own RSS.
Then:

- **Idle eviction**: a child whose conversation has had no prompt for T minutes and is not `working` is stopped with `runtime.stop()` (`killed`, not `died`), its session state set to `unloaded`, and it is started again on the next prompt from the same session file. The state machine already has `unloaded`.
- **Ceiling**: `maxChildren = floor((os.freemem() at launch * 0.5) / measuredRssPerChild)`, clamped to `[2, 8]`, written to the log at launch. Past the ceiling, a new prompt evicts the idle child with the oldest last-activity rather than refusing.

Record the numbers (hardware, Electron, Pi version, RSS per child, shell RSS) in the runtime-spike handoff.

### 2.7 A contract test for the RPC shapes

Pi is pre-1.0. Add `tests/rpc-contract.test.ts` that starts one real child (the
spike's fixture) and asserts, against the installed `docs/rpc.md`, the exact
command names and response fields the child session uses: `get_state`,
`prompt`, `steer`, `abort`, `set_model`, `set_thinking_level`, and the event
types `agent_start`, `message_update`, `tool_execution_start`,
`tool_execution_end`, `agent_end`, `extension_ui_request`. Pin the Pi version in
the test the way `tests/pinned-runtime.test.ts` does, so a Pi bump fails here
first.

### 2.8 Turning it on

The child path becomes the default only when: the real-window suite passes with
`GRAPHE_CHILD_RUNTIME=1` (add it as a second CI matrix entry of the Electron smoke
job), the packaged smoke starts a child in the bundle, the memory numbers are
recorded, and a trusted extension with a synchronous infinite loop (the `spins`
fixture) no longer freezes the window. That last one is the plan's stated reason
for 6.2 and is the acceptance test.

---

## 3. 6.5: terminal compatibility mode

Blocked on 2 by the plan's own rule: the Guard, request and transcript hooks
must cross a process boundary before a second process may own a conversation.
Once 2.2 through 2.4 are done, the honest minimum is:

1. **A press, not a mode.** `Open in terminal` on the conversation's menu, enabled only when the session is idle. If a run is going the label is `Stop and open in terminal`.
2. **Handoff**: `runtime.stop()` (or the in-process `dispose`) and wait for it; acquire the conversation's writer lease (the same `WorkspaceLocks` the shell uses); write a handoff record `{ conversationId, sessionFile, cwd, model, extensionPaths, at }` to the profile.
3. **Launch** the pinned Pi interactive entry in the existing `TerminalPane` pty (`electron/services/terminal.ts`) with `--session <file>` and the same `-e` list and cwd, and Graphe's control extension loaded so tool calls are still judged through `judge` (the same channel as the child runtime, on fds 3/4). No secrets on the command line; credentials travel as they do for the child.
4. **The GUI side** shows the transcript read-only with a `Terminal mode` band; every pane of the conversation shows it; Send is disabled with the reason.
5. **On exit** of the pty, release the lease, re-read the transcript with `readTranscript`, reconcile usage from Pi's session file, and offer `Continue here`. Nothing is re-sent.
6. **Unsupported** stays unsupported: custom TUI components draw in the terminal, which is the point; but a capability that cannot be guarded there (whatever the compatibility matrix in `docs/handoffs/extension-compatibility.md` marks) is stated on the press before it runs.

The release gate is the compatibility matrix run in terminal mode, with each row
recorded, not the existence of the pane. Budget this as its own multi-session
item after 2.

---

## 4. The rest of phase 6

### 4.1 The terminal inside a packaged app

`scripts/packaged-smoke.mjs` says in its own output that it does not prove the
terminal. It drives the bundle with Playwright's `_electron`. Add one step after
the composer is proven: open the Commands drawer, press the terminal switch (the
markup is in `src/components/Commands.tsx` about line 240, the pane is
`<section class="termpane">` in `src/components/TerminalPane.tsx`), type
`printf graphe-pty-ok\n` into the xterm textarea, and wait for a row containing
`graphe-pty-ok`:

```js
await window.locator('.termpane .xterm-helper-textarea').focus();
await window.keyboard.type('printf graphe-pty-ok\n');
await window.locator('.termpane .xterm-rows', { hasText: 'graphe-pty-ok' }).waitFor({ timeout: 20_000 });
```

That proves node-pty's `spawn-helper` runs from `app.asar.unpacked` in a real
bundle, which is the packaging requirement E02 names. Then remove "the terminal"
from the smoke's "not proven" sentence. No provider is needed.

### 4.2 The install route that still cannot be cancelled

`packageHost` in `src/agent/pi/adapter.ts` (about line 1720) runs installs as
the app's own child with an `AbortSignal`, except when Pi's settings carry an
`npmCommand` wrapper (`mise exec node@20 -- npm` and the like); then it falls
back to Pi's manager, which has no stop. Close it by honouring the wrapper
ourselves:

```ts
// `getNpmCommand()` is `string[] | undefined` in Pi 0.85.1.
const configured = settings.getNpmCommand();
const npm: readonly string[] = configured === undefined || configured.length === 0 ? ['npm'] : configured;
outcome = await installAddon(run, doing, { folder: root, present, npm }, id, controller.signal, progress);
```

`installAddon` takes the executable prefix from `npm` (first element is the
command, the rest go before npm's own arguments) instead of hard-coding
`'npm'`. Then the Pi route in `change()` goes away and so does the
`CANNOT_STOP` sentence for this case. Test in `tests/package-stop.test.ts`: a
configured wrapper that is a small script which sleeps; Stop ends it and the
settings file is not written.

### 4.3 Custom renderers

An add-on's `renderCall`/`renderResult` return a pi-tui `Component`, whose
whole contract is `render(width: number): string[]`
(`node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-tui/dist/tui.d.ts`
line 68). Fidelity without a terminal: call it headlessly with a fixed width
(80), strip ANSI, and draw the lines in a `<pre>` under the tool card with the
line `Drawn as this add-on draws it in a terminal`. It runs wherever the
extension runs (in-process today, in the child after 2, with the lines sent
back as a tool-result detail). A renderer that throws falls back to today's
generic card. Add a fixture with a `renderResult` and a test that the lines
reach the window.

### 4.4 The fixture gaps

The eight gaps the compatibility matrix records (phase 6 handoff, exit
criteria): an abort signal not carried to an add-on's question, no status line,
a plain-text widget refused, no duration on a tool record, shortcut conflicts
nobody reports, a provider an add-on registers that the window does not list,
a notice with no add-on name, and no durable home for notices. Each is one
fixture plus one small UI change; "commands never reach the picker" is already
done. Take them one per commit, cheapest first (duration on the tool record,
add-on name on notices).

---

## 5. What only a person can check

About forty minutes at the window, on `npm run app` or the packaged build.
Record each line in `docs/handoffs/visual-matrix.md` under "What only a person
can check" with pass/fail and one sentence.

| # | Check | Steps |
| --- | --- | --- |
| 1 | Screen reader | ⌘F5 for VoiceOver. ⌃⌥→ through the add-ons screen: are the four `Add …` presses read as their own add-on? Open Settings: does VoiceOver stay inside the sheet? Is the "Working" mark read as status, not image? |
| 2 | Monitor unplug | Move the window to an external display, unplug it: window reachable? Plug back in: does it return, same size and place? |
| 3 | OS switches | System Settings → Accessibility → Display: turn on Reduce Motion, then Increase Contrast, with the app open. Does it follow without relaunch, and agree with the in-app Motion and Contrast settings? |
| 4 | Native file dialog | `Open another folder…` with the file panel on. Is it above everything? Esc and Cancel leave the window as it was and keyboard focus returns? |
| 5 | Add-on question over the page | Serve the project (`See it`), get an installed add-on to ask a question. Is the card above the page and clickable; does Esc answer it? |
| 6 | Overlays over the native preview | With a served page visible, open each of: Settings, command palette, ask bar, connect sheet, composer popover. Click where the page is: does the click go to the overlay? |
| 7 | Contrast by eye | Is the faintest text readable? Does a 96 px project name cut to `a-project-with-an…` still read as what it is? |
| 8 | Loading layout | Cold start, press Settings quickly. Is the blank arriving rectangle acceptable? |

Two machine tasks come out of that list:

- **Loading layout as a harness check.** The visual matrix's `--built` mode can serve `dist/` over HTTP the way `tests/electron/smoke.test.ts` does (`serve(BUILT_RENDERER)`); once it is HTTP, `window.route('**/assets/*Settings*.js', (r) => setTimeout(() => r.continue(), 3000))` holds the lazy chunk long enough to screenshot `.sheet--arriving`.
- **Name the busy rectangle.** `src/App.tsx` line 281: `ARRIVING` is `aria-busy` with no name. Give it `role="status"` and `aria-label` of the sheet it is holding (pass the heading in), so a screen reader says what is busy.

---

## 6. Phase 4 residue

The rows in `docs/handoffs/phase-4-conversations.md` "Not done":

- **A draft in a chat nobody has sent in.** Probably fixed since the row was written: `newAddress()` in `electron/main.ts` (about line 2027) mints a `ConversationId` at creation, and `Composer.tsx` keeps no draft at all when `conversation` is null (`keptAt === null`). What is missing is the proof and the handoff update. Write `tests/draft-new-chat.test.ts`: two New presses in one project, type in each, switch, both drafts distinct; restart the store, neither draft appears in a third New chat. Then mark the row done.
- **Three session states** (`waiting-input`, `compacting`, `archived`). Drive the first two from the relay: `waiting-input` when `Asking` has an open question, `compacting` between Pi's `compaction_start`/`compaction_end`. `archived` is a record flag, not a runtime state; either delete it from `SESSION_STATES` or document it as such. One test per transition in the existing states suite.
- **View records.** Add `views: Record<ViewId, { conversation: ConversationId; pane: 0 | 1 }>` to the registry index in `electron/services/workspace-registry.ts`, written when a pane opens and read at launch. The migration is a schema bump with a default of no views.
- **Temporary address mapping, rapid New presses, the interrupted sentence's lifetime, `workspaceId` in the run record.** Each is a one-session change; the row text already says what is missing. Take them after the items above.

---

## 7. A real provider, and other hardware

**What needs the owner.** An API key for one provider (Anthropic or OpenAI) put in
through the app's Connect flow on a disposable profile, and access to an Intel
Mac (or a CI macOS-13 runner) for the x64 half.

**What an agent can turn into a machine test first.** Pi's auto-retry runs on
provider error shapes, and the scripted model already speaks Pi's protocol. Add
a step type `{ fails: { status: 529, times: 2 } }` to
`tests/electron/scripted-model.ts` that answers overloaded twice and then
streams; assert `auto_retry_start`/`auto_retry_end` reach the window, the
transcript has the tool result once, and the usage ledger charges once. That is
T31's retry half without a live service.

**With a real provider, on the owner's key:**

1. `npm run app` against a fresh profile with `GRAPHE_PROFILE=<tmp>`; connect the key.
2. T31: start a tool-using turn, pull the network (Wi-Fi off) mid-tool, restore it: partial data preserved, retry does not duplicate the completed tool.
3. T32: remove the key mid-conversation (Connect → disconnect): the app asks which model to use; it never silently switches to another paid provider.
4. Compaction against the live service: a long conversation reaches Pi's threshold; the compaction boundary is drawn and nothing is said twice.
5. Record each in `docs/handoffs/phase-10-scenarios.md` rows T31/T32 with the provider, model and date.

**Other hardware.** On the Intel Mac: `npm ci`, `npm run test:measure -- --json=measure-x64.json`, `node scripts/clean-machine.mjs`, `npm run test:packaged`. Paste the numbers into the "Measured" table of `docs/handoffs/phase-9-performance.md` with hardware, macOS, arch, Electron and Pi versions, beside the arm64 row. The budgets in `tests/operations/budgets.test.ts` are the pass/fail line.

---

## Suggested order for the next sessions

1. Item 0 (an hour). Ship it alone so the PR's checks go green.
2. Items 1a through 1d, one group per session, then 1f as a packaging session. Rewrite the TypeScript row as 1e says.
3. Item 4.1 and 4.2 (a session each), then 6's first row.
4. Item 2, sections 2.1 through 2.4 in one stretch (the shape, the Guard, events, exit), then 2.5 through 2.8.
5. Items 4.3, 4.4 and the rest of 6 whenever a session has room.
6. Item 3 after item 2 is on by default.
7. Item 5 and the owner's half of 7 whenever the owner has forty minutes and a key.

Every session ends with the handoff row updated, `STATUS.md` updated, and
`npm run typecheck && npm test` clean.
