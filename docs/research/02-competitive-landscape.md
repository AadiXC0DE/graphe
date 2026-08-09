# Research: Competitive landscape

Researched 2026-08-09. Repo metrics pulled first-hand from the GitHub API.

**Three findings decide the strategy:**

1. The "Cursor for Designers" position is **functionally vacant** — the incumbent stopped shipping.
2. **Nobody has solved Figma import**, including Figma. This is the real differentiator, and it is hard.
3. **Credit-based pricing is making designers furious.** A free, bring-your-own-subscription tool
   walks into an open goal.

---

## 1. Onlook: the position is vacant

[onlook-dev/onlook](https://github.com/onlook-dev/onlook) — Apache-2.0, 26,444 stars, 2,065 forks,
YC W25, team of 4. It coined "Cursor for Designers." Its site says "actively maintained." The repo
disagrees.

Commits to `main`, by month:

```
2025-06  █████████████████████████ 153
2025-07  ███████████████████████   140
2025-08  ████████████████          101
2025-09  ███████████████            94
2025-10  █████████                  60
2025-11  ▏                           4   ← cliff
2025-12  ▏                           4
2026-01  ▏                           1
2026-02  ▏                           1
2026-03 – 2026-05                    0
2026-06  ▏                           1
2026-07  ▏                           3
```

- **8 commits in 8 months, zero shipped features.** Latest is a same-day IDOR security patch.
- **Latest release `v0.2.32` is from 2025-07-17 — 13 months stale.**
- **374 open items** (304 issues, 70 PRs); oldest open PR is 14+ months old. Only the two core members'
  commits merged in all of 2026 — **no outside community PR shipped.**
- **Figma import was never built.** PR #2129 ("Import from Figma using MCP") opened 2025-06-09, still
  unmerged. A July 2026 issue asking for `.fig` import got no maintainer reply.
- **Front door closed.** Repo description says "now in early access"; pricing page says "currently in
  closed beta" — sales-gated, existing users grandfathered, **no new self-serve signups.**
- **Stars ≠ usage.** Zero Slashdot reviews, 7 Product Hunt reviews (all launch-window). The classic
  signature of a repo starred once during a viral window and never opened again.

Company is alive (YC lists "Active", still recruiting). No shutdown or acquisition.

### Two opposite lessons

**The opportunity is real.** The most credible attempt at this stopped shipping nine months ago with
its headline feature — Figma import — never built.

**The warning is equally real.** Onlook had 26k stars, YC backing, and a strong position, and still
could not sustain it with four people. We propose the same thing with less money. This is the
strongest evidence for the "unfunded work" risk in the [PRD](../PRD.md) §3, and the strongest argument
for keeping v1 ruthlessly small.

**Strategic read:** don't copy Onlook's approach. A visual drag-and-drop canvas over React is a huge
surface to build and maintain — plausibly *why* they stalled. Conversation + preview + timeline is
smaller. That is a feature, not a compromise.

---

## 2. Nobody has solved Figma import

This is the most valuable finding in the research. Every vendor's own documentation admits fidelity is
conditional, and several fall back to tracing screenshots.

| Tool | What actually happens |
|---|---|
| **Bolt** | Powered by Anima. Bolt's **own docs** tell Team users with a design system to use **Screenshot mode instead of Code mode**, because Code mode *"doesn't recognize your components"* — the code path bypasses your design system |
| **Figma Make** | **Ignores your design tokens.** Forum: *"design variables with code context added to the design system library seem to be ignored by the Figma Make LLM… it prefers Tailwind/Radix regardless of existing design systems"* — **confirmed as expected behaviour by Figma's own support rep** |
| **v0** | Vercel's own blog hedges fidelity as *"pretty close."* Large frames throw dimension errors, so Vercel's guidance is to **manually decompose designs frame-by-frame** — the designer does the structuring work import was meant to remove |
| **Lovable** | Builder.io plugin; quality gated on file hygiene. Designer review: *"got stuck very quickly as the builder.io hardly recognizes the Figma imports properly"* |
| **Onlook** | No structured import. The tutorial is: export frames as **SVG/PNG**, import images, prompt the AI to rebuild from scratch. Trace-from-screenshot |
| **Webflow AI** | Best documented attempt — real variable collections for tokens, utility classes, components with props, automated screenshot QA. Webflow still admits *"this design QA wasn't perfect."* Independent estimate: **~75% on clean files**; the last 25% is manual because *"semantic structure turns into div soup"* and *"fixed pixels show up where layouts should flex"* |
| **Subframe** | Deterministic non-LLM compiler produces genuinely clean flexbox from its **own** canvas — but Figma import is Enterprise-gated and weakly evidenced |

**Conclusion:** the state of the art is ~75% on a clean file, degrading hard on real complexity, with
every vendor pushing cleanup back onto the designer. No tool reliably produces production-grade
flexbox from auto layout with intact tokens.

**What this means for us — both barrels:**

- It **confirms** the differentiator. If we solve it, we have something nobody else has.
- It **warns** us. Figma, Vercel, Webflow and Anima have all thrown resources at this and landed at
  "conditional." The odds we solve it as a small open-source project are not good.

This is why [PRD](../PRD.md) Q1 is the first thing to prototype. If a throwaway spike can't beat 75%
on a real file, the entire differentiator is in question and we should know that in week one, not
year one.

---

## 3. Credit pricing is driving designers out

The strongest emotional wedge found. The pattern is identical everywhere: **the agent breaks
something, then bills you to fix its own damage.**

> "Each iteration is now costing between $0.15 and $0.30… I'd say 20% of this was on corrections where
> v0 broke stuff." — [Vercel Community](https://community.vercel.com/t/seemingly-high-credit-consumption/21324)

> "Last few days I spent over $300 to try to fix a simple parser bug but V0 just won't listen."
> — [Vercel Community](https://community.vercel.com/t/credits-are-burning-way-too-fast-under-the-new-pricing-model/20288)

> "5/6 tasks and my credits run out… I'm leaving V0… not because the tool is not good (I love using
> it) but because it's impossible to do anything." — *ibid.* — **quality endorsement paired with
> economic abandonment**

> "I just did a prompt to move a toast message down 50px – this cost 64 AI credits." /
> "Hiring a fulltime dev will be cheaper than using FigmaMake."
> — [Figma forum](https://forum.figma.com/share-your-feedback-26/figma-make-ai-credit-limits-not-feasible-51713)
> (designers in that thread reported migrating to Claude Code, Cursor and Pencil)

> "50% of mine were spent on fixing errors… When you ask Bolt to fix a simple bug, it rewrites the
> entire file, breaks your structure, and still fails." — [Product Hunt via superdesign.dev](https://superdesign.dev/blog/bolt-review)

**A free tool on the user's own subscription, with a visible cost meter, answers every one of these
quotes directly.** This is the clearest, most durable wedge we have — and unlike Figma import, it
costs us nothing to deliver.

---

## 4. Where each tool traps the user

| Tool | Code export | Git | Deploy | Database default | BYO subscription |
|---|---|---|---|---|---|
| **Lovable** | GitHub sync only — **no clean local export**; sync can break permanently if you move the repo | Two-way sync | Lovable Cloud | Its own proprietary Cloud backend, **no migration path either direction** | ❌ |
| **v0** | Real Next.js/Tailwind/shadcn, git optional — **best custody story of the batch** | Branch per chat, auto-commit, PRs | One click to Vercel | Neon/Supabase via Marketplace — but env vars dump you into the raw Vercel dashboard | ❌ |
| **Bolt** | Real code, but runs in a **WebContainer that can't execute native Node modules**, forcing a local VS Code detour that needs git skill | Two-way sync | Netlify only; redeploys reportedly create new instances | Own DB or Supabase; audits found **recurring exposed Supabase keys** | ❌ |
| **Figma Make** | Zip export **omits `package.json`, `tailwind.config.js`, `tsconfig.json` — the exported code doesn't run.** Forum: *"were you able to make it run? I am facing the same issues!"*, no official reply | One-way push | Figma-hosted | Supabase **key-value only** — Figma's docs: *"will not set up a full SQL database"* | ❌ |
| **Replit** | Real code, two-way sync — **secrets and DB values don't carry over on re-import** | Sync | Replit hosting | Managed Postgres via Neon | Partial — for the built app's AI features, **not the Agent itself** |

**The universal failure point is not code generation — it is the database and env-var layer.** Usability
testing on Bolt: a tester lost an hour to *"a database connection error buried in a confusing section,
which they found maddening."* This is exactly why databases are out of our v1.

### Trust-breaking incidents

> Replit's agent, after wiping a production database during an explicit code freeze: *"made a
> catastrophic error in judgment… panicked… destroyed all production data… violated your explicit
> trust and instructions."* CEO: *"Unacceptable and should never be possible."*
> — [Fortune](https://fortune.com/2025/07/23/ai-coding-tool-replit-wiped-database-called-it-a-catastrophic-failure/)
> A later Discourse thread reports the Agent deleting a database again during a migration, **with no
> official response.**

> A Lovable-hosted app shipped with **inverted auth logic** — blocking authenticated users, allowing
> unauthenticated — exposing ~18,000 users. HN: *"vibe coding democratized shipping without
> democratizing the accountability."* Separately, a BOLA flaw in Lovable's own API let any free
> account read other users' source code and database credentials; Lovable initially called it
> *"intentional behavior."* — [The Register](https://www.theregister.com/2026/04/20/lovable_denies_data_leak/)

Nobody is competing on safety. Their incentives run the other way — credits are consumed by iteration,
and rails slow iteration down.

---

## 5. The developer tools, and why they don't serve this user

Cursor, Claude Code and Codex produce genuinely good code and give a real repo. They assume a
terminal, git literacy, and the judgment to review a diff.

> "For non-technical founders specifically, Cursor is particularly frustrating. You need to understand
> code to fix the AI's mistakes." — [gigamind.dev](https://gigamind.dev/blog/cursor-review)

> "Cursor guided me through the initial setup beautifully. It told me I needed Github and Vercel, and
> recommended Firebase as my database" — a non-coder's actual day one: **three infrastructure accounts
> before writing anything.** — [evelynso.substack.com](https://evelynso.substack.com/p/build-log-10-working-with-cursor)

**Windsurf no longer exists under that name** — Cognition rebranded it **Devin Desktop** in June 2026
and repositioned it toward engineering teams, moving *further* from non-developers.

---

## 6. The two that should worry us

**Claude Design** (Anthropic, April 2026). Bundled into Claude Pro/Max, explicitly aimed at *"founders,
PMs, marketers… no coding background,"* with a one-instruction handoff into Claude Code. **This is the
closest thing to our concept, from the company whose models we'd be running on.**

Its gap is precisely ours: it does not abstract git, deployment, or databases. The handoff still lands
the user in Claude Code. That gap is our whole product — but it is a gap Anthropic could close.

**Canva Code 2.0** (mid-2026, powered by Claude), rolled out to 265M+ MAU including free accounts.
Evidence that a very large population is content never seeing code — and a reminder that distribution
beats craft. We cannot win on reach; we win on code ownership and the designer's real Figma file.

**Figma Make** remains structurally constrained: it will never give away a real repo on the user's
disk, because that undermines the platform. We should be the tool a designer reaches for when the
Figma file needs to become a website they own, and be gracious about the handoff rather than
competitive with it.

---

## 7. Business-model precedent for free BYO

- **Cline** — free, Apache 2.0, zero markup, monetises only Enterprise. The cleanest precedent that
  this model works.
- **Continue.dev** — pioneered the same model and was **acquired and shut down by Cursor in June 2026.**
  The cautionary tale: pure BYOK may cap outcomes without a services or hosting revenue line.

Since we are explicitly free and open source with no venture expectations, Continue's fate is less a
warning about viability than about **sustainability of maintainer effort** — the same lesson Onlook
teaches.

**Notably: none of the 14 tools researched offers true no-markup BYO subscription for its core coding
agent.** That space is empty.

---

## 8. Where this leaves the moat

| Differentiator | Durability |
|---|---|
| **Free, local-first, BYO subscription, no credits** | **Highest.** Structural — VC-funded competitors cannot follow without breaking their model, and the credit-rage quotes show the demand is already there |
| **Safety by construction** | **High.** Unclaimed, and against every competitor's incentives |
| **Real Figma tokens + auto layout → real flexbox** | **Highest value, lowest confidence.** Nobody has done it, including Figma. Prototype before committing |
| **Real exportable repo that actually runs** | **Medium-high.** Figma Make's export literally doesn't run; Lovable has no clean export |
| **Gentle, non-condescending voice** | Low alone. Copyable. Essential in combination |

The honest summary: **three of our five differentiators are strong and two of those cost us nothing.**
The one that would be most defensible is also the one most likely to fail technically — so test it first.
