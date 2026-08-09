# Research: Positioning, landing page craft, and the name

Researched 2026-08-09.

---

## 1. The naming problem — recommend against "Pico"

**"Pico" collides with a direct competitor and a ByteDance hardware brand.** This is not a distant
trademark worry; it is an SEO and credibility problem on day one.

| Existing "Pico" | What it is | Severity |
|---|---|---|
| **PICO XR** (picoxr.com) | ByteDance VR/MR headsets, acquired for ~$1B, actively filing trademarks since 2022 | **Severe** — funded, trademark-active, global |
| **Pico** (picoapps.xyz) | AI text-to-app builder: describe an app, get a deployed web app | **Severe — same category.** A designer googling us finds a competitor |
| **Pico** (trypico.com) | Creator monetization SaaS, own docs subdomain | High |
| **pico.sh** | Developer tool suite, owns the clean domain | High |
| **Pico CSS** (picocss.com) | Minimal CSS framework, strong SEO on "pico" + web UI terms | Moderate-high — same audience |
| **PICO-8** | Fantasy console, cult following among creative coders | Moderate |
| **Raspberry Pi Pico** | Microcontroller line | Moderate — huge search dilution |
| pico / PicoVoice | Unix text editor; on-device voice AI SDK | Low |

The practical argument beats the legal one: our user *will* google the name before trying it, and the
first page is a VR headset, a rival app builder, and a CSS framework. That is a conversion problem no
amount of good copy fixes.

**A second consideration now that this is open source:** a name echoing "Pi" invites confusion about
whether we are an official Pi project. MIT covers the code, not the trademark.

---

## 1b. "Eidos" — checked, and it doesn't work either

Lovely meaning (Plato's *form* — the idea a thing takes when it becomes real, which is exactly what
this product does). Unusable in practice, for a more specific reason than Pico.

**On GitHub — the platform this project actually lives on:**

| Repo | Stars | What it is |
|---|---|---|
| `mayneyao/eidos` | **3,172** ⭐ | "An extensible framework for Personal Data Management" — local-first prosumer tooling, adjacent audience |
| `agenticnotetaking/eidos` | 58 ⭐ | **"Spec Driven Development — Claude Code plugin"** — an AI coding tool, our exact category |
| `opisaac9001/eidos` | 23 ⭐ | "A Self-Growing AI Agent with Long-Term Memory" |
| `clulab/eidos`, `google/eidos-audition`, `ratt-ru/eidos` | 34–37 ⭐ | ML/science projects |

We would be the **fourth** AI/dev tool named Eidos on GitHub, behind a 3.2k-star incumbent. `npm i eidos`
is also taken (`Wandalen/eidos`).

**Trademark:** `eidos.com` **and** `eidos.dev` both 301-redirect to **eidosmontreal.com** — Eidos-Montréal,
the Embracer-owned studio behind *Deus Ex* and *Tomb Raider*. The `.com` is registered through
**MarkMonitor**, the corporate brand-protection registrar. They have already defensively claimed the
`.dev` a developer tool would want, which tells you they are actively policing the mark across
software TLDs. Games and dev tools both sit in trademark class 9 (computer software).

**Domains:** `.com` `.dev` `.app` `.io` `.sh` `.design` and `geteidos.com` are all registered.
`eidos.design` — the fallback suggested — is **already taken** (NameCheap). Only `useeidos.com` was free.

**Verdict: same failure as Pico, discovered one layer deeper.** For an open-source project the domain
matters less than the GitHub namespace and search distinctiveness, and Eidos fails on exactly those.

### The test that matters for an OSS project

Domains are secondary. Rank candidates on:

1. **Is `github.com/<org>/<name>` uncontested?** No established repo with the same name.
2. **Is it searchable?** `"<name>" figma` or `"<name>" design tool` should not return a wall of
   other things.
3. **No large software trademark holder.**
4. Domain — *later*, and a modifier is fine.

### Shortlist, checked against GitHub

