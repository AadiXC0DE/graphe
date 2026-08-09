# Feature catalogue

Each feature traces to a documented failure in
[research/03](research/03-designer-pain-points.md). Anything that doesn't remove a real, cited pain
is not in v1.

**Legend** — `v1` ships first · `v2` follows · `later` is directional · ⚠️ has an open question

---

## Pillar 1 — Nothing is ever lost

*Pain: Replit's agent wiped a production database with no rollback. Designers lose work to detached
HEAD. "I give up" after an agent broke working code.*

| # | Feature | Ship |
|---|---|---|
| 1.1 | Autosave every change. No save button anywhere. | v1 |
| 1.2 | Automatic snapshot at boundaries: agent turn ends, preview builds green, before anything destructive | v1 |
| 1.3 | **Version timeline** — vertical list, newest first, thumbnail per entry, plain title ("Made the header sticky") | v1 |
| 1.4 | One-click **Restore this version**, itself undoable | v1 |
| 1.5 | ⌘Z works everywhere, including across agent turns | v1 |
| 1.6 | Name a version ("before I broke the nav") | v1 |
| 1.7 | Hover a version to preview it live without restoring | v2 |
| 1.8 | **Try a variant** — parallel line of work, presented as duplicate-a-file, not a branch | v2 |
| 1.9 | Variant comparison: side-by-side rendered pages, not text | v2 |
| 1.10 | Auto-merge non-overlapping changes silently; conflicts as "keep this / that / both" | v2 |
| 1.11 | Snapshots survive uninstall — they live in the project folder | v1 |
| 1.12 | "What changed since yesterday?" visual digest | later |

## Pillar 2 — You always see what it did

*Pain: "I 'Accept All' always, I don't read the diffs anymore."*

| # | Feature | Ship |
|---|---|---|
| 2.1 | **Visual diff first** — before/after screenshots of affected pages, not code | v1 |
| 2.2 | Plain-language change summary ("Moved the button, made it blue, added a hover") | v1 |
| 2.3 | Per-change accept / undo, not one blanket Accept All | v1 |
| 2.4 | Code diff available behind "Show the code" — subordinated, never deleted | v1 |
| 2.5 | Live preview beside the conversation, always | v1 |
| 2.6 | Preview at phone / tablet / desktop widths with one click | v1 |
| 2.7 | Highlight the element that changed, in the preview | v2 |
| 2.8 | Click an element in the preview to talk about it ("make *this* bigger") | v2 |
| 2.9 | "Explain what you just did" in one paragraph, on demand | v1 |
| 2.10 | Flag when a change touched something the user didn't ask about | v2 |

## Pillar 3 — Dangerous things are structurally hard

*Pain: 11% of scanned indie apps leak database credentials. RLS disabled by default. Agents run
destructive commands during an explicit freeze.*

| # | Feature | Ship |
|---|---|---|
| 3.1 | **Guard**: every tool call policy-checked before it runs | v1 |
| 3.2 | Nothing outside the project folder. Ever. Not configurable in v1 | v1 |
| 3.3 | Snapshot forced before any destructive operation — cannot be pre-approved away | v1 |
| 3.4 | Confirmations in plain language: "This deletes the email column and everything in it." | v1 |
| 3.5 | No global "always allow" for data, secrets, deploys, or network writes | v1 |
| 3.6 | Container boundary for execution ⚠️ mechanism undecided | v1 |
| 3.7 | Secrets never reach the browser bundle — blocked at write time, with an explanation | v1 |
| 3.8 | Data access defaults closed (owner-only); widening is an explicit reviewed step | v2 |
| 3.9 | Pre-publish safety check: exposed keys, open data, missing config | v2 |
| 3.10 | Cost meter with a user-set hard stop | v1 |
| 3.11 | Agent-loop detection — stop and ask after N failed attempts at the same thing | v1 |
| 3.12 | "Panic button": stop everything, restore last good version | v1 |

## Pillar 4 — No terminal, no git, no config files

*Pain: "the black screen" turns away ~99% of non-engineers. `.env` needs a manual restart, silently.*

