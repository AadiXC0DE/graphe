# Research: The Pi Agent (foundation assessment)

Researched 2026-08-09. Sources: [earendil-works/pi](https://github.com/earendil-works/pi),
[pi.dev/docs](https://pi.dev/docs/latest), [disler/pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code).

**Verdict: Pi is the right foundation, but it is a chassis, not a car.** It gives us the agent loop,
multi-provider LLM access, subscription login, sessions, and a genuinely good extension system. It
deliberately gives us *nothing* on safety, and that is the part our users need most.

---

## 1. What Pi actually is

A monorepo of five packages, MIT licensed, copyright **Mario Zechner** (not Armin Ronacher — a
common misattribution worth correcting internally).

| Package | Purpose |
|---|---|
| `@earendil-works/pi-coding-agent` | The CLI, and the home of the SDK entrypoint |
| `@earendil-works/pi-agent-core` | Agent runtime: tool calling, state management |
| `@earendil-works/pi-ai` | Unified multi-provider LLM API |
| `@earendil-works/pi-tui` | Terminal UI with differential rendering |
| `@earendil-works/pi-telemetry` | Vendor-neutral telemetry contracts |

Created 2025-08-09 (one year old), **85.9k stars**, 10.7k forks, 263 contributors, 94 open issues,
currently `v0.84.1` with 310 releases. Star count verified via the GitHub API directly, not scraped.

---

## 2. Can we embed it in a GUI? Yes — this is the critical finding

Pi is not terminal-only. The SDK explicitly targets non-terminal embedding, listing "Build a custom
UI (web, desktop, mobile)" as a supported use case.

```ts
import { createAgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
const { session } = await createAgentSession({ sessionManager: SessionManager.inMemory() });
session.subscribe((event) => { /* stream deltas, tool events */ });
await session.prompt("...");
```

Surface: `AgentSession` (`.prompt()`, `.subscribe()`, `.steer()`, `.followUp()`, `.dispose()`),
`Agent`, `ModelRuntime`, `SessionManager`, `defineTool()`.

There is also a **headless RPC mode** (`pi --mode rpc`, JSON-Lines over stdin/stdout) for
language-agnostic embedding. Pi's own docs recommend the SDK over RPC for Node apps.

**Implication for us:** we can build a real graphical app and drive Pi underneath. We are not forced
into a terminal, which would be an instant disqualifier for our audience.

---

## 3. Extensions: the leverage point

TypeScript modules loaded via `jiti`, no build step. They can:

- **Register model-callable tools** — `pi.registerTool({ name, description, parameters, execute })`
- **Intercept tool calls before they run** — this is the hook our entire safety layer depends on:

```ts
pi.on("tool_call", async (event, ctx) => {
  if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
    return { block: true, reason: "Blocked by user" };
  }
});
```

- Hook ~30 events: session lifecycle, turn start/end, message streaming, `tool_result` rewriting,
  provider request/response, user input interception
- Register slash commands, shortcuts, custom model providers, custom renderers
- Control sessions: `ctx.fork()`, `ctx.navigateTree()`, `ctx.newSession()`

**Limit worth knowing:** `ctx.ui.custom()` (bespoke widget trees) only works when `ctx.mode === "tui"`.
Simple dialogs (`confirm`, `select`, `input`, `notify`) *do* cross the RPC boundary, so a GUI can
honour extension-triggered prompts — but we render our own UI for anything richer.

---

## 4. Skills and instructions

- **Skills**: `SKILL.md` + YAML frontmatter, progressive disclosure (only name/description enter the
  system prompt; the agent reads the full file when relevant). Architecturally the same as Claude's
  Skills. Optional `scripts/`, `references/`, `assets/`.
- **Prompt templates**: Markdown snippets invoked as `/name`.
- **`AGENTS.md`**: per-project agent-facing rules, loaded from the project and parent directories.
- **`SYSTEM.md`**: per-project system prompt customization. ⚠️ **Unverified** whether it *replaces*
  or *appends to* the base prompt — must confirm before relying on it for our own agent persona.

---

## 5. Subscription auth — and a serious catch

`/login` → pick provider → OAuth or paste a key, stored in `auth.json`.

**OAuth subscription login confirmed for:** Claude Pro/Max, ChatGPT Plus/Pro (Codex), GitHub Copilot,
xAI, OpenRouter. ~30 other providers are API-key only.

> ⚠️ **This undercuts the "just connect your existing subscription" pitch.** Pi's own docs state:
> *"Anthropic subscription auth is active for Claude Pro/Max accounts. Third-party harness usage
> draws from extra usage and is billed per token, not against Claude plan limits."*
>
> So a user's Claude Pro login through Pi does **not** spend their flat-rate plan quota — it bills
> metered usage on top of the subscription. Our onboarding must say this in plain language or users
> will get a surprise bill, which for our audience is a trust-ending event.

**Unverified and legally material:** whether Anthropic's, OpenAI's, and GitHub's *consumer* terms
permit routing those logins through a third-party product we distribute. Pi's docs describe the
mechanism but make no ToS claim. This needs a real answer before launch, not an assumption.

---

## 6. Safety: Pi has none, on purpose

From the README:

> *"Pi does not include a built-in permission system for restricting filesystem, process, network, or
> credential access. By default, it runs with the permissions of the user and process that launched it."*

`SECURITY.md` lists sandboxing as explicitly **out of scope** — *"the Pi coding agent intentionally
does not have a sandbox."* Also out of scope: prompt injection, untrusted extensions, untrusted repos.
Project-trust is *"only an input-loading guard… It does not make untrusted code, untrusted prompts,
or untrusted model output safe."*

**This is a design stance, not a gap that will close.** Do not plan around Pi adding permissions later.

Three documented mitigations, all DIY:

| Option | What it is | Maturity |
|---|---|---|
| **Gondolin** | Extension routing built-in tools + `!` commands into a Linux micro-VM; host keeps auth | Shipped as an *example extension*. Needs Node ≥23.6 and QEMU. Reference implementation, not an audited boundary |
| **Docker** | Run all of `pi` in a container; example Dockerfile provided | Docker itself is mature; we build and maintain the image |
| **OpenShell** | NVIDIA policy-controlled sandbox (filesystem/process/network/credential controls) | External product, outside Pi's control |

**Consequence for us:** we must own a hardened execution boundary ourselves. This is the single
largest engineering item in the project, and it is non-negotiable — our users cannot evaluate whether
a command is dangerous. The `tool_call` block hook is our enforcement point.

---

## 7. Sessions — better than expected

JSONL under `~/.pi/agent/sessions/`, keyed by working directory. Every entry has `id`/`parentId`,
forming a **tree**, with the current position as the active leaf.

- `/tree` — navigate/branch in place within one session file
- `/fork` — new session file rooted at a past point
- `/clone` — duplicate work-in-progress
- `/export` → HTML, `/share` → private gist

No explicit "undo" command, but tree navigation to a prior entry is non-destructive and serves the
purpose. **This is the raw material for our Figma-style version history** — the primitives are all
exposed to the SDK (`get_tree`, `get_entries`, `fork`, `navigateTree`), so we can build a visual
timeline on top rather than inventing our own history store.

---

## 8. MCP: not in core, works via extensions

Pi's "Intentional Limitations" list excludes MCP from core (alongside sub-agents, permission popups,
plan mode, built-in todos, background bash) — all pushed to extensions.

Open issue [#563](https://github.com/earendil-works/pi/issues/563) proposes an example MCP extension.
Several third-party ones already work (`irahardianto/pi-mcp-extension`, `0xKobold/pi-mcp`, others),
none first-party. If we want MCP (e.g. a Figma MCP server), we vet or write it ourselves.

---

## 9. Maturity: fast, popular, and churning

Release cadence is multiple per week; five `v0.80.x` patches shipped on a single day.

**Three SDK-breaking waves in ~6 weeks**, all pre-1.0:

- **v0.84.0** (Aug 6) — `message_update` events became deltas-only (wire-format break); session APIs
  replaced with a "v4 lane-based" model; `ModelsStreamTransforms` renamed
- **v0.80.8** (Jul 14) — auth unified behind `ModelRuntime`; `AuthStorage` exports removed;
  `ModelRegistry.refresh()` sync → async
- **v0.80.0** (Jun 22) — `pi-ai` global API moved to `/compat`; `/base` entrypoints removed

No documented semver or API-stability commitment. The RPC docs explicitly note the absence of a
versioning scheme.

**Plan for this:** pin an exact Pi version, wrap every Pi API behind our own adapter layer so churn
hits one module, and budget recurring maintenance to track upstream.

**Governance:** `CONTRIBUTING.md` says PRs that "bloat the core" are rejected in favour of extensions;
new contributors' issues/PRs are auto-closed until a maintainer grants `lgtm`. Small, deliberately
gatekept core team despite the large star count. We should not expect upstream to accept changes that
serve our use case — we build in the extension layer.

---

## 10. License

**MIT**, copyright Mario Zechner. Commercial use, modification, and redistribution all permitted with
notice retention. No CLA restrictions found.

⚠️ **Trademark is separate from copyright.** MIT says nothing about the "Pi" name or logo. The press
kit permits editorial use but does not address rebranding. If our product name echoes "Pi", that is a
trademark question MIT does not answer.

---

## Open questions to close before building

1. Does `SYSTEM.md` replace or append to the base system prompt?
2. Do Anthropic/OpenAI/GitHub consumer ToS permit third-party harness login in a distributed product?
3. Is Gondolin maintained enough to depend on, or do we build our own container boundary?
4. What is Pi's actual upgrade path story between 0.x versions — is there a migration guide?