| Name | GitHub collision | Meaning | Read |
|---|---|---|---|
| **Kern** | **None** — no exact-name repo | Typography: the space between letters. Designers know it intimately | **Strongest.** Short, sayable, design-native, clean namespace |
| **Colophon** | 5 ⭐ (`alphagov/colophon`) | The note at the end of a book recording how it was made | **Excellent meaning** for a tool that builds things and shows its work. Longer to type |
| **Gesso** | 72 ⭐ (a Drupal theme) | The primer coat applied before painting — the preparation that makes real work possible | Strong metaphor, minor unrelated collision |
| **Deckle** | 3 ⭐ | The rough edge of handmade paper | Nearly clear, but obscure |
| Ferrule | 10 ⭐ | The metal band on a brush | Clear-ish, hard to spell |
| Maquette | 783 ⭐ virtual DOM library | A preliminary scale model | **Avoid** — collides inside the JS ecosystem |
| Purl | 1,840 ⭐ JS utility | A knitting stitch | **Avoid** |
| Quire | 147 ⭐ (Getty publishing) | Sheets of folded paper | Moderate collision in publishing |

**Recommendation: Kern.** It is the only candidate with a genuinely clean GitHub namespace, it is a
word this exact audience uses every day, and it carries the right idea — the craft of small spacing
decisions, which is precisely what separates a designer's output from a developer's.

### Original shortlist (superseded, single dictionary words)

All of `cairn` `nib` `vane` `plumb` `kiln` `awl` `poise` have `.com`/`.dev`/`.app` already
registered — expected for common words. Kept here only for reference.

| Name | Why it works | Watch for |
|---|---|---|
| **Cairn** | Trail marker of stacked stones: gentle guidance plus incremental building | A few small analytics tools |
| **Nib** | Pen tip — design vocabulary, short, sayable | Regional slang |
| **Vane** | Weathervane: points the right way, quiet and directional | Homophone with "vain" |
| **Alcove** | A small sheltered place to work — gentleness, literally | An aging/health-tech Alcove exists |
| **Gable** | Architectural, building metaphor without "Build/Ship/Forge" cliché | A real-estate Gable |
| **Poise** | Encodes calm competence without saying "easy" | Abstract; design must carry the meaning |
| **Twine** | Binding, weaving design and code together | Known interactive-fiction tool, overlapping audience |
| **Loft** | Creative studio space, friendly | Generic in co-working branding; .com likely squatted |

---

## 2. How the best pages actually read

Verbatim headlines, August 2026:

| Product | Headline | Notable |
|---|---|---|
| **Stripe** (classic) | "Payments infrastructure for the internet." | Five words: category + scope, zero adjectives. **The formula to steal.** |
| **Linear** (2019 launch) | "The issue tracking tool you'll enjoy using." | Honest category noun + one unexpected word |
| **Resend** | "The email API for developers." | No hero image at all — the sentence is precise enough |
| **Raycast** | "Your shortcut to everything." | Best line on any page here: *"It's not about saving time. It's about feeling like you're never wasting it."* |
| **Rive** | "The Interactive experience engine" | *"No mockups, no prototypes, no handoff. The real thing."* |
| **Cursor** | "Cursor is your coding agent for building ambitious software." | Opens with a mission statement, not features |
| **Figma** | "The intelligent canvas for infinite creativity" | Leads with proof (95% of the Fortune 500) before any claim |
| **Onlook** | "Cursor for Designers" / "where teams design together — directly in their real codebase" | **Our closest positional competitor** |

**Shared structure of the good ones:** hero → one differentiating claim stated as *fact, not adjective*
→ proof (screenshot, stat, logo) → 3–6 named pillars → social proof from named, checkable people →
one closing CTA. **None** uses a generic "Fast / Secure / Scalable" three-icon grid.

**Caution:** Linear, Vercel, Framer, Figma and Cursor all pivoted hard to "AI agents" messaging in
2026. That is the industry forming its own slop in real time. Use these as craft references, not copy
templates.

