# Architecture

> Working name only. See [research/04](research/04-positioning-and-naming.md) — the name needs to change.

## The constraint that drives everything

This is a **free, open-source project**. Nobody is paying for a backend, so the architecture has to be
**local-first**: the app runs on the designer's machine, talks to their own model subscription, and
deploys to *their* hosting accounts. We never hold user data, never proxy model calls, never run a
build farm.

This is a genuine advantage, not just a cost dodge:

- No account required to start. Download, open, build something.
- No usage caps we have to invent, no credits, no quota anxiety.
- Their code stays on their disk, in a real folder, in real git.
- The tools they graduate to (VS Code, Vercel, GitHub) are the same ones underneath.

And one honest disadvantage: **we cannot promise "no infrastructure worries" in the way Lovable can,**
because we don't own the infrastructure. What we can do is make connecting *their* accounts a
three-click OAuth flow and absorb every subsequent decision. See "Publishing" below.

### What this actually costs to run

Close to zero, but not zero. The gap is code signing.

| Item | Cost | Notes |
|---|---|---|
| Model inference | **$0 to us** | The user's own subscription |
| Hosting, builds, databases | **$0 to us** | The user's own Vercel/Netlify account |
| Landing page | **$0** | Vercel, Netlify, Cloudflare or GitHub Pages free tier |
| CI | **$0** | GitHub Actions is free for public repos |
| Release binaries | **$0** | GitHub Releases |
| Figma API | **$0** | Free with a personal access token |
| **Apple Developer Program** | **$99/year** | **Unavoidable.** See below |
| Domain | ~$15/year | Optional at first |
| Windows code signing | $200–400/year | Deferred — v1 is macOS only |

