<div align="center">

# Graphe

**The coding agent that starts from your design.**

Give it a Figma file, a screenshot, or a sentence. It works through a real project, writes real
code, and keeps the design conversation clear from first idea to review.

Free · open source · runs on the AI subscription you already have

</div>

---

> **Status: early and moving quickly.** Graphe is now a capable local agent with visual review,
> project history, cost tracking, designer-friendly controls, a file rail, reusable skills and a
> one-button preview. More is on the way. Build it from source if you want to try it.

---

## Why this exists

Designers have started shipping code, and the tools they've been handed come in two shapes.

**Prompt-to-app builders** get you something visible in minutes, then trap it. Figma Make's zip export
omits `package.json` and won't run. Lovable has no clean local export. You reach for a real domain, a
real database, or a developer, and discover the thing you built doesn't travel.

**Coding agents** produce genuinely good code and hand you a real repo — then assume a terminal, git
literacy, and the judgment to review a diff. A non-coder's first day with Cursor starts with three
infrastructure accounts.

Graphe is the third shape: **a real repo, without the machinery.**

---

## What makes it different

**You can always go back.** Every version is kept, with a thumbnail and a plain title. Hover to look,
click to return — including the change you made an hour ago and regret now. Snapshots happen before
anything destructive, automatically, and going back is itself undoable.

**You see what changed, as a picture.** A before and after of the page itself, plus a sentence
describing what moved. Not a wall of code — though the code, project files and the underlying
folder are within reach whenever you want them.

**It tells you what things cost, in money.** No tokens, no context windows, no model names. An estimate
before a large job, a running total, and a limit you set. At the end of a session it tells you what you
spent on real work and what you spent on *its own* retries — a number no metered competitor will ever
show you.

**Dangerous things are structurally hard.** Every action the agent takes is checked before it runs.
Nothing outside your project folder, ever. Destructive operations snapshot first. There is no "accept
everything" mode to switch on, because that switch is the first thing people flip and the last thing
they should.

**It speaks design.** Leading, tracking, optical alignment, your 8pt grid. Changes come back described
the same way: "moved the button 8px down, used your brand blue, added a gentle hover." Screenshots,
Figma links and marked-up references can all travel with the conversation.

**Nothing is trapped.** Your project is an ordinary folder with ordinary git from the first second.
Open it in VS Code tomorrow. Hand it to a developer. There is nothing to export because nothing was
ever locked in.

**It grows with your practice.** Use built-in starting points, bring in skills with `@`, and tune how
much the agent checks before it acts — all from the same place you write.

---

## Built on Pi

The agent runtime is [**Pi**](https://github.com/earendil-works/pi) by Mario Zechner — an excellent,
genuinely open agent harness. Graphe is the designer-facing layer on top: the safety policy, the
visual review, the version timeline, the cost engine, and the interface.

**Graphe is not a fork.** It depends on Pi as a published package, so Pi's improvements arrive by
upgrading rather than by merging, and nothing here fragments their project. If you want the
terminal-native, developer-facing version of this idea, use Pi directly — it is very good.

Licences and attribution: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Graphe is not affiliated
with or endorsed by the Pi project.

---

## Running it from source

```bash
git clone https://github.com/AadiXC0DE/graphe
cd graphe
npm install
npm run dev          # the interface, at localhost:5273
npm run dev -- --open '/?gallery'   # every component, both themes
```

```bash
npm test             # 375 tests
npm run typecheck
npm run shot <name>  # screenshot the running UI in both themes
```

---

## How it's built

| | |
|---|---|
| **Local-first** | Runs on your machine. No account, no server, no telemetry. Your code never leaves your disk |
| **Bring your own model** | Connect Claude, ChatGPT or Copilot. Nothing is metered by us, because there is no us in the middle |
| **Real git underneath** | Version history is ordinary commits with readable messages. The word "commit" never appears in the interface |
| **Guarded execution** | Choose how much the agent can do for this sitting, from looking only to full access |
| **Design-aware work** | Bring screenshots, Figma links, annotations and visual review into the same conversation |
| **Skills and starting points** | Reuse good ways of working without turning the interface into a terminal |

```
src/
├── agent/      the agent runtime and the safety guard
├── cost/       spend tracking, estimates, limits
├── history/    version timeline over real git
├── components/ the interface
└── styles/     design tokens
```

Safety notes and how to report a vulnerability: [SECURITY.md](SECURITY.md).
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md).

---

## Principles

These are load-bearing, not decoration. Pull requests are measured against them.

- **Never put the user's lack in the subject of a sentence.** Not "you don't need to know git." The
  subject is their design and their judgment; the machinery is the object being handled.
- **Every destructive action snapshots first,** and no confirmation can be globally switched off.
- **The technical truth is always one click away, and never in the way.**
- **A real repo from minute one.** Nothing to migrate off, ever.
- **If a simplification can't be escaped, it's a trap, not a simplification.**
- **Gentle is not the same as limited.**

---

<div align="center">
<sub>MIT licensed. Built by <a href="https://heyaadi.com">Aaditya Chowdhury</a>.</sub>
</div>