### Three formulas worth using

1. **Category + scope.** "[Category noun] for [specific audience]." Works because the reader never has
   to guess what the thing *is*, and one unexpected word earns the interest.
2. **Concrete negative.** Rive's "No mockups, no prototypes, no handoff." State what is *absent*
   instead of praising what is present. For developer-adjacent audiences, "revolutionary" and
   "best-in-class" measurably read as *less* credible — swap every adjective for a number or a named
   absence.
3. **Reframe — sparingly.** Raycast's "not about saving time / never wasting it" works because the
   second half is a genuinely different claim. The slop version restates the first half with more
   adjectives.

---

## 3. AI slop: the specific tells to avoid

**Words:** unleash, supercharge, elevate, seamless, revolutionize, cutting-edge, future-ready, robust,
unlock the potential, drive impact, best-in-class, game-changing, groundbreaking, "a testament to".
**Openers:** "In today's fast-paced world", "As technology continues to evolve". Sentences starting
with "Moreover". Hedges like "may help you" and "can potentially" — slop is vagueness as often as
overclaiming. Heavy em-dash use is a known LLM fingerprint.

**Structure:** vague averaged headlines ("Build the future of work", "Your all-in-one platform") that
say nothing because they are generated by averaging every SaaS headline ever written. Three feature
cards with an icon, a bold three-word title, and one generic sentence. "It's not just X, it's Y" where
Y is a synonym of X. Every section sharing the identical rhythm.

**Visuals:** Inter or Poppins because they are the most-used globally; default shadcn grays;
purple-to-blue gradient heroes; centered everything with identical card padding and radius;
glassmorphism; floating dashboard mockups at an angle; abstract 3D blobs with "a plastic quality,
slightly too smooth, slightly too symmetrical"; stock imagery of "a diverse group of people looking at
a laptop in an impossibly well-lit office". Motion tells count too — "hover states that do nothing,
buttons that snap instead of easing," or one generic fade-in everywhere.

One report found sites with AI-slop patterns converting **91% lower** than crafted pages — useful if
design investment ever needs justifying.

Sources: [Monet](https://www.monet.design/blog/posts/escape-ai-slop-landing-page-design) ·
[925studios](https://www.925studios.co/blog/ai-slop-web-design-guide) ·
[Sailop 2026 report](https://www.sailop.com/blog/ai-slop-2026-state-of-the-ai-generated-web) ·
[contentbeta word list](https://www.contentbeta.com/blog/list-of-words-overused-by-ai/)

---

## 4. Being gentle without being condescending

This is the hardest copy problem in the project. Designers are skilled professionals and will bounce
instantly from "even you can code!"

**The governing rule:** never put the audience's *lack* in the subject position of a sentence. Put
their *possession* — design judgment, taste, a Figma file — in the subject position, and make the
machinery the object being quietly handled.

Evidence for the rule:

- **Onlook** (our closest competitor) says "where teams design together — directly in their real
  codebase." No "no coding required", no "even designers can". It states *where the work happens* and
  trusts the reader to infer that this is normally a coder-only space.
- **Ivan Zhao on Figma:** "With Figma, it's easy enough for anyone to get a vision out of their head
  and onto the page for others to see." The praise centres the *vision* — the user already has taste
  and intent; the tool removes friction. It never frames the user as deficient.
- **Ivan Zhao on early Notion's failure:** "We focused too much on what we wanted to bring to the
  world. We needed to pay attention to what the world wanted from us." The fix was not softer language
  but a mundane, concrete entry point (documents) rather than pitching the ambition up front.
- **Resend and Clerk** prove simplicity by showing real syntax to an audience that recognises it,
  rather than claiming to be simple.

**The translation for us:** prove it with the artifact. Show the actual small, real change a
designer's prompt produced — the visual diff, the live preview — rather than asserting ease. And
avoid any headline of the form "you don't need to know X" or "no Y required": it defines the user by
their gap.