> ⚠️ **The $99 is not optional if we want this audience.** Apple confirms notarization and Developer
> ID signing require paid Developer Program membership; there is **no free tier that permits
> notarization for public distribution**
> ([Apple](https://developer.apple.com/support/compare-memberships/)).
>
> Without it, macOS Gatekeeper tells the user the app "cannot be opened because Apple cannot check it
> for malicious software," and they must right-click → Open or dig into System Settings. For an
> audience defined by *fear of breaking something*, that is the worst possible first thirty seconds —
> and it lands before they have seen a single thing the product does.
>
> Fee waivers exist for nonprofits and educational institutions, which may be worth exploring.

**Realistic total: ~$115/year.** Worth stating plainly in the repo so nobody is surprised, and worth
covering with GitHub Sponsors rather than absorbing quietly.

---

## Shape

```
┌──────────────────────────────────────────────────────┐
│  Desktop app  (Tauri or Electron)                    │
│                                                       │
│  ┌────────────────────────────────────────────────┐  │
│  │  UI layer — the entire product surface          │  │
│  │  Canvas · Timeline · Preview · Plain-language   │  │
│  │  diffs · Secrets form · Publish flow            │  │
│  └────────────────────────────────────────────────┘  │
│                       │                               │
│  ┌────────────────────▼───────────────────────────┐  │
│  │  Adapter layer  ◄── all Pi APIs cross here      │  │
│  │  One module. Absorbs upstream churn.            │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │                               │
│  ┌────────────────────▼───────────────────────────┐  │
│  │  Pi   (@earendil-works/pi-coding-agent SDK)     │  │
│  │  AgentSession · session tree · providers        │  │
│  │  + our extensions: safety, tools, skills        │  │
│  └────────────────────┬───────────────────────────┘  │
│                       │ every tool call              │
│  ┌────────────────────▼───────────────────────────┐  │
│  │  Guard  — tool_call interception (mandatory)    │  │
│  └────────────────────┬───────────────────────────┘  │
└───────────────────────┼──────────────────────────────┘
                        ▼
        ┌───────────────────────────────┐
        │  Execution boundary (container)│
        │  project files · node · build  │
        └───────────────────────────────┘
```

---

## Decision 1: desktop app, not a web app

**Why:** a web app means we host builds and store code — recurring cost we cannot fund, plus the
walled-garden problem that makes Lovable-class tools a dead end. A desktop app puts execution on the
user's machine for free and keeps their project in a real folder they own.

**Tauri vs Electron:** Tauri gives a much smaller binary and lower memory, but Pi's SDK is Node, so we
need a Node runtime regardless — either Electron's bundled Node, or Tauri sidecar-spawning `pi` in
RPC mode. **Recommendation: Electron first** for the simpler single-runtime story and direct
`AgentSession` access (Pi's own docs advise the SDK over RPC for Node apps), revisiting Tauri if
binary size becomes a real complaint. This is a reversible decision if the adapter layer holds.

## Decision 2: the adapter layer is mandatory

Pi shipped **three SDK-breaking changes in six weeks** and is pre-1.0 with no semver commitment. Every
Pi import goes through one adapter module. Nothing else in the codebase imports Pi directly, and we
pin an exact version. When upstream breaks, we fix one file, not fifty.

## Decision 3: we own safety, because Pi refuses to

Pi has no permission system **by design** and lists sandboxing as out of scope. Our users cannot judge
whether a command is dangerous, so this is ours to build. Two layers, both required:

**Layer 1 — Guard (`tool_call` interception).** Every tool call passes through a policy check before
execution:

```ts
pi.on("tool_call", async (event, ctx) => {
  const verdict = policy.evaluate(event);
  if (verdict.deny)    return { block: true, reason: verdict.plainLanguage };
  if (verdict.confirm) return await ui.askInPlainLanguage(verdict);
});
```

Policy classes, roughly: *silent* (read, search, edit a project file), *snapshot-first* (anything
destructive, schema changes, mass edits), *always confirm* (secrets, deploys, network writes, package
installs), *never* (anything outside the project folder, credential reads, `curl | sh`).

**Layer 2 — container boundary.** The Guard is a policy filter and can be bypassed by a sufficiently
creative command. The real boundary is process isolation: project execution happens inside a
container, with the model credentials held *outside* it. Options assessed in
[research/01](research/01-pi-agent.md) §6 — Docker is the pragmatic default; Gondolin's micro-VM is
architecturally nicer but ships as an example extension.

> ⚠️ Requiring Docker contradicts "no infrastructure worries" — installing Docker Desktop is exactly
> the kind of setup that loses this audience. **Open question:** ship a bundled minimal runtime, use
> OS-native sandboxing (macOS `sandbox-exec`, Windows AppContainer), or accept Docker as a one-time
> guided install. This needs a decision before any code.

## Decision 4: git exists, but is never spoken

Every project is a real git repo. The user never sees the word. We commit automatically at meaningful
boundaries — agent turn completes, preview builds green, before any destructive operation — and
surface it as a **Figma-style version timeline** with thumbnails and one-click restore.

Pi's session tree (`get_tree`, `fork`, `navigateTree`) already models branching, so the timeline is a
join of *session tree* (what was said) and *git history* (what changed). Restoring a version moves
both together.

"Try a variant" creates a branch. Merging is auto-resolved where changes don't overlap; a genuine
conflict is presented as a visual "keep this / keep that / keep both", never a diff hunk.

The escape hatch matters: the folder is a normal repo, so a designer who grows into git — or a
developer teammate — finds ordinary history with sensible commit messages. Nothing to migrate off.

## Decision 5: bring your own model

Pi supports OAuth login for Claude Pro/Max, ChatGPT Plus/Pro, GitHub Copilot, xAI, and OpenRouter,
plus ~30 API-key providers. We inherit all of it.

> ⚠️ **Must be said plainly in onboarding.** Pi's docs: Claude Pro/Max via a third-party harness
> *"draws from extra usage and is billed per token, not against Claude plan limits."* Users who
> believe their $20/month covers it will get a surprise bill. For this audience that is a
> trust-ending event, so the connect screen states it before they click, and a live cost meter with a
> user-set hard stop runs in the corner from the first prompt.

## Decision 6: publishing connects their accounts

One "Publish" button. Underneath: OAuth to Vercel, Netlify, or Cloudflare Pages — all of which have
free tiers a designer can use indefinitely — then we own every subsequent decision (build config,
env var propagation, the `NEXT_PUBLIC_` drift bug, DNS verification, SSL status) behind a single
combined status view.

Custom domains stay an explicit advanced step. Default is a working subdomain, immediately.

---

## What we build on top of Pi

| Piece | Form | Notes |
|---|---|---|
| Guard / policy engine | Pi extension | `tool_call` + `tool_result` hooks |
| Design-native tools | Pi extension | `registerTool` — read a Figma file, extract tokens, screenshot a route, visual diff |
| Skills | `SKILL.md` files | House style, accessibility checks, responsive rules, "explain this to me" |
| System persona | `SYSTEM.md` / `AGENTS.md` | Gentle voice, no jargon, always explain before acting ⚠️ verify `SYSTEM.md` semantics |
| Timeline | App UI | Over session tree + git |
| Visual diff | App UI + tool | Screenshot before/after per route |
| Secrets | App UI | Named form, never raw `.env` |
| Publish | App UI + OAuth | Their accounts |
| Cost meter | App UI | Over Pi token events |

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| Pi SDK churn breaks us repeatedly | High | Adapter layer, pinned version, upgrade budget |
| Sandbox requires Docker, losing the audience | High | Evaluate OS-native sandboxing; decide before building |
| Consumer-subscription ToS forbids third-party harness use | High | **Verify with each vendor before launch** — unresolved |
| We ship the same security holes we criticise (§5 of pain research) | High | Closed-by-default data access; no key ever reaches the frontend |
| Agent quality below Claude Code / Codex | Medium | We inherit frontier models; quality is prompt + tools + context, not the harness |
| "Pi" trademark confusion | Medium | Rename (see research/04) |
| Scope: this is a large product | High | Ruthless v1 cut — see PRD |