| # | Feature | Ship |
|---|---|---|
| 4.1 | Zero commands typed in normal use | v1 |
| 4.2 | Setup as visible progress with plain labels ("Getting your project ready… ✓") | v1 |
| 4.3 | Toolchain pinned and bundled — Node version is never a concept | v1 |
| 4.4 | Activity log is **read-only**, styled as a feed, not an input | v1 |
| 4.5 | **Named secrets form** — "Your Stripe key", masked, validated, with "where do I find this" | v1 |
| 4.6 | Auto-reload on secret change; never "you must restart" | v1 |
| 4.7 | Port conflicts resolved silently | v1 |
| 4.8 | Known error classes → one sentence + one button. Raw output collapsed | v1 |
| 4.9 | Dependency install failures auto-retried, then explained in plain language | v1 |
| 4.10 | "Show technical details" everywhere, never required | v1 |

## Pillar 5 — Publishing is one button

*Pain: build/host/domain/config are four failing systems experienced as one broken button. The
`NEXT_PUBLIC_` drift bug silently breaks live apps.*

| # | Feature | Ship |
|---|---|---|
| 5.1 | **Publish** → live URL. One button, one outcome | v1 |
| 5.2 | OAuth to their Vercel / Netlify / Cloudflare account. No registrar visit | v1 |
| 5.3 | Free-tier subdomain by default, working immediately | v1 |
| 5.4 | Env vars auto-propagated to production; URL-dependent config rewritten on domain change | v1 |
| 5.5 | Build failures translated, with a fix button | v1 |
| 5.6 | Custom domain as a guided wizard; we verify DNS for them | v2 |
| 5.7 | One combined status: Domain ✓ · DNS waiting ⏳ · SSL ✓ | v2 |
| 5.8 | Preview link per variant, shareable before publishing | v2 |
| 5.9 | **Unpublish** and roll back a live version | v1 |

## Pillar 6 — It starts where designers already are

*This is the differentiator. Everything above is table stakes done gently; this is the reason a
designer picks us over Lovable.*

| # | Feature | Ship |
|---|---|---|
| 6.1 | **Start from a Figma file** — paste a link, get a real page | v1 |
| 6.2 | Pull real design tokens (color, type, spacing, radius) into real CSS variables | v1 |
| 6.3 | Honour auto layout as flexbox properly, not absolute positioning | v1 |
| 6.4 | Start from a screenshot or a photo of paper | v1 |
| 6.5 | Start from a sentence | v1 |
| 6.6 | Re-sync when the Figma file changes — show what moved, let them choose | v2 |
| 6.7 | Component/variant mapping: a Figma component becomes one real component | v2 |
| 6.8 | Speak design: "increase the leading", "tighten tracking", "use 8pt spacing" | v1 |
| 6.9 | House style file: fonts, spacing scale, radii, motion defaults, applied to everything | v1 |
| 6.10 | Font handling that works — licensing-aware, correct fallbacks, no FOUT | v2 |
| 6.11 | Motion that isn't garbage: real easing, `prefers-reduced-motion` respected by default | v1 |
| 6.12 | Accessibility as a default, not a lint: contrast, focus states, alt text, tab order | v1 |
| 6.13 | Export to a clean repo any developer would accept | v1 |

## Pillar 7 — It teaches, only if you want

*Pain: designers want to grow into this, but every existing tool either hides everything forever
(walled garden) or explains nothing (Claude Code).*

| # | Feature | Ship |
|---|---|---|
| 7.1 | Every technical term has a one-line plain definition on hover | v1 |
| 7.2 | "Why did you do it that way?" — answered without condescension | v1 |
| 7.3 | Optional **Show me** mode: the real command/concept behind each action | v2 |
| 7.4 | Graduation path: reveal git, terminal, and code as opt-in, one at a time | v2 |
| 7.5 | The project is always a normal repo — nothing to migrate off | v1 |
| 7.6 | "Hand this to a developer" — scoped summary of state, decisions, and what's left | v2 |
| 7.7 | Never blames the user. No "you should learn to code yourself" refusals | v1 |

---

## Explicitly not building

- **A visual drag-and-drop canvas editor.** That is Onlook's and Webflow's fight. Our surface is
  conversation plus preview plus timeline. Adding a canvas triples scope and puts us in a war we'd lose.
- **Our own hosting, database, or auth service.** No backend, no bills, no us in the middle.
- **Our own model.** We are a harness.
- **Real-time multiplayer.** Wonderful, and a v3 conversation at best.
- **Mobile/native app output.** Web first, done properly.
