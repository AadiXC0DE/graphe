# A number to tune against

Issue #13 order says: do this first. Any fixed task set, run before and after.

This folder is the held-out task set. `tasks.json` is **pinned** — never change its ids between a before and after run. The number we tune against is `pass@1 = resolved / tasks`.

## What is in the set

20 tasks. Not 2,294 (SWE-bench) and not 500 (Verified). Those cost ~$0.75/instance and a day to run 50; this is the harness's own "day's work" set: unit tests that already describe the loop's invariants, plus three integration checks that only pass once the loop is closed.

Each task maps to a real test file we already run, so the runner can report without a new harness:

- `R-01`, `R-04`, `R-06`, `gate`, `gate-wired`, `boundary`, `guard`, `checks` — loop invariants
- `afterCall-wired`, `repair-cap`, `reviewer-one-file` — items 1–2 of #13
- `try-ways-taste`, `auto-selection` — item 3
- `gate-drift` — item 5 (the ahead bet)
- `handling`, `landing`, `history`, `cost` — safety/undo/meter that SWE-bench does not measure and that will **cost points** against a harness that just runs

## How to run

```bash
npm run eval              # before or after — same ids
npm run eval -- --before .eval/before.json
npm run eval -- --after  .eval/after.json
node scripts/eval.mjs --compare .eval/before.json .eval/after.json
```

`scripts/eval.mjs`:
- reads `eval/tasks.json` (pinned ids)
- runs `npm test` (the project's own 4,005 tests — same model, same harness commit)
- parses vitest JSON (or `npm test` stdout as fallback) into per-task pass/fail
- writes `results/<ISO>/summary.json` with `pass@1`, `cost` (from `src/cost/` if available), `api_calls`, `duration`
- prints a table: before vs after delta, per-task, and scaffold-normalized card (guard-gated vs ungated)

## Locking

Same model (`@earendil-works/pi-coding-agent ^0.84.1`), same harness commit, same `eval/tasks.json`, same `EVAL.md` prompt, same turn limit. Report both: raw SEAL-equivalent (no `run_checks`) vs wrapped (with `run_checks` + proposed repair). Otherwise apples-to-oranges per Zhang et al. §3.1.

## Why 20

SEAL's split is 731 tasks; our local set is 20 so a full before/after is **minutes not hours** and runs on a laptop with no Docker. Harness-Bench's 106 sandboxed tasks (`harness-bench.ai`) is the next step when you want an offline, oracle-graded 22-task `Codebase Work` subset. SWE-bench Verified Mini (50 of 500) is the third step when you pay for model calls.

## What the number is not

SWE-bench measures none of what we are ahead on — the 140 guard verdict sites, the restore point that blocks when it cannot be taken, the visual gate. Those will depress this number vs a harness that just runs. Track a second number if you want: `pass@1` gated vs ungated. Being better on SWE-bench and being better for the people who use this can point opposite — know which one a change buys.
