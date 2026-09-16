# The last pass before publishing: what comes back, what gets checked, what the site says

Written 2026-09-16 against `fix/ownership-stabilization` (PR #51). This is the plan
for the work that starts **after** `docs/graphe-stabilization-remaining-2026-09-16.md`
is finished. It has five parts: the audit of what phase 8 removed and the verdict on
each, the canvas brought back as a shell-run feature that fits the new architecture,
a small read-only tokens panel, a sweep of the surfaces this branch added, and the
landing page with new captures and the SEO fixes. Everything here is written so that
several small agents can take a package each and work at the same time.

## Read this first: how to work on this document

**Speed rules. These override habit.**

- Never wait for CI. Push, move to the next package, and let one agent check the PR's
  checks once at the very end (section 7). A CI wait is twenty minutes of nothing.
- After an edit run `npm run typecheck` and **only the test files for what you touched**:
  `npx vitest run tests/canvas.test.ts` and the like. Run the full `npm test` once, at
  the end of your package, before you commit. Not after every change.
- `npm run test:electron`, `npm run test:packaged`, `npm run test:visual`,
  `npm run package` and `npm run verify:package` run only where a package names them,
  and once. Nothing in this document needs them after every change.
- `npm run lint` and `npm run copy:check` once per package, with the full test.
- Packages that share no files run in parallel. `src/App.tsx`, `electron/main.ts`,
  `src/lib/ipc.ts`, `electron/preload.ts` and `src/lib/bridge.ts` are owned by the
  integration package of each section; other packages build against the interfaces
  written down here and do not touch those five files.
- One commit per package, in the repo's commit style (a sentence, no trailer). Update
  the handoff once per package, not per edit. `docs/handoffs/STATUS.md` gets one row
  per section when the section lands.
- Do not re-derive what this document states. Where it says a file or function exists,
  it was checked on 2026-09-16; if it has moved, `grep` for the name and carry on.

**Rules that still apply.** `npm run typecheck && npm test` clean before "done".
Comments one or two lines, why not what, no references to this document or to
backlog ids. Buttons name the operation in one to three words. No `Co-Authored-By`.
The vocabulary is the one in `CLAUDE.md`: **worktree**, **branch**, **commit**,
**pull request**, **Review** for finished work, **continue**, **idle**.

**Where the remaining document stands.** Verified against `git log` on 2026-09-16:
item 0 (the streaming race) landed; 1a to 1d (vitest 5, jsdom 29, eslint 10 and hooks
7, mermaid 12, unpdf 1.8) landed; 1e (TypeScript 7) is closed as "do not attempt";
1f (Electron 44, builder 26) is in the working tree and needs its packaging session;
4.1 (the terminal in the packaged smoke) is done; two rows of 6 (the never-sent draft,
the session states) are done and the `views` record is in the working tree with no
consumer yet. Still open there: 2 (child runtime), 3 (terminal mode, after 2), 4.2 to
4.4, 5 (a person at the window), the rest of 6, and 7 (a real provider, other
hardware). This document starts when items 2, 4.2 to 4.4 and 6 are closed. Items 3, 5
and 7 can run beside it because they touch none of the files below.

---

## 1. The audit: what phase 8 removed, and the verdict

`docs/handoffs/phase-8-retirements.md` is the manifest; commit `b4dcd58` removed the
design screens one commit earlier. Every removal was read again for this document.
The filter: it comes back only if somebody would notice it was gone, and only if it can
be built on the architecture this branch made (a run takes its workspace for its whole
length, one writer per folder, every shell action for a named owner, finished work goes
through Review).

| Removed | Was | Verdict | Why |
| --- | --- | --- | --- |
| Canvas (row 5) | Blocks joined into a flow, run as turns in one conversation from the window | **Comes back, rebuilt** (section 2) | The one thing removed that has no substitute: composing several steps, walking away, and reading what each came to. The old one had six real defects (listed in 2.1); the new one runs in the shell and fits the workspace rules |
| Design view: token spec sheet (`Styles`, `tokens.ts`, `grouping.ts`) | Read a project's CSS custom properties from `:root`, grouped, with use counts, editable, one Save = one commit | **Comes back read-only and small** (section 3) | The parser is careful and tested (comment masking, `:root` scoping, byte-exact positions). "What colours does this project have, and who uses `--space-4`" is a real question for both audiences, and the agent has no way to read a project's tokens today. Editing, sliders and the six-band hub stay out |
| Design view: Inspector, Legible, Motion, Responsive, Drift panels | Automatic design QA over token names and CSS | Stays out | Reasoned about names, never the rendered page; the Inspector was already dead before removal. An agent with the browser does this on request |
| Visual evidence furniture (row 1): recorder, evidence reel, version thumbnails | Automatic capture on settle | Stays out | Nobody pressed a button for it, which is the rule in `CLAUDE.md`. The user-requested screenshot and walkthrough in the browser pane remain |
| Designer handoff, publish, room share (row 2) | Shortcuts around push, PR, deploy | Stays out | The ordinary branch, commit and pull request paths do the same thing with real names |
| Figma following (row 3) | Keep a project in step with a Figma file | Stays out | An ordinary Figma link is chat context and `figma_read` exists. Following was a mode left switched on |
| Variations and tournaments (row 4) | Several designs served side by side, scored | Stays out | Two worktrees and Review is the honest version; the canvas's worktree lanes (2.3) cover "try it two ways" |
| Repeats, overnight, across-project, wait-for, take-all (row 6) | Duplicate orchestration around the board | Stays out | The board and `task` in background mode remain; the canvas is the composing surface, and a repeat is a scheduler nobody asked for |
| Held-back designer changes (row 7) | Work held for a designer's yes | Stays out | Review is the queue for finished work now |

Nothing else of user value went with those commits. `src/design/drift.ts` and
`src/design/usage.ts` are still in the tree with no importer; section 3 uses neither
and they can be deleted in that package.

---

## 2. The canvas

### 2.1 What it is now, and what it fixes

A canvas is a drawing of steps that becomes work when somebody presses Start. Each
block is a turn in a conversation, with the same tools and the same Guard a person
typing would get, so a canvas is a way of sending, not a second kind of agent. That
part of the old design was right and stays.

What changes:

| Old defect | New rule |
| --- | --- |
| The window ran the flow: a `settled` event on the conversation advanced it, so closing the window, or typing into that conversation by hand, moved or lost the flow | **The shell runs the flow.** A flow run is a shell service with a run id; it advances on the settle of the turn it sent, and on nothing else. Closing the window changes nothing |
| Per-block model was shown and never sent | The block's model and thinking level are set on the session before its turn and put back after |
| `failed` existed in the type and was never produced; an error mid-turn left a block on "Going" for ever | Every block ends in exactly one of `done`, `failed`, `stopped`; an error is a failure with its sentence on the card |
| Fan-out drew parallel and ran sequential | Branches are **in turn** by default and say so; with **worktrees** on, each branch after the first runs in its own worktree and its own conversation, in parallel, under the same ceiling as background work. What each branch wrote stays on its branch and lands from Review |
| `turns` counted the whole conversation; "Start again" kept stale results | A run is a record: per block, what it said, turns in that block, cost, time. Runs are kept, newest first |
| Closing the tab deleted the drawing | Closing a tab closes a view. Delete is its own press with a confirm |
| A goal's "done" was `tsc --noEmit` | A Checks block, and a goal's rounds, run the project's own checks, the ones the "things this project always does" feature already runs |
| Ten kinds, seven of them one sentence each | Seven kinds, four of them real machinery (Checks, Review, Pull request, Gate) and three sentences (Ask, Plan, Goal). "Research it", "Split between subagents", "Check it in the browser" are starting sentences inside Ask, not kinds |
| A 1682-line view | Six components with one job each |

### 2.2 The model (`src/work/canvas.ts`, pure)

Restore the file from `git show 89375fa^:src/work/canvas.ts` as the starting point and
rewrite the types to these. Everything in this file is a function of its arguments;
no I/O, no timers, no React.

```ts
export type BlockKind = 'ask' | 'plan' | 'checks' | 'review' | 'gate' | 'pull-request' | 'goal';

export type BlockModel = { providerId: string; modelId: string } | null;

export type Block = {
  id: string;                          // `block-…`, stable from placement
  kind: BlockKind;
  /** Two or three words on the card. The kind's own name until edited. */
  name: string;
  /** What it is asked to do. Empty is allowed only for kinds that send nothing. */
  says: string;
  model: BlockModel;                   // null: the flow's default
  thinking: ThinkingLevel | null;      // null: the model's remembered level
  /** Every block this waits for. Empty: it starts the flow. */
  after: readonly string[];
  lookFirst: boolean;                  // plan mode for this turn
  /** Content ids in the attachment store (electron/services/attachment-store.ts). */
  attachments: readonly string[];
  /** Checks and Goal: how many times to send a fix turn before failing. */
  retries: number;                     // default 2 for checks, 6 for goal, 0 otherwise
  at?: { x: number; y: number };
};

export type Lanes = 'in-turn' | 'worktrees';

export type Flow = {
  id: string;                          // `flow-…`
  name: string;
  blocks: readonly Block[];
  howFar: HowFar;                      // default 'doing'
  lanes: Lanes;                        // default 'in-turn'
  runs: readonly Run[];                // newest first, at most KEPT_RUNS = 10
  createdAt: number;
  updatedAt: number;
};

export type RunState = 'running' | 'needs-you' | 'done' | 'failed' | 'stopped' | 'interrupted';
export type BlockState = 'draft' | 'waiting' | 'running' | 'needs-you' | 'done' | 'failed' | 'stopped';

export type Lane = {
  id: string;                          // 'lane-0' is the flow's own; others are branches
  workspaceId: string;
  conversationId: string | null;       // opened on first use
  branch: string | null;               // the worktree's branch, for Review
};

export type BlockRun = {
  state: BlockState;
  lane: string;
  startedAt: number | null;
  endedAt: number | null;
  /** The last thing the turn said, whole. Null until done. */
  said: string | null;
  turns: number;
  spent: Money | null;
  rounds: number;                      // goal and checks retries used
  /** Review: the verdict card's line. Pull request: the URL. */
  result: string | null;
  failure: string | null;
};

export type Run = {
  id: string;                          // RunId from src/domain/identity.ts
  state: RunState;
  startedAt: number;
  endedAt: number | null;
  lanes: readonly Lane[];
  blocks: Readonly<Record<string, BlockRun>>;
  spent: Money | null;
};
```

Functions to keep from the old file, with the same tests: `place`, `remove` (splices a
removed block's parents into its children), `change`, `join`, `unjoin`, `joined`,
`canWaitFor` (refuses self, missing and rings), `columns`, `runOrder`, `nextUp`, `tidy`,
`layOut`, `isArranged`, `lineState`, `readFlow`, `readFlows`, `withFlow`, `withoutFlow`.
`readFlow` keeps reading the old on-disk shape (string `after`, `pictures`, the ten old
kinds mapped: `custom`, `research`, `subagents`, `browser` become `ask` with the old
sentence kept in `says`; `wait` becomes `gate`).

New functions:

- `readyNow(flow, run): readonly Block[]`: every block not started whose parents are all
  `done` in this run. With `lanes === 'in-turn'` at most one, in `runOrder`; with
  `worktrees`, all of them.
- `laneFor(flow, block): string`: pure lane assignment. A block with no parents is in
  `lane-0`. A block inherits the lane of its first parent. A parent's second and later
  children get a new lane each when `lanes === 'worktrees'`, else `lane-0`. A fan-in
  block runs in the lane of its first parent.
- `askOf(flow, run, block): string`: the text that is sent. The kind's sentence for
  `plan`, `goal` and `checks`-fix turns (in `canvasWords`); `says` for `ask`. When the
  block has parents in **other** lanes, each parent's `said` is prefixed under
  `What <parent name> came to:`. Parents in the same lane are already in the transcript
  and are not repeated.
- `endedAs(flow, run): Ending` for the foot band: whole or not, blocks run, turns,
  cost, blocks that never ran, the last thing said.
- `withRun(flow, run)`: replaces or prepends, keeps `KEPT_RUNS`.
- `canStart(flow): { ok: true } | { ok: false; because: string }`: has blocks; no `ask`
  or `goal` with empty `says`; no ring; a `pull-request` block needs the flow to run on a
  branch (worktree lanes, or the project not on its default branch), and the sentence
  says so.
- `undoable(history, flow)`: a small ring of the last 50 flows for undo and redo, pure.

Templates (`TEMPLATES`, three): **Ship it** (ask → checks → review → pull request),
**Plan first** (plan → gate → ask → checks), **Two ways** (ask A and ask B after one
plan, `lanes: 'worktrees'`, then an ask that compares what both came to). Words for
all of it in `canvasWords`, re-swept for the `CLAUDE.md` vocabulary: `Start`, `Stop`,
`Continue`, `Open`, `Watch`, `Delete`, `Duplicate`, `Tidy`, `Fit`; states `Ready`,
`Waiting`, `Running`, `Needs you`, `Done`, `Failed`, `Stopped`.

Tests: `tests/canvas.test.ts` restored from `89375fa^` and extended for `readyNow` (in
turn and worktrees), `laneFor` (chain, fan-out, fan-in), `askOf` (cross-lane prefix,
same-lane none), `canStart` refusals, `readFlow` of the old shape, `undoable`.

### 2.3 Persistence and channels

**On disk.** `<profile>/flows/<projectId>.json`, an array of `Flow`, written with
`writeAtomically` from `src/lib/atomic.ts`. Keyed by the registry's `projectId`
(identity), not the path. `src/projects/flows.ts` comes back as `FlowFile` with
`read(projectId, userData)` and `write(...)`; on the first read for a project it also
looks for the old `<sanitised path>-<sha8>.json` and imports its flows once (the old
`readFlow` rules), then leaves the old file where it is. Attachments are content ids in
the attachment store; a flow file never holds bytes.

**The renderer's edits** go through `flowSave(flow)` held back 400 ms per flow
(`src/lib/heldwrites.ts` restored as it was, with its injected clock) and flushed on
unmount and on `beforeunload`. The shell replaces the flow by id and keeps `runs` as
its own: a save from the window never overwrites `runs`, because the runner owns them.

**Channels** in `src/lib/ipc.ts`, each with a trailing `Where` naming the project, added
to `electron/preload.ts`, the mock bridge and `docs/handoffs/ipc-inventory.md`:

```ts
flowList(where?: Where): Promise<Result<readonly Flow[]>>;
flowSave(flow: Flow, where?: Where): Promise<Result<Flow>>;             // returns the kept one, runs included
flowDelete(id: string, where?: Where): Promise<Result<null>>;
flowStart(id: string, where?: Where): Promise<Result<Run>>;             // refuses with canStart's sentence
flowStop(id: string, where?: Where): Promise<Result<Run>>;
flowContinue(id: string, block: string, where?: Where): Promise<Result<Run>>;   // opens a gate
flowResume(id: string, where?: Where): Promise<Result<Run>>;           // an interrupted run, from its first unfinished block
onFlow(listener: (notice: { project: string; flow: Flow }) => void): () => void;   // push, on every run change
```

The mock bridge keeps flows in `localStorage` under `graphe:flows:<project>` and runs a
fake runner that moves each block to `running` then `done` on a timer with a canned
`said`, so the gallery, the visual matrix and the site captures work without a model.

### 2.4 The runner (`electron/services/flow-runner.ts` + glue in `electron/main.ts`)

A pure state machine in the service file, driven by the shell. The service takes the
flow, the run, and a small port interface; `main.ts` supplies the port from what it
already has. Nothing in the service touches Pi, files or IPC directly, so it is tested
with a fake port.

```ts
export type RunnerPort = {
  openLane(lane: Lane): Promise<Lane>;                 // opens the conversation, or the worktree then the conversation
  send(lane: Lane, block: Block, text: string, options: { model: BlockModel; thinking: ThinkingLevel | null; lookFirst: boolean; attachments: readonly string[]; howFar: HowFar }): Promise<Settled>;
  checks(lane: Lane): Promise<{ passed: boolean; report: string }>;
  review(lane: Lane): Promise<{ verdict: 'ships' | 'needs-work' | 'do-not-land'; line: string }>;
  pullRequest(lane: Lane): Promise<{ url: string } | { failure: string }>;
  stop(lane: Lane): Promise<void>;
  changed(run: Run): void;                             // persist and push
  now(): number;
};
export type Settled = { ok: true; said: string; turns: number; spent: Money | null } | { ok: false; failure: string };
```

How `main.ts` fills the port:

- `openLane`: `lane-0` runs in the workspace the flow was started from (the project
  folder, or the worktree the person is in when they press Start). Any other lane
  creates a worktree through the same function the `worktreeNew` handler calls, then
  opens a conversation in it with `startConversation(open, openingIn(workspaceId))`,
  titled `<flow name> · <lane branch>`. The conversation is an ordinary
  `ConversationRecord`; give it `lineage: { from: <flow id>, kind: 'flow' }` by widening
  the `kind` union in `workspace-registry.ts` (a record field, no index bump) so the
  sidebar can group them under the canvas rather than beside ordinary chats.
- `send`: sets the model with the session's `useModel` and the thinking level when the
  block names them, `goAsFarAs(howFar)`, then `prompt(text, attachments, { lookFirst })`
  and resolves on **this run's** settle: subscribe to the session's events, remember
  the run id the prompt started, and settle on that run's `settled` or `error`. Turns
  and cost are read from the events of that run only. Put the model back afterwards.
  A run takes the workspace for its whole length (`workspace-locks.ts`), so a lane
  never sends two turns at once, and two lanes never share a folder.
- `checks`: the runner the project's "things this project always does" feature already
  has (`src/agent/pi/checks.ts`, the `.agents/checks` reader); passes when every
  check exits 0; the report is the failing checks' output, cut to 4 000 characters.
- `review`: the same shell function the Review press calls (the `graphe:review-*`
  channels in `ipc.ts`), against the lane's changes since the run started.
- `pullRequest`: one turn asking the agent to open a pull request for the branch with
  the `gh` it already has, then `gh pr view --json url` in the lane's folder. No URL
  after the turn is a failure with the reason.
- `changed`: `FlowFile.write` and `onFlow` push. Also `wroteRunNote` at Start and
  `tookRunNoteAway` at the end (`electron/services/run-record.ts`), so a run the app did
  not finish is `interrupted` at the next launch and reported by the existing sentence.

The machine, per tick: take `readyNow`; for each, mark `running`, `openLane` if the
lane has no conversation yet, then by kind:

| kind | does | done when | failed when |
| --- | --- | --- | --- |
| ask, plan | one turn (`plan` with `lookFirst: true` forced) | settled ok | error, or `!ok` from prompt |
| goal | turn; then `checks`; on fail another turn with the report, up to `retries` | checks pass | retries used, or an error |
| checks | `checks`; on fail a fix turn `Fix what failed: …`, then checks again, up to `retries` | pass | retries used |
| review | `review` | `ships`; `needs-work` with `retries > 0` sends one fix turn and reviews once more | `do-not-land`, or `needs-work` with no retry left |
| gate | nothing; run state `needs-you` | `flowContinue` | never; Stop makes it `stopped` |
| pull-request | `pullRequest` | a URL | no URL |

A failed block fails the run: blocks not started become `stopped` with
`failure: 'never ran'`. Stop calls `stop` on every running lane, marks running blocks
`stopped`, run `stopped`. Ceiling: worktree lanes count against the same cap as
background work (`capsNow().board`); a lane past the cap waits and the card says
`Waiting for room`.

Tests (`tests/flow-runner.test.ts`, fake port): a chain runs in order and the second
ask sees nothing prefixed; a fan-out in turn runs sequentially in `lane-0`; a fan-out
with worktrees opens two lanes and the fan-in block's text carries both `said`s; a gate
holds until continue; checks retry then fail; review verdicts map as the table says;
an error fails the run and stops the rest; Stop mid-turn; an interrupted run resumes
from its first unfinished block with the same lanes. One test in
`tests/close-keeps-worktree.test.ts`'s style asserts the runner never calls a worktree
removal.

### 2.5 The view (`src/components/canvas/`)

Six files, each under 400 lines, plus one stylesheet `Canvas.css` (start from
`git show 89375fa^:src/components/CanvasView.css`, cut what the removed controls
used). Lazily imported from `App.tsx` so it lands in the on-demand set;
`node scripts/perf-report.mjs --check` stays under 450 KB.

- `CanvasView.tsx`: the frame. Bar, surface, palette, panel, foot. Owns `picked`,
  `full`, the undo ring, and the held-back save.
- `CanvasSurface.tsx`: pan, zoom (0.4 to 1.6, ⌘-wheel about the cursor, `−` `Fit` `+`),
  dot grid that pans with the sheet, cards at absolute positions, one SVG of edges
  (cubic curves out of the right of a card into the left of the next, loop-back when
  the child is behind, `passed` and `live` states, a 14 px transparent grab stroke so a
  line can be picked and removed), the half-drawn join, drag to move, drag from the
  handle to join, the same gesture on a joined pair to unjoin, refusals as a toast for
  3.6 s.
- `BlockCard.tsx`: mark, name, first line of `says`, state word, live step while
  running, `Round n of m` for goal and checks, cost and time when done, model chip when
  it names one, `Watch` while running (opens the lane's conversation in the other
  pane), `Open` when done (the conversation at that turn), `Continue` on a gate. A card
  is a `button` with `aria-label="<name>, <state>"`.
- `BlockPanel.tsx`: beside the picked card. Name, What it does (textarea; for `ask` a
  `Start from` menu with the three starting sentences), Model (Default or one of the
  connected models, grouped by tier as the composer does), Thinking (only when the
  model has more than one level), Plan first, Runs after (multi-select of
  `canWaitFor`-safe blocks, `Nothing (starts the flow)`), Attachments (through the
  attachment store, the composer's own picker), Retries for checks and goal, Duplicate,
  Remove.
- `CanvasPalette.tsx`: the seven kinds with their marks and the three templates; folds
  to marks under 900 px with a floating label.
- `CanvasFoot.tsx`: while running, the step and whether it has stopped to ask, with
  `Watch` and `Answer`; when ended, `Finished`, `Stopped` or `Failed` with
  `n blocks · n turns · cost`, the last thing said, `Open the conversation`, and when
  lanes made branches a line per branch with `Review` that opens the Review queue; when
  interrupted, `Interrupted when Graphe closed` with `Resume` and `Start again`; a
  `role="status"` live region that announces state changes.

Bar: title input (renames; empty falls back to the first block's words), `n blocks`,
Undo and Redo (⌘Z, ⇧⌘Z), Tidy (when not arranged), Branches switch (`In turn` /
`In worktrees`, the panel note says what each means in one line), the flow's default
model chip (the composer's `ThinkingWith` in bare mode), how far (`Asking`), Start or
Stop or Continue, Fill window, and a Runs menu listing earlier runs by date with
their ending.

Keyboard: Esc peels model picker → half-drawn join → panel → full. Backspace removes
the picked line or block (not while running, not in a field). Arrows move the pick
along `runOrder`. Enter opens the panel. ⌘Enter starts. ⌘D duplicates.

Empty state: the three templates as large presses, and beneath them `Canvases`, the
project's other canvases with Open, Rename and Delete (Delete confirms in an
`alertdialog`).

Tests (jsdom): `tests/canvas-view.test.ts` for Esc peel order, join and unjoin by
gesture, undo after remove, the Branches switch writing `lanes`, `Watch` calling the
open-in-other-pane callback with the lane's conversation, the live region text on
`done` and `failed`. A `ResizeObserver` stub as the old test had.

### 2.6 Where it is reached, and how it sits in the app

- **Sidebar**: `Canvas` between `Review` and `Pull requests` in `Sidebar.tsx`'s
  `placesOf`, tip `Canvas`, binding named `canvas` in `src/lib/keys.ts` with no default
  chord (⌘D is free but stays unbound; the person binds it in Settings).
- **Palette**: `{ id: 'canvas', name: 'Open the canvas', where: 'Project' }` and
  `{ id: 'canvas-new', name: 'New canvas from this draft', where: 'Conversation' }`.
- **Composer row**: a `Canvas` press beside the worktree control. With a non-empty
  draft it makes a new canvas whose first block is an `ask` with the draft and the
  composer's attachments, and opens it; with an empty draft it opens the last canvas.
  This is the control the hand is already on.
- **Tabs**: `TabKind = 'chat' | 'canvas'` and `kind` on `Tab` come back in
  `src/components/Tabs.tsx`, with the glyph before the state mark. A canvas tab's
  `state` is `working` while its run is `running`, `asking` while `needs-you`. Close
  closes the view. Reorder is allowed. `goToScreen` clears the canvas for every screen
  except `helpers`, as before.
- **Second pane**: the canvas fills the pane the chat would; the split press works as
  it does for a chat, and `Watch` puts the lane's conversation in the other pane.
- **Sidebar conversations**: conversations with `lineage.kind === 'flow'` are listed
  under their canvas's name, collapsed by default, not among ordinary chats.
- **Review**: a worktree lane's branch appears in Review as any worktree's does. The
  canvas adds nothing there.
- **Trouble**: a refused Start shows `canStart`'s sentence in the foot, not a sheet.

### 2.7 Work packages for section 2

| Package | Files | Depends on | Ends with |
| --- | --- | --- | --- |
| 2A model | `src/work/canvas.ts`, `src/lib/heldwrites.ts`, `tests/canvas.test.ts`, `tests/heldwrites.test.ts` | nothing | tests green; the types in 2.2 exported |
| 2B runner | `electron/services/flow-runner.ts`, `src/projects/flows.ts`, `tests/flow-runner.test.ts`, `tests/flows.test.ts` | 2A's types (copy them from this document to start; reconcile at merge) | tests green with the fake port |
| 2C view | `src/components/canvas/*`, `Canvas.css`, `tests/canvas-view.test.ts`, a `Canvas` section in `src/gallery/Gallery.tsx` | 2A | tests green; the gallery draws an empty, a drawn, a running and an ended canvas |
| 2D integration | `src/lib/ipc.ts`, `electron/preload.ts`, `src/lib/bridge.ts` (mock runner), `electron/main.ts` (the port, the handlers, `lineage.kind`), `src/App.tsx`, `Tabs.tsx`, `Sidebar.tsx`, `Composer.tsx` (the press), `src/lib/keys.ts`, `workspace-registry.ts` (`'flow'`), `docs/handoffs/ipc-inventory.md` | 2A, 2B, 2C | `npm run typecheck && npm test`, one real-window test in `tests/electron/smoke.test.ts` with the scripted model: two ask blocks in turn, both `done`, the second turn's prompt carries no prefix and the transcript shows both; run `npm run test:electron` once |
| 2E rows | `scripts/visual-matrix.mjs` rows: canvas empty, drawn, running, ended, in both themes and at 900 px; `docs/handoffs/visual-matrix.md`; a new `docs/handoffs/phase-11-canvas.md` saying what runs where and why the window does not run flows; `FEATURES.md` item **38 · Canvas**; `STATUS.md` row | 2D | `npm run test:visual` once |

2A, 2B and 2C run in parallel. 2D is one agent. 2E is one short session.

---

## 3. Tokens: the project's own values, read-only

**What.** A `Tokens` band in the panel (the right-hand column that holds git and the
last turn's changes) for a project whose stylesheets declare custom properties in a
`:root` block. Groups Colour, Type, Spacing, Corners, Shadow; each row Name, Value (a
swatch for a colour), Used (count of `var(--name)` across the sheets read),
`file:line` with `Open in editor`. A search field. Nothing edits anything. The band is
absent, not empty, when a project has no tokens.

**And the agent gets the same reader** as a tool `read_tokens` in
`src/agent/pi/tools.ts`, returning the grouped list as text, so it reads the system
before it styles anything. Registered always; costs nothing when unused.

**Files.** Restore `src/design/tokens.ts` and `src/design/grouping.ts` and their tests
(`tests/tokens.test.ts`, `tests/styles-grouping.test.ts`) from `git show b4dcd58^:…`,
verbatim except: drop `writeToken`, `steps`, `settle`, `saysNudge` and everything that
served sliders; extend the block-selector predicate so a Tailwind 4 `@theme { … }`
block counts as a root. Shell reader `tokenSheets`/`styleTokens` (about 80 lines, the
old one from `main.ts` at `b4dcd58^` around line 3325) into
`electron/services/tokens.ts`, called by one channel `tokensRead(where)` returning
`{ tokens: StyleToken[]; sheets: number } | null`, target the workspace folder
(`folderFor(open, where)`) so a worktree reads its own sheet. Component
`src/components/Tokens.tsx` + `.css`, lazy. Delete `src/design/drift.ts`,
`src/design/usage.ts` and `tests/usage.test.ts`, which nothing uses.

**Tests.** The restored parser tests; one jsdom test for the band (groups, search,
Used, the editor press); one tool test in the style of `tests/read-a-file.test.ts`.

**Done when.** Band shows on the `paper-street` fixture (it has `tokens.css`); a
visual matrix row for it; `FEATURES.md` gets one line under item 22 rather than a new
number.

One package, no dependency on section 2.

---

## 4. The surfaces this branch added: one sweep

One agent, one session, with the mock bridge (`npm run dev:daemon`, then Playwright
against `localhost:5273`, `/?open=paper-street` for a project, `/?gallery` for
components). No model, no Electron account. Screenshots to the scratch folder; fixes
straight into the components; one commit.

Surfaces, each at 1280×800 and 900×700, light and dark: the composer row and its
controls; the Commands drawer with the terminal switch (the pane itself needs
node-pty, so check `TerminalPane.tsx` and `.css` by reading: the xterm fits its box on
resize, the font is the app's mono face, the dark theme colours are the app's, a
closed pane frees its row); the split second pane; Review; Settings including the
Storage block with the trash rows (Restore, Empty selected); Recovery; Add more with
the eight add-on states; the queue band `Queued for this workspace` and the Board;
the tab strip with a long title; the palette; the connect sheet; History's rail
without thumbnails.

What to look for: clipped or overflowing text, a button label over three words, an
empty state that says nothing, a hard-coded light colour in dark, a control without a
focus ring, a row whose spacing or type size differs from its neighbours, a missing
`aria-label` on an icon button.

Known before the sweep starts:

- `src/lib/showme.ts` still prints an `Everywhere` line from the retired
  across-project toggle. Remove it.
- `src/App.tsx` `ARRIVING` is `aria-busy` with no name; give it `role="status"` and the
  heading of the sheet it holds.
- `site/README.md` says the page has a Homebrew line; it does not (section 5 decides
  which way to fix that).

Done when: the findings are fixed or listed with a reason in
`docs/handoffs/visual-matrix.md`, and `npm run test:visual` is green once.

---

## 5. The landing page: new captures, honest copy, SEO

`site/` is static: `index.html`, `styles.css`, `main.js`, `sitemap.xml`, `robots.txt`,
`assets/web/`. Captures come from `site/scripts/shots.mjs` against the mock bridge and
are encoded by `site/scripts/optimise.mjs` (`cwebp` via `brew install webp`). Two
packages: 5A captures and copy after sections 2 and 3 land; 5B SEO now, in parallel
with everything.

### 5A. Captures and copy (after 2 and 3)

**Every window picture on the page shows retired controls** (`Add a schedule`,
`Hand it to your team`, `Design`, `Canvas`, the `This project / Everywhere` toggle).
Recapture all of them:

| Picture | Used at | Replace with |
| --- | --- | --- |
| `app-start-dark.webp` | hero Work tab, `og:image`, README hero | a new conversation in the app at 1440×900 dark, rail current |
| `app-history-dark.webp` | hero History tab, pillar 01 | History view, current rail |
| `app-skills-dark.webp` | hero Skills tab | Skills view |
| `band-start.webp` | `#away` figure | light capture from the mock bridge with the current sidebar; drive it from `?open=paper-street` |
| `crop-cost-dark.webp` | pillar 02 | keep, or re-crop from the new hero for consistency |

And add pictures of what the branch made, each with a real alt: the **canvas** running
(`Two ways` template mid-run, one card `Done`, one `Running`), the **split second pane**
with a chat beside the canvas, **Review** with one finished worktree, the **terminal**
in the Commands drawer, **Storage** with the trash rows. The hero tablist gains a
`Canvas` tab.

`shots.mjs`: drop the `design` entries from `PIECES` and `VIEWS` (both warn "no way
in"); open projects with `/?open=paper-street` instead of clicking the picker; add
shots `canvas-view`, `split-view`, `review-view`, `commands-terminal` (the drawer,
even without a pty), `storage-view`; gallery section `Canvas`. Then
`node site/scripts/optimise.mjs`, and delete from `assets/web/` and `assets/shots/`
everything `index.html` does not name (today that is `app-canvas-dark.png`,
`app-design-dark.webp`, `band-canvas.webp`, `crop-tokens-dark.webp`,
`see-it-before-you-say-yes-dark.webp`, `skin-*.webp`, `shots/crop-history-dark.png`,
about 2 MB).

Copy fixes in `index.html`:

- Version chip `1.0.0` in the nav and `This is 1.0.0` in the where band: read from one
  place; `main.js` can fill both from a constant set at release, or the release
  workflow rewrites them. Today the package is 1.0.3.
- Hero figcaption default `a plan, waiting for a yes` describes no picture; make it
  the Work tab's caption.
- The `app-start` alt promises the cost in the rail; the rail has no cost. Rewrite the
  alt to the picture.
- The `#away` mock board says `Not this time`; the app says `Not now`. Match the app.
- `#everything` gains one cell for the canvas: "Draw the steps, join them, press Start.
  Each block is a turn with the same Guard; branches can run in worktrees and land
  from Review." Adjust the `Show n more` count (the CSS hides cells from the seventh).
- The Homebrew line the README leads with (`brew tap AadiXC0DE/tap && brew install
  --cask graphe`) goes under the hero's download button once the tap is live; until
  then delete the claim from `site/README.md`.
- The claim "One press hands the same address to Chrome" is unverified: grep
  `openExternal` in `electron/`; keep or cut accordingly.
- Vocabulary per `CLAUDE.md`: `commit` where the page says "saved moment" or "restore
  point", `branch` where it says "line of work", `worktree` where it says "copy",
  `session` for "sitting". Keep "helpers" only where the app itself says it.

Also `README.md`'s hero picture and `FEATURES.md` follow the same captures and words.

### 5B. SEO and page weight (now)

Do not touch the canonical (`https://usegraphe.com/`, apex serves, www redirects at
the host), `robots.txt`, the sitemap's `loc`, or DNS verification. Do:

- `og:image` and `twitter:image` point at a 2880×1800 WebP, which several scrapers do
  not render. Point both at a 1200×630 PNG made from the new hero capture (replace the
  unused `social-preview.png`), with `og:image:width/height` and the alt.
- Meta description is 228 characters; cut to 155 or fewer. Use one title across
  `<title>`, `og:title` and `twitter:title`.
- JSON-LD `SoftwareApplication`: add `softwareVersion` (from the same constant as the
  chip), `screenshot` (the hero PNG), and make `author.name` match the footer.
- `sitemap.xml`: add `<lastmod>` and update it in the release workflow.
- Remove the duplicate `theme-color` meta and the inline SVG `rel="icon"` that shadows
  the PNG set.
- IBM Plex Mono is a render-blocking Google Fonts request for small labels; self-host
  the two weights beside Satoshi or fall back to `ui-monospace`.
- The four window shots ship at 2880 px to phones. `optimise.mjs` emits a 1440 px
  variant too and `index.html` uses `srcset`/`sizes`. Target under 700 KB on first
  view.
- Give the `promises`, `where` and `cta` bands ids so they can be linked.
- `site/server.log` is an ignored stray; delete it locally.

Done when: `node site/serve.mjs` shows the page with every picture current, an OG
checker renders the card, and Lighthouse on the served page reports no SEO items.

---

## 6. FEATURES.md and README.md

After section 2: item **38 · Canvas** in `FEATURES.md`, written like its neighbours
(what a person can do, no mechanism), and one sentence added to item 22 for the tokens
band. `README.md`'s screenshot and any sentence naming the rail's contents follow the
new captures. Nothing else on either page changed in this branch that is not already
recorded in the phase 8 handoff.

---

## 7. Order, parallelism, and the finish

```
now, in parallel:   3 (tokens)    4 (sweep)    5B (SEO)    2A  2B  2C
then:               2D (one agent, after 2A 2B 2C)
then, in parallel:  2E    5A    6
last, one agent:    checks
```

The last agent: `npm run typecheck && npm run lint && npm run copy:check && npm test`
on the merged tree, `node scripts/perf-report.mjs --check`, `npm run test:electron`
once, `npm run test:visual` once, then the packaging session from the remaining
document's 1f if it has not happened (`npm run package`, `verify:package`,
`test:packaged`, on this machine, once), then read the PR's checks once and fix what
is red. `STATUS.md` gets its final rewrite: this document's sections as done rows, the
person-only checks and the real-provider scenarios as the only open ones.

Every package ends with its handoff row, and with `npm run typecheck && npm test`
clean. Nothing else is run twice.
