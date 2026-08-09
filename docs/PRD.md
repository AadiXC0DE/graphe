# PRD — Graphe

Draft 1, 2026-08-09. Research phase; nothing built.

---

## 1. What it is

A desktop app that lets a designer turn a Figma file, a sketch, or a sentence into a real, working,
published website — without encountering a terminal, git, or deploy configuration. The code it
produces is ordinary, exportable, and good enough that a senior developer would accept the pull
request. Free and open source, built on [Pi](https://github.com/earendil-works/pi).

**The one-line test:** if Claude Code is 8/10 difficulty for a designer, this is 1/10, and the output
is not worse.

## 2. Who it's for

**Primary — the designer who has started pushing code.** Fluent in Figma, has opinions about type and
spacing, has maybe cloned a repo once. Currently blocked not by taste or logic but by the machinery:
branches, environment variables, why the build failed. They don't want to become a developer. They
want the thing they designed to exist.

**Secondary — the design team at a studio.** Same person, multiplied, plus a developer who inherits
the work and needs it to be real code.

**Explicitly not for:** developers who want a faster Claude Code, or non-designers who want an app
built from a prompt. The second group is Lovable's, and chasing them costs us the first.

## 3. Is this a good idea? An honest read

**Yes, but the moat as originally stated is the weakest part of the plan.**

"Simpler than Claude Code" is not defensible on its own. Simplicity is a design achievement, and
design achievements get copied — by teams with more people and better distribution. Anthropic could
ship a friendly GUI. Figma Make already owns the Figma-native entry point by fiat.

The defensible combination is narrower and more specific:

| Claimed moat | Honest assessment |
|---|---|
| "Free, BYO subscription, no credits" | **Strongest, and it costs us nothing.** The [research](research/02-competitive-landscape.md) §3 found designers actively leaving v0, Bolt and Figma Make over credit burn — *"I spent over $300 to fix a simple parser bug"*, *"64 credits to move a toast 50px"*, *"hiring a fulltime dev will be cheaper."* **None of the 14 tools researched offers no-markup BYO for its core agent.** Structurally uncopyable by anyone VC-funded |
| "Safety designed for people who can't judge risk" | **Strong and unclaimed.** Replit's wipe, Lovable's inverted auth, the 11% credential exposure — all competitors failing this. Their incentives run the other way: credits are consumed by iteration, and rails slow iteration down |
| "Starts from a real Figma file with real tokens" | **Highest value, lowest confidence.** Nobody has solved it — Bolt tells you to use screenshot mode, Figma Make ignores your tokens (confirmed by Figma's own support), Webflow gets ~75% on clean files. If we crack it we're alone; the odds are against us. **Prototype first** |
| "Real repo that actually runs" | **Medium-high.** Figma Make's zip export omits `package.json` and doesn't run; Lovable has no clean local export. Neutral against Cursor and v0 |
| "Simpler for designers" | **Weak alone.** Copyable. Necessary, not sufficient |
| "Gentle, non-condescending voice" | **Weak alone, essential in combination.** It's what makes people stay |

**The real moat: free BYO economics + safety by construction + design-native input + real code out.**
No single one is enough. Two of the four cost a funded competitor money and return none, which is what
makes the combination hold.

**The position is genuinely vacant.** Onlook coined "Cursor for Designers", reached 26k stars, and has
shipped **8 commits and zero features in 8 months**, with Figma import never built and self-serve
signup closed. Nobody currently occupies this space.

### The competitor that should worry us

**Claude Design** (Anthropic, April 2026) — bundled into Claude Pro/Max, explicitly for *"founders,
PMs, marketers… no coding background"*, handing off into Claude Code. It is the closest thing to our
concept, from the company whose models we'd run on.

Its gap is exactly our product: it does not abstract git, deployment, or databases — the handoff still
lands the user in Claude Code. But it is a gap Anthropic can close whenever they choose, and they have
distribution we will never have. We should assume a two-year window, not a permanent one, and win on
the two things they structurally won't do: **run locally on the user's own machine, and hand over a
real repo the user owns.**

### What would make me abandon this

Stated up front so we notice if it happens:

1. **Figma import doesn't clear the quality bar.** If tokens and auto layout don't survive the trip,
   we are just another prompt-to-app tool. Note that Figma, Vercel, Webflow and Anima have all thrown
   real resources at this and landed at "conditional" — Webflow's ~75% on clean files is the state of
   the art. **Prototype this first, before anything else.** If a week's spike can't beat 75% on a
   messy real-world file, the differentiator is in question and we need to know in week one.
2. **The sandbox requires Docker Desktop.** If the first run asks a designer to install Docker, we
   have reproduced the problem we exist to solve. Needs an answer before we build.
3. **Consumer subscription ToS forbids third-party harness use.** Kills the free-to-run premise.
   Verifiable now, cheaply, and it should be verified now.
4. **Pi churn exceeds our capacity.** Three breaking SDK changes in six weeks against a volunteer
   maintainer budget is a real risk.

### The thing nobody plans for

**Free and open source removes the business model but not the work.** The research points at a large
product: a safety layer, a Figma pipeline, a version timeline, a publish flow, a visual diff engine.
That is a serious multi-year effort. Open source doesn't make it smaller — it makes it unfunded.

**Onlook is the cautionary case, and it is a close one.** YC-backed, 26k stars, four people, a strong
position — and development collapsed from ~150 commits/month to near-zero in a single month, with the
headline feature never built. Continue.dev, the cleanest BYO-subscription precedent, was acquired and
shut down in June 2026. Both suggest the binding constraint is maintainer capacity, not demand.

The honest options are (a) keep v1 ruthlessly small and let it be genuinely good at one path, or
(b) find sponsorship before scope grows. **This PRD assumes (a)** — and the v1 cut below should be
read as the thing that keeps this project alive, not as a limitation to grow out of quickly.

## 4. Principles

1. Never put the user's lack in the subject of a sentence.
2. Every destructive action is snapshotted first. No confirmation can be globally disabled.
3. The technical truth is always one click away and never in the way.
4. Real repo from minute one. Nothing to migrate off.
5. If a simplification can't be escaped, it's a trap.
6. Gentle is not the same as limited.

## 5. Scope

### v1 — the one path, done properly

Everything else is deferred. The single journey:

> Open the app → connect an AI subscription → paste a Figma link → see a real page → change it in
> plain language → see every change as a picture → undo freely → publish to a live URL.

**In:** Figma import with real tokens and auto layout · conversation + live preview · visual diffs ·
version timeline with restore · the Guard and execution boundary · named secrets form · plain-language
errors · one-button publish via their Vercel/Netlify account · cost meter with hard stop · export to a
clean repo.

**Out of v1** (not out forever): variants and branching · Figma re-sync · click-to-select in preview ·
custom domains · databases and auth · Show me mode · multiplayer · Windows and Linux builds ·
mobile output.

> **Databases are deliberately out of v1.** The research shows this is where non-developers get hurt
> worst and permanently. We ship it when the safety model is proven on lower-stakes ground, not before.

### Success criteria for v1

| Measure | Target |
|---|---|
| Designer with no coding experience → published URL, unaided | ≥80%, median under 30 minutes |
| Blind panel: our output vs Claude Code on the same brief | Not visibly worse |
| Senior developer would accept the generated PR | ≥80% |
| Tier 1 safety cases | 100% pass, always |
| Users who can explain what the tool did | ≥80% |
| Reports of feeling patronised | Zero |

## 6. Open questions — blocking

| # | Question | Why it blocks | How to answer |
|---|---|---|---|
| Q1 | Does Figma auto layout survive as proper flexbox with real tokens? | It *is* the differentiator | Build a throwaway prototype. **Do this first** |
| Q2 | Can we sandbox without Docker Desktop? | Docker on first run defeats the premise | Evaluate macOS `sandbox-exec`, bundled micro-VM, Gondolin |
| Q3 | Do Anthropic/OpenAI/GitHub consumer terms permit this? | Kills the cost model if not | Read the terms; ask the vendors |
| Q4 | Does Claude Pro via Pi really bill metered extra usage? | Changes onboarding and the landing page | Test with a real account, measure |
| Q5 | Does `SYSTEM.md` replace or append to the base prompt? | Determines how much we control the persona | Read the source |
| Q6 | What is the name? | Blocks the repo, domain, and any public writing | Trademark + domain pass on the shortlist |

## 7. Sequence

**Phase 0 — de-risk (before committing).** Q1 prototype, Q2 spike, Q3/Q4 answered, name chosen.
Any of these failing changes the plan, so none of them should be discovered late.

**Phase 1 — the spine.** Electron shell + adapter layer + Pi. Conversation, preview, and the Guard.
Nothing pretty yet; prove an agent can work safely inside a boundary.

**Phase 2 — the designer surface.** Figma import, visual diffs, version timeline. This is where it
becomes the product rather than a nicer terminal.

**Phase 3 — shipping.** Publish flow, secrets, error translation, cost meter.

**Phase 4 — the gauntlet.** Full test plan, real designers, language audit. Fix what they trip on.

## 8. Reference

- [Features](FEATURES.md) — full catalogue
- [Architecture](ARCHITECTURE.md) — decisions and risks
- [Test plan](TEST-PLAN.md) — including the safety cases that block release
- [Landing page](LANDING-PAGE.md) — copy and art direction
- Research: [Pi](research/01-pi-agent.md) · [Competitors](research/02-competitive-landscape.md) ·
  [Pain points](research/03-designer-pain-points.md) · [Positioning](research/04-positioning-and-naming.md)
