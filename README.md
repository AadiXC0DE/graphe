<div align="center">

# Graphe

**Send in a team, not a prompt.**

An agentic coding platform for the desktop. Helpers in parallel, jobs that run for hours
without you, and a design system it reads before it writes. Built on [pi](https://github.com/earendil-works/pi) —
your keys, any model, the meter in plain sight.

<p align="center">
  <a href="https://github.com/AadiXC0DE/graphe/actions"><img src="https://img.shields.io/github/actions/workflow/status/AadiXC0DE/graphe/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="https://github.com/AadiXC0DE/graphe/releases"><img src="https://img.shields.io/github/v/release/AadiXC0DE/graphe?label=release" alt="Release"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/AadiXC0DE/graphe" alt="MIT"></a>
  <img src="https://img.shields.io/badge/macOS-Apple%20Silicon%20%26%20Intel-lightgrey" alt="macOS">
  <img src="https://img.shields.io/badge/built%20on-pi-1a1410" alt="Built on pi">
</p>

<p align="center">
  <a href="https://usegraphe.com"><b>usegraphe.com</b></a> &nbsp;·&nbsp;
  <a href="https://usegraphe.com#see">See it work</a> &nbsp;·&nbsp;
  <a href="https://github.com/AadiXC0DE/graphe/releases">Releases</a> &nbsp;·&nbsp;
  <a href="https://github.com/AadiXC0DE/graphe/discussions">Discussions</a>
</p>

<br>

<img src="site/assets/web/app-start-dark.webp" width="100%" alt="The Graphe window: the project's files on the left, things to start from in the middle, and a rail on the right holding what is waiting to be saved, what is running in the background, what is on a schedule, and the handover.">

</div>

---

## Install

**macOS** — Apple silicon and Intel. Either route works:

```sh
brew tap AadiXC0DE/tap
brew install --cask graphe
```

or download the disk image from the [latest release](https://github.com/AadiXC0DE/graphe/releases).

> Graphe is ad-hoc signed but not notarized yet, so on first launch macOS may ask you to allow
> it — "Open Anyway" in System Settings → Privacy & Security, or right-click the app in Finder
> and choose Open. See [RELEASING.md](RELEASING.md) for how it is signed.

---

## What it is

A full coding agent with a real workspace around it — not a chat box with tools bolted on.

[**pi**](https://github.com/earendil-works/pi) is a serious coding harness that deliberately ships
without sub-agents or plan mode. Graphe is what it becomes with both, plus the window, the guard,
the version history, the design panel, the memory, the money, and the handover.

One request can become a **board of pieces** — each in its own copy of the project, four running
at once, the rest waiting, whether or not you're watching. Reviewer, researcher, and a builder
that writes inside a copy of its own. Set a job going and close the window: it carries on, and you
come back to a board of what finished, what's waiting, and what it cost.

---

## What it does

| | |
|---|---|
| **Works in parallel, and keeps working** | Helpers run side by side, each in its own context; jobs outlast your attention |
| **One request, many pieces** | The plan puts the list on the board; each piece gets its own copy and its own agent |
| **A helper that builds** | A fourth kind that writes, in a copy of the project it can only reach inside |
| **Try it two or three ways** | Goes at the same thing finish side by side, with what each cost — keep one, throw the rest away |
| **Reads your design system first** | Colours, spacing and type read as a spec before a file is touched; Figma frames come in as pictures |
| **Every width, checked** | Phone, tablet, desktop and wide — photographed, so you never decide from one size |
| **A review with a verdict** | Ships, needs work, or do not land — findings ranked, with file and line, and one press posts them to the pull request |
| **The bill, before it lands** | An estimate before a big job, a running total, a ceiling that ends it — in your currency, not tokens |
| **Memory between sittings** | Facts kept per project on your machine, ranked by meaning, loaded at the next start |
| **A browser, beside the conversation** | The running project lives in the window next to the agent building it — servers that stay up, comments on the page like a design |
| **A real debugger** | Attaches lldb, dlv or debugpy to a stuck program; reads frames, steps, evaluates |
| **Skills off the shelf** | `@skill` brings in craft you installed; `/command` expands a prompt you wrote |
| **Money, in your currency** | Every turn accounted for, and a split that separates your work from our own retries |
| **How far a change reaches** | It names the files a change would touch, and what it would take, before it makes it |

Every one of these is in the window the moment you open a folder — nothing to install, nothing
behind a tier.

---

## How a sitting goes

1. **Point it at a project.** Open a folder and it is one — recent ones sit on a shelf with what each cost last time.
2. **Say what you want, however you have it.** Type it, paste a screenshot, drop in a Figma frame. There is no syntax to learn.
3. **Big jobs come back as a plan.** A numbered plan, an estimate, and a wait for "Go ahead". Small jobs just get done.
4. **It works where you can see it.** The file tree marks what changed; the rail names what it's doing right now.
5. **You look, then you decide.** Before and after, at phone, desktop and wide. Let it in, or set it aside — setting aside keeps the work reachable.
6. **Hand it to your team.** A write-up with the pictures in it, a properly named line of work, and a request ready for whoever reviews.

<div align="center">

<img src="site/assets/web/app-design-dark.webp" width="49%" alt="The design view, reading the project's own tokens.css: every colour named with its value beside it.">
<img src="site/assets/web/app-history-dark.webp" width="49%" alt="The history view: every saved moment drawn as lines, with short ids, parents and the names on each.">

</div>

---

## Built on pi

The agent runtime is [**pi**](https://github.com/earendil-works/pi) — an excellent, genuinely open
agent harness. Graphe is the layer around it: sub-agents and plan mode, plus the window, the guard,
the version history, the design panel, the memory, the money, and the handover. One module owns
every pi import, so an upgrade breaks one file rather than fifty.

**Graphe is not a fork.** It depends on pi as a published package, so pi's improvements arrive by
upgrading rather than by merging. If you want the terminal-native, developer-facing version of this
idea, use pi directly — it is very good.

Licences and attribution: [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md). Graphe is not
affiliated with or endorsed by the pi project.

---

## From source

```bash
git clone https://github.com/AadiXC0DE/graphe
cd graphe
npm install
npm run dev          # the interface, at localhost:5273
```

```bash
npm test             # 3,252 tests
npm run typecheck
npm run package      # build the release: dmg + zip, arm64 and x64 (see RELEASING.md)
```

---

## How it's built

| | |
|---|---|
| **Local-first** | Runs on your machine. No account, no server, no telemetry. Your code never leaves your disk |
| **Bring your own model** | Connect Claude, ChatGPT or Copilot. Nothing is metered by us, because there is no us in the middle |
| **Real git underneath** | Version history is ordinary commits with readable messages. The word "commit" never appears in the interface |
| **Guarded execution** | Every action checked before it runs; nothing outside your project folder, ever |
| **Design-aware work** | Screenshots, Figma links, annotations and visual review in the same conversation |
| **Skills and starting points** | Reuse good ways of working without turning the interface into a terminal |

```
src/
├── agent/       the agent runtime and the safety guard
├── components/  the interface
├── cost/        spend tracking, estimates, limits
├── design/      reading a design system as a spec
├── history/     the version timeline over real git
├── projects/    shelves and recent work
├── shell/       conversations and their checkouts
└── styles/      design tokens
```

Safety notes and how to report a vulnerability: [SECURITY.md](SECURITY.md).
Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). Releasing: [RELEASING.md](RELEASING.md).

---

## Principles

These are load-bearing, not decoration. Pull requests are measured against them.

- **Never put the user's lack in the subject of a sentence.** The subject is their design and their
  judgment; the machinery is the object being handled.
- **Every destructive action snapshots first,** and no confirmation can be globally switched off.
- **The technical truth is always one click away, and never in the way.**
- **A real repo from minute one.** Nothing to migrate off, ever.
- **If a simplification can't be escaped, it's a trap, not a simplification.**
- **Gentle is not the same as limited.**

---

<div align="center">
<sub>MIT licensed. Built by <a href="https://heyaadi.com">Aaditya Chowdhury</a>.</sub>
</div>
