# {Name} — a gentle coding agent for designers

> **Status: research phase.** Nothing is built yet. This repo currently holds the thinking.
> The name is a placeholder — "Pico" is taken by a direct competitor and a ByteDance hardware brand
> ([why](docs/research/04-positioning-and-naming.md#1-the-naming-problem--recommend-against-pico)).

A designer opens a Figma file, describes what they want, and gets a real, working, published web
page — without meeting a terminal, a git branch, or a deploy config. The code underneath is ordinary
and exportable. Free and open source, built on the [Pi agent](https://github.com/earendil-works/pi).

If Claude Code is an 8/10 in difficulty for a designer, this is aiming at 1/10 — without being a toy,
and without producing worse code.

---

## The documents

| Doc | What's in it |
|---|---|
| **[Differentiators](docs/DIFFERENTIATORS.md)** | **The ten things no other agent has, and why they can't copy them** |
| [PRD](docs/PRD.md) | Vision, users, the honest risk assessment, scope, v1 cut |
| [Features](docs/FEATURES.md) | Full catalogue by pillar, each tracing to a documented pain |
| [UI and motion](docs/UI-DESIGN.md) | Layout, visual language, motion tokens, anti-patterns |
| [Architecture](docs/ARCHITECTURE.md) | Local-first desktop app on Pi, the safety layer, what it costs to run |
| [Test plan](docs/TEST-PLAN.md) | Safety, functional, and gentleness testing with release gates |
| [Landing page](docs/LANDING-PAGE.md) | Copy and art direction |

### Research

| Doc | What it settles |
|---|---|
| [01 — Pi agent](docs/research/01-pi-agent.md) | Can we build on it, and what it refuses to give us |
| [02 — Competitive landscape](docs/research/02-competitive-landscape.md) | Who else is here and whether this is defensible |
| [03 — Designer pain points](docs/research/03-designer-pain-points.md) | Where people actually get stuck, with evidence |
| [04 — Positioning and naming](docs/research/04-positioning-and-naming.md) | How to talk about it; why the name must change |

---

## What the research settled

**The position is vacant.** Onlook coined "Cursor for Designers", reached 26k stars — and has shipped
**8 commits and zero features in 8 months**. Figma import was never built. Self-serve signup is closed.

**Credit pricing is driving designers out**, and this is our clearest opening. Real quotes: *"I spent
over $300 to fix a simple parser bug"* · *"64 AI credits to move a toast 50px"* · *"Hiring a fulltime
dev will be cheaper than using FigmaMake."* **None of the 14 tools researched offers no-markup
bring-your-own-subscription for its core agent.**

**Nobody has solved Figma import** — not Bolt (which tells you to use screenshot mode), not Figma Make
(which ignores your design tokens, confirmed by Figma's own support), not Webflow (~75% on clean
files). That makes it our best differentiator and our biggest technical risk at the same time.

### The four things that decide whether this works

1. **Safety is ours to build.** Pi has no permission system and says sandboxing is out of scope, by
   design. Our users cannot judge whether a command is dangerous. Largest engineering item, non-negotiable.
2. **Figma import has to clear a bar nobody has cleared.** Prototype it before committing to anything else.
3. **The subscription story needs verifying.** Claude Pro through a third-party harness appears to bill
   metered usage rather than draw on plan limits. If true, the cost pitch needs rewording everywhere.
4. **Gentle must not mean limited.** The moment a designer hits a wall they can't get past, they go
   back to hiring a developer. Every simplification needs an escape hatch that doesn't punish them
   for taking it.

---

## Principles

- Never put the user's lack in the subject of a sentence.
- Every destructive action is snapshotted first, and no confirmation can be globally disabled.
- The technical truth is always one click away, and never in the way.
- The project is a real repo from minute one. Nothing to migrate off, ever.
- If a simplification can't be escaped, it's a trap, not a simplification.
