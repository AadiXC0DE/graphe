# Phase 9 handoff: responsiveness, resource use, and recovery

Findings: P01 measured (not fixed), P02 fixed, P03 open, P04 open, P05 open,
P06 open, A05 done (phase 1), E11 open.

## Measured, on this machine

Fresh build (`npx vite build`, then `node scripts/perf-report.mjs --check`):

- main chunk **691.3 KB raw, 222.7 KB gzip** against the script's 450 KB limit.
- launch set 880.6 KB across two chunks; on-demand 4807.8 KB across 99 chunks.
- Build time 6.4 s. Node 22.21.1, macOS 15.6 (Darwin 24.6.0), arm64.

The audit's 687.9 KB from the shipped `dist` was close to this, so this is the
real number rather than a stale artifact.

**Where the weight is.** The main chunk is 97.4% the application's own source by
source bytes (175 files, 2.15 MB of TypeScript): `App.tsx` 289 KB,
`lib/bridge.ts` 105 KB, `lib/ipc.ts` 102 KB, `preview/point.ts` 53 KB,
`components/Overview.tsx` 42 KB, `work/canvas.ts` 39 KB, `motion/read.ts` 38 KB,
and roughly 100 KB across `design/*`. Only two dependencies are in it at all
(`marked` 42 KB, `use-stick-to-bottom` 16 KB); everything heavy is already a lazy
chunk. So the fix is not removing a library, it is splitting the shell, and the
largest removable pieces are exactly the design and preview modules that phase
8's retirement table removes.

**Recorded as an assessed exception**, not as a raised limit: the gate still says
450 KB, the check is still not wired into CI, and this measurement is the reason.
Wiring a failing gate into CI would block every change on work that belongs to
phase 8; raising the limit would be the thing the plan explicitly forbids.

## Done

**P02, idle prefetch.** `warmViews()` imported all sixteen lazy views at idle and
cached the rejected promise, so a transient chunk failure became permanent and an
unhandled rejection. It now fetches the four a sitting reaches first, catches so
a later press can retry, and the press path fetches the whole set
(`fetchAllViews`) when it needs something not yet here.

## Not done

| Item | Note |
| --- | --- |
| P01, the main chunk | Measured and attributed; fixing it needs the phase 8 split |
| P03, sequential extension probes | Untouched |
| P04, transcript main view | Still tail-limited rather than virtualised |
| P05, `useWindowed` height indexing | Untouched |
| P06, budgets for polling, scans, timers | Untouched; no scenario fixtures were built |
| 9.1's scenario matrix, RSS/CPU/latency measurements, and the p50/p95 method | Not run: it needs the packaged app and a disposable profile |
| 9.4/9.5 operational checks | Untouched |
| 9.6 clean-machine packaged smoke | Not run |

Exit criteria: not met. One measurement was taken honestly, its dominant cost was
identified, and one unbounded idle behaviour was fixed.
