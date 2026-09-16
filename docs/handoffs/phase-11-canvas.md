# Phase 11 handoff: the canvas

A canvas is a drawing of steps that becomes work when somebody presses Start.
Each block is a turn in a conversation, with the same tools and the same Guard a
person typing would get, so a canvas is a way of sending rather than a second
kind of agent. This handoff says what runs where, and why the window does not run
flows.

## The window does not run flows

The old canvas advanced on a `settled` event in the window, so closing the
window, or typing into that conversation by hand, moved or lost the flow. The
runner is a shell service now: `electron/services/flow-runner.ts` is a pure state
machine over a `RunnerPort`, and `electron/main.ts` supplies that port from what
it already has. A run has an id, it advances on the settle of the turn it sent,
and on nothing else. Closing the window changes nothing about a run.

The split of ownership is the point:

- **`src/work/canvas.ts`** is pure. No I/O, no timers, no React. The blocks, the
  lanes, what is ready to run next, what a turn is asked, how a run ended, undo
  and redo, and the three templates.
- **`electron/services/flow-runner.ts`** is the machine. It takes the flow, the
  run, and the port; it decides what runs next and in which lane. It touches
  neither Pi, files nor IPC, so it is tested with a fake port.
- **`electron/main.ts`** fills the port: a lane opens a conversation (or a
  worktree and then a conversation), a send is one turn through the ordinary
  session, checks are the project's own checks, review is what the Review press
  calls, and a pull request is one turn plus reading the url back.
- **`src/components/canvas/`** draws. It never advances anything.

## What a run does

Per tick, `readyNow` gives every block whose parents are all `done`. With
`lanes: 'in-turn'` that is at most one, in `runOrder`; with `worktrees` it is all
of them, each in its own lane.

| kind | does | done when | failed when |
| --- | --- | --- | --- |
| ask, plan | one turn (`plan` forces plan mode) | settled ok | error, or `!ok` from prompt |
| goal | turn, then checks; on fail another turn with the report, up to `retries` | checks pass | retries used, or an error |
| checks | checks; on fail a fix turn, then checks again, up to `retries` | pass | retries used |
| review | review | `ships`; `needs-work` with a retry sends one fix turn and reviews once more | `do-not-land`, or `needs-work` with no retry left |
| gate | nothing; the run is `needs-you` | `flowContinue` | never; Stop makes it `stopped` |
| pull-request | one turn, then the url | a url | no url |

A failed block fails the run: blocks not started become `stopped` with
`failure: 'never ran'`. Stop calls `stop` on every running lane, marks running
blocks `stopped`, and the run `stopped`. Worktree lanes count against the same
ceiling as background work, so a lane past the cap waits and its card says
`Waiting for room`.

## Where the state lives

`<profile>/flows/<projectId>.json`, an array of `Flow`, written atomically and
keyed by the registry's `projectId` rather than the path, so a folder that moves
keeps its canvases. A project's first read also looks for the old
path-keyed file and imports it once, then leaves it where it is.

The window edits through `flowSave`, held back 400 ms per flow. The shell
replaces the flow by id and keeps `runs` as its own: a save from the window never
overwrites them, because the runner owns them. `onFlow` pushes every run change,
so a window that was closed while a flow ran draws the true state when it opens.

Attachments are content ids in the attachment store. A flow file never holds
bytes.

## What was removed, and what did not come back

The audit in `docs/graphe-final-before-publish-2026-09-16.md` §1 is the record.
Nothing came back without a reason:

- The design screens (Inspector, Legible, Motion, Responsive, Drift) stay out.
  They reasoned about token names rather than the rendered page, and an agent
  with the browser does this on request. The token reader came back read-only
  (§3) because "what colours does this project have, and who uses `--space-4`"
  is a real question the agent had no way to answer.
- Visual evidence furniture, publish shortcuts, Figma following, variations and
  tournaments, and the duplicate orchestration verbs stay out. Each was a mode
  left switched on, or a second name for a path that already exists.

## What is not proven here

- The real-window test covers two ask blocks in turn. The worktree lane path is
  covered by the runner's own tests against a fake port; running a real fan-out
  across two worktrees in the window is not exercised end to end.
- A pull-request block needs `gh` on the machine and a branch to push. The
  refusal path is tested; the happy path is not.
