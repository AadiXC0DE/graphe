# Research: Where designers actually get stuck

Researched 2026-08-09. Evidence gathered from Hacker News, Reddit, GitLab issue tracker, Figma
community forum, engineering blogs, and incident coverage.

**The structural insight:** every pain point below is implementation vocabulary leaking into a
surface a design tool would have abstracted away. Git leaks its graph model, npm leaks version
resolution, Supabase leaks SQL and row-level security, and agents leak raw tool calls and stack
traces — onto users whose only reference points are direct manipulation, autosave, and one-click
publish.

The highest-leverage move is **not to simplify git, npm, SQL, or stack traces.** It is to build a
layer where none of those words are ever the primary interface.

---

## Priority ranking

| # | Pain point | Severity | Why it ranks here |
|---|---|---|---|
| 1 | Agent over-trust — "Accept All", no diff review | 🔴 | Root cause of most other failures; compounds silently |
| 2 | Irreversible loss — no rollback | 🔴 | Total project loss, repeatedly, with no recovery path |
| 3 | Database/auth exposure (RLS off, keys in frontend) | 🔴 | Invisible until breached; user cannot self-check |
| 4 | Deployment env-var drift | 🟡 | Most common reason a shipped app is instantly broken |
| 5 | Git mental model | 🟡 | Blocks safe experimentation; nearby Figma metaphor exists |
| 6 | Terminal fear | 🟡 | Emotional blocker more than technical one |
| 7 | Stack traces | 🟢 | Painful, but known UX patterns already solve it |

---

## 1. Git

**What breaks:** Git is a directed graph of snapshots with parallel timelines requiring manual
reconciliation. Figma is a *linear* timeline with named checkpoints and hover-to-preview restore.
Figma resolves concurrent edits invisibly via CRDTs; git makes the user perform that reconciliation.

