# Graphe

**The coding agent that speaks design, and shows its work.**

pi is a terminal agent. Graphe is what it becomes with a real interface: projects on a shelf, conversations that run at once, every change photographed, and a safety engine that asks in plain words before anything risky. Built on pi — the layer above is all Graphe's.

---

## What it does

**01 · A whole GUI on pi**
pi in a real window: projects on a shelf, tabs that run at the same time, a history rail, a design panel, two themes — and the model and the money where you can see them.

**02 · Version history, photographed**
Every change is versioned the moment it happens, with a before-and-after picture. Going back is one press — and going back is itself undoable.

**03 · Design tokens, read as a spec**
Colours, sizes and type, read before a single file is touched — so the work lands inside the design system, not on top of it.

**04 · Plan mode**
Big requests get a numbered plan and wait for "Do it" before anything changes.

**05 · Subagents in parallel**
Send three helpers in one reply and they all work at once — separate processes, read-only, each with its own role (reviewer, researcher, helper) — under a ceiling that budgets the sitting.

**06 · Code review with a verdict**
One press reviews the change — uncommitted, a saved version, or a branch — with parallel reviewers. The verdict is a card: *ships, needs work, or do not land*, findings ranked P0–P3 with file, line and confidence.

**07 · Memory between sittings**
`retain`, `recall`, `reflect`, `memory_edit`, `forget` — facts live in a per-project store on your machine, ranked by meaning then freshness, and loaded at the start of the next sitting.

**08 · A real debugger**
Attach lldb, dlv or debugpy to a stuck program: read the frames, step, evaluate, let it run. Permission asked first; a stack dump when attach isn't possible.

**09 · Papers & PDFs, read as files**
An arxiv address comes back as words — title, authors, abstract, then the body page by page. Search walks a fallback chain and names the source that failed.

**10 · Mermaid diagrams in the chat**
````mermaid```` fences become pictures in your palette — or stay code when they can't.

**11 · Anchored edits (hashline)**
A read carries a content fingerprint; an edit names lines plus that fingerprint instead of retyping the old text. A file that changed underneath is refused before anything is written.

**12 · MCP: bring your own tools**
Your MCP servers plug in through one file: tools start on first use, stop with the session, and every call asks first.

**13 · Parallel conversations**
Every tab works in its own checkout, and the work comes home when it's done. Two conversations running at once is the point, not a queue. A checkout nobody is in is given back and made again from its branch when you open that conversation again, so parallel work doesn't accumulate on disk.

**14 · Background work**
Send a piece of work away, come back to a board: what finished, what didn't, what's waiting on you — each with a picture.

**15 · PRD to shipped change**
A document becomes a build plan with acceptance and a tracked checklist — and "get on with it" runs the whole thing without stopping to ask.

**16 · Git, done properly**
The lines of work with real names: current branch marked, each showing its relation to the shared copy (*ahead, behind, in step, not shared yet*), one click to switch, new lines with conventional names — and commits and PR titles that match.

**17 · History graph**
The whole timeline drawn as lines: short ids, parents, branches.

**18 · Visual diffs**
Design variations side by side, photographed before they land — you never decide blind.

**19 · Design drift, caught**
The panel shows what drifted from your own system, and says it out loud.

**20 · Figma integration**
Frames as pictures, variables as tokens — and drift detection that keeps the project *in step*.

**21 · Hand off to your team**
A write-up with before-and-after pictures, a conventional branch and a PR title ready — or a page of what changed for someone who isn't a developer at all.

**22 · Usage & cost tracking**
Every turn accounted for in your currency, an estimate before big jobs, and an end-of-sitting split that shows what the work cost and what our own retries cost.

**23 · A guard that asks first**
Every tool call judged by a deny-by-default policy engine: plain-language confirmations, credentials that never leave the machine, a snapshot before anything destructive. Tested against prompt injection.

**24 · Steer or queue, mid-run**
A second thought during a run is a choice, asked quietly: queue it behind the turn, or steer it into the turn. Never a raw error.

**25 · Conversation management**
Name a tab, mark a moment, fork a direction.

**26 · Project file tree**
The folder as a tree you can walk, changed files marked, open anything in the editor where you already work.

**27 · Skills & workflows**
`@skill` pulls craft you installed off the shelf; `/command` files are prompts that expand. The agent's capabilities are a shelf you can add to.

**28 · A browser it can actually drive**
Any address, not just your own site: open it, read it, press things, type into them, take its picture. On from the first turn — nothing to connect and nothing to switch on — and the first page it opens fetches what it needs on its own. Getting it to a site asks once; pressing and typing ask too.

**29 · Working the computer itself**
For the tools that aren't websites. A picture of the screen, then press, type, drag and scroll on it — the same moves you would make. The two permissions are the ones every other agent asks for, and until they are given it says so and opens the right setting rather than failing quietly.

**30 · Show me the real commands**
The commands, paths and git operations under every plain sentence — for the developer who wants the wheel.

---

## Under the hood

- **Agent core:** pi (`@earendil-works/pi-coding-agent`). Graphe is the layer above it — safety, visual review, version history, money, memory, and the interface — and one module owns every Pi import, so upgrades break one file, not fifty.
- **Storage:** every project is a real git repository. The user never has to know; the developer never has to dig.
- **Memory:** SQLite (wasm, no native modules) + local embeddings (transformers.js, wasm, offline) with word-match fallback.
- **Debugger:** a small client for the standard Debug Adapter Protocol — lldb-dap, dlv dap and debugpy speak it natively.
- **Connected tools:** the official MCP SDK, stdio servers, started lazily, killed with the session.
- **Safety:** a pure, synchronous policy engine — no disk, no clock, the same call always gives the same answer, which is what makes it testable against adversarial input.
- **Quality:** typecheck, lint, the full test suite (on macOS, where the sandbox tests live) and both bundles run on every pull request. Over three thousand tests.