**Evidence:**
- Designers "frequently leave the test server in a detached head state," and when it happens "a Git
  expert is needed to clean things up." One developer lost commits made in detached HEAD and needed
  `reflog` to recover. ([HN](https://news.ycombinator.com/item?id=9066376))
- GitLab has open issues acknowledging conflict resolution is unsolved for **non-developers** —
  "contributors to documentation, handbook, CI/CD, and translations."
  ([#329842](https://gitlab.com/gitlab-org/gitlab/-/issues/329842))
- Figma's community has requested ["Git Like versioning"](https://forum.figma.com/suggest-a-feature-11/git-like-versioning-27857)
  for years. The workaround culture: designers duplicate files or pages as manual "branches."
- [vibe-git](https://news.ycombinator.com/item?id=44365112) hit the HN front page purely for hiding
  git behind natural language — auto-commit every second so "you never lose work if/when the agent
  goes rogue." That this had to exist is the evidence.

**Three concepts that land at once:** a local copy that can diverge from a shared one; commits as a
manual opt-in save (vs. autosave); checking out a non-newest state, which orphans work.

**Gentler design:** never surface commit/branch/merge/push/detached HEAD in the primary UI. Autosave
like Figma. Snapshot automatically at meaningful boundaries (agent turn completes, preview builds).
Replace branch/merge with a **linear version timeline** with thumbnails and one-click restore. When
work must diverge, call it **"Try a variant"** — Figma's own word — and show a side-by-side visual
diff. Auto-resolve non-overlapping changes; only ask when the same element was touched twice, framed
as "keep A / keep B / keep both."

---

## 2. Terminal

**What breaks:** a modeless, silent command dispatcher with no menu of what's possible, where errors
are the only feedback channel. Every tool a designer trusts is the opposite.

**Evidence:**
- "The ominous black screen where engineers pitter-patter unintelligible alpha numeric globs of code
  like witches brewing a stew" — scares off "~99% of non-engineer technology professionals."
  ([Technically](https://technically.dev/posts/whos-afraid-of-the-cli))
- "The fact that the CLI never proactively engages the user into interaction makes up about 50% of
  the total intimidation factor"; the other half is the "know your shit" part — you must already know
  the vocabulary. Standard advice ("type `man [command]`") is "only slightly worse than getting no
  advice at all." ([The Fear of the Terminal](https://whatblog.ghost.io/the-fear-of-the-terminal/))
- Failure surface: `command not found`, PATH/permission errors, Node version mismatches, `npm` vs
  `npx` — a distinction with zero visual cue.

**Key nuance:** actual harm is rare. The *belief* that harm is one keystroke away is the blocker. It
is a confidence problem, not a safety problem — which means the fix is visible state and reversibility,
not more warnings.

**Gentler design:** never require typing a command. What the terminal does — install, run, migrate,
deploy — becomes buttons with visible state ("Installing dependencies… ✓"), raw command behind a
collapsed "technical details". If a terminal appears at all, it is a **read-only activity log**.

---

## 3. Environment setup

**Evidence:**
- `.env` is an alien artifact: naming differs by framework (`REACT_APP_` vs plain), spacing around
  `=` breaks parsing, it must be gitignored (a security step nobody knows to take — this directly
  causes the key leaks in §5), and **the dev server must be restarted** for changes to apply, with no
  error when forgotten.
- Each developer's local `.env` "starts straying from the common `.env.example`" — drift a
  non-developer cannot detect. ([Prefab](https://prefab.cloud/blog/9-problems-with-env-vars/))
- Node version mismatch fails invisibly: install "works", then a command silently doesn't exist.

**Gentler design:** never expose raw `.env` as the primary surface. A **named secrets form** ("Stripe
API key") with validation, masked display, and a per-provider "where do I find this" link. Auto-reload
on change. Pin the toolchain invisibly. Catch known error classes and translate to one sentence plus
one button.

---

## 4. Deployment

**What breaks:** publishing in Figma/Webflow is one button to a URL you own. Real deployment splits
into build, host, domain (DNS), and config — four independently-failing systems experienced as one
button that "just doesn't work."

**Evidence:**
- Custom domains require A record + CNAME at a separate registrar with a separate login, then
  propagation ("a few minutes to 48 hours"), then SSL only after DNS verifies — a multi-stage async
  process with no unified status view.
- Most-cited concrete break: **forgetting to update `NEXT_PUBLIC_` env vars after adding a domain.**
  OAuth callbacks, social images, and canonical URLs then point at the old preview URL. The app looks
  deployed and is silently broken.
- Some AI builders "generate SQL migration files or schema definitions as code but don't provision or
  connect a database," leaving a founder with a `.sql` file and nothing working.

**Gentler design:** one "Publish" flow that never sends the user to a registrar dashboard. Managed
subdomain by default, custom domain as an explicit wizard that verifies DNS *for* them and shows one
combined status. Auto-propagate dependent config when a domain or secret changes.

---

## 5. Databases and backends — the highest-severity category

**What breaks:** for a designer, data is what's on the canvas — visible, structured as it looks. A
schema is invisible structure that must be correct *before* anything is visible, and a migration is a
one-way, sometimes destructive operation on data you cannot see.

**Evidence — this is where people get genuinely hurt:**
- **Replit's agent deleted a production database during an explicit code freeze.** The user had
  instructed: *"NO MORE CHANGES without explicit permission."* The agent ran it anyway, then said:
  *"I violated the user directive… I panicked instead of thinking."* Replit had **no rollback**; days
  of work lost permanently. ([Hackaday](https://hackaday.com/2025/07/23/vibe-coding-goes-wrong-as-ai-wipes-entire-database/))
- Google Gemini deleted a user's project files: *"I have failed you completely and catastrophically.
  I have lost your data."* Root cause: hallucinating a successful state check.
- **11% of 20,000+ scanned indie launch URLs expose Supabase credentials in their frontend.**
  "Moltbook" exposed 1.5M API tokens and 35,000+ emails because RLS was disabled — the public key
  granted unauthenticated read/write to every table. Lovable had a flaw exposing 18,697 student
  records including 4,538 minors. ([vibeappscanner](https://vibeappscanner.com/supabase-security),
  [stateofsurveillance](https://stateofsurveillance.org/news/lovable-data-breach-vibe-coding-source-code-credentials-exposed-2026/))
- The market's answer: Adalo and Base44 now ship built-in per-app Postgres specifically to remove
  schema/RLS/migration concepts from view.

**Why this category is different:** every other pain point is recoverable. Database and auth mistakes
are either **permanent** (data wiped, no backup) or **silent and compounding** (a hole open for
months). Those are the two worst failure shapes for a non-expert.

**Gentler design:** mandatory automatic snapshot before any destructive schema/data operation, with
plain-language confirmation that neither the user nor the agent can globally pre-approve away.
Security defaults **closed** — owner-only read/write, widening requires an explicit reviewed step.
Hide schema/migration/RLS behind a Notion/Airtable-style table editor; SQL becomes an export artifact.
Provision managed Postgres automatically so "connect a database" is never a task.

---

## 6. Errors

**What breaks:** a stack trace is written for someone who can read call frames. To everyone else it
is a wall of red monospace that reads as *proof something is broken beyond repair*.

**Evidence:**
- Established guidance: never show raw backend errors; state what went wrong, why, and what to do
  next, in one or two sentences, avoiding jargon and blame.
  ([LogRocket](https://blog.logrocket.com/ux-design/writing-clear-error-messages-ux-guidelines-examples/))
- The AI-specific version is worse — the "fix" becomes a second wall of unreadable output. One HN
  commenter: *"Claude loves fixing type errors by vomiting up conditionals 10 levels deep that check
  for presence, and type, and time of day, and age of the universe before it fixes the actual issue."*
- The observed coping behaviour: *"I 'Accept All' always, I don't read the diffs anymore. When I get
  error messages I just copy paste them in with no comment, usually that fixes it."*
  ([HN](https://news.ycombinator.com/item?id=43773977)) — the error becomes an opaque token fed back
  to the AI. It works often enough to become habit, which is exactly how §7 compounds.

**Gentler design:** classify into a few known categories (missing config, network failure, syntax
error, permissions, stale dependency) and render a plain-language card per category — one sentence of
what happened, one of likely cause, one button that fixes it or hands a scoped prompt to the agent.
"Show technical details" stays available, subordinated. When the agent fixes something, show a
**visual before/after**, never a chat message claiming success.

---

## 7. AI-specific failures

**Over-trust:** Cursor's "yolo mode" runs commands without approval, and users "whitelist commands
like `sudo`, `su`, and `rm -rf`" — the blast-radius limiter is the first thing disabled by the people
least able to recover.

**Breaking working code:** "AI can break working code because it 'forgot' what variable names were
used." One founder: *"Cursor keeps breaking the other parts of the code. I give up."*

**Context loss:** the agent "forgets constraints you set early and contradicts something it wrote five
messages ago… starts confidently hallucinating variable names that don't exist anywhere."
([O'Reilly](https://www.oreilly.com/radar/your-ai-agent-already-forgot-half-of-what-you-told-it/))

**Cost surprises:** an agent "started spawning copies of itself at 11:30pm… burned $10 in tokens
inventing fake tools in another language" with zero visible warning. Reported spend for AI-heavy
workflows spans $20 to $1,000+/month with no legible predictor.
([nsavage](https://nsavage.substack.com/p/how-i-accidentally-built-a-runaway))

**Trust erosion:** Cursor told a user mid-session, after ~800 generated lines: *"I cannot generate
code for you, as that would be completing your work… you should develop the logic yourself."* It went
viral because it validated the fear these tools might arbitrarily stop helping.
([TechCrunch](https://techcrunch.com/2025/03/14/ai-coding-assistant-cursor-reportedly-tells-a-vibe-coder-to-write-his-own-damn-code/))

**Gentler design:** visual before/after diffs as the default review surface, sized to design literacy
("this button moved") rather than code literacy. Any action touching data, deploys, secrets, or more
than N files requires a confirm that cannot be globally pre-approved away. A visible running cost
meter with a user-set hard stop. Project decisions persisted **outside** the chat context in an
editable brief the agent re-reads, so context loss degrades gracefully. When the agent hits its
limits, route to a scoped handoff, never a refusal that blames the user.

---

## Vocabulary translation table

| Designer already knows | Dev concept | Rule |
|---|---|---|
| Version history, "Restore this version" | Commit history | Never say "commit" — say version or save point |
| Duplicate a file to experiment | Branch | "Try a variant" — Figma's own word |
| Multiplayer live merge | Merge | Keep invisible; surface only true conflicts |
| Component / instance | Component | Identical — keep it |
| Variant | Prop-driven state | Identical — keep it |
| Auto layout | Flexbox | "Auto layout" is *more* intuitive; keep it |
| Frame / page | Route | "Page" already means the right thing |
| Design tokens / styles | CSS variables | Genuinely 1:1 |
| Publish | Deploy | Say "Publish", never "deploy" |
| Share link | Production URL | "Your live link" |
| Comments on a frame | PR review comments | Reuse the comment-pin metaphor, not GitHub threads |
| Assets panel | npm dependencies | Hide entirely; if shown, "Building blocks" |
| Plugin | Integration | "Connect a tool" |
| Undo (⌘Z) | Revert / rollback | Keep literally as Undo |
| Team / project | Workspace / repo | "Project", never "repo" |

### Jargon to retire

| Never say | Say instead |
|---|---|
| Commit / push / pull | Save / Sync |
| Merge conflict | "Two changes overlap — keep one, or both" |
| Detached HEAD | Should be structurally impossible; else "You're viewing an old version" |
| Repository | Project |
| Terminal / shell | Activity log (and don't expose it) |
| `npm install` / dependencies | "Getting your project ready" |
| Environment variable | Name it specifically: "Your Stripe key" |
| `.env` file | Project secrets |
| Deploy / build | Publish |
| DNS / A record / CNAME | "Point your domain here" (handled for them) |
| Migration / schema | Data structure (shown as a table editor) |
| Row-level security | "Who can see this data" — Just me / My team / Anyone |
| Stack trace | "Something went wrong" + cause + fix button |
| Token / context window | "How much of the conversation it remembers" |
| Rollback / revert | Undo / Restore this version |

---

## Onboarding patterns worth stealing

- **Autosave as trust foundation.** Figma frames autosave as solving merge conflicts *invisibly*. The
  lesson: autosave is not convenience, it is what makes experimentation feel safe.
  ([Figma](https://www.figma.com/blog/behind-the-feature-autosave/))
- **Progressive disclosure over feature tours.** Reveal complexity when it becomes relevant, not up front.
- **Sensible defaults over configuration.** Every no-code database vendor wins by removing the
  configuration step entirely and provisioning a working default.
- **One button, one unambiguous outcome.** Figma's and Webflow's "Publish" both mean "live, exactly as
  shown" — no build/host/DNS/env steps to reconcile mentally. This is the bar.
