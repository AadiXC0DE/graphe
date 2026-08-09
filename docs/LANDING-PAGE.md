# Landing page — copy and art direction

Working from [research/04](research/04-positioning-and-naming.md). Two rules govern every line:

1. **Never put the reader's lack in the subject of a sentence.** Not "you don't need to know git."
   The subject is their design, their taste, their file. Code and deployment are objects being handled.
2. **Prove with the artifact, not the adjective.** Show the real diff, the real preview, the real
   published URL. Never claim it is simple.

Named for γραφή — *drawing*, *line*. Pair it with the descriptor in metadata and titles
("Graphe — the coding agent that starts from your design") so search intent stays clean.

---

## Hero

> # The coding agent that starts from your design.
>
> Give it a Figma file, a screenshot, or a sentence. It writes real code, shows you every change as a
> picture, and publishes when you're ready.
>
> ```
> brew install --cask graphe
> ```
> <sub>Copy · for Mac · [what's this?]</sub>
>
> <sub>Free and open source. Works with the AI subscription you already pay for.</sub>

**Why this headline:** category + scope (research/04 §2, the Stripe formula). "Starts from your
design" is the differentiator in five words — Lovable starts from a prompt, Cursor starts from a repo,
we start from the thing a designer already has. No adjective anywhere.

**Alternates worth testing:**
- "Your design, actually running."
- "Design in Figma. Ship the real thing."
- "The gentlest way to build the thing you designed."

---

## Immediately below the hero — proof, not features

A single looping screen recording, no narration, no captions: a Figma frame on the left, a live page
on the right, one sentence typed, the page updates. Real product, real speed, uncut. If it takes 40
seconds, show 40 seconds.

> **This is the whole product.** A Figma file went in. A working page came out. Nothing was
> configured.

---

## Section 1 — What it takes in

> ### It meets you where the work already is.
>
> **A Figma file.** Real tokens, real auto layout, real components — not a screenshot traced into
> absolute positioning.
>
> **A photo of paper.** Sketch it, shoot it, drop it in.
>
> **A sentence.** When there's nothing to show yet.

## Section 2 — Every change, as a picture

> ### You see what changed before you keep it.
>
> Not a wall of code. A before and after of the page itself, and a sentence describing what moved.
> Keep it or undo it — one thing at a time.
>
> The code is one click away whenever you want it. It's just never the thing you're forced to read.

*Visual: real before/after screenshots with the changed element highlighted. Not a mockup.*

## Section 3 — Nothing you do is permanent

> ### Every version is still there.
>
> It saves as you go, the way your design tools do. Scroll back through everything that happened,
> hover to see it, click to go back. Including the change you made an hour ago and regret now.
>
> Undo works. That's it. That's the feature.

*Visual: the timeline, with thumbnails. This is the emotional core of the product — give it room.*

## Section 4 — The concrete negative (Rive formula)

> ### No terminal. No git. No deploy config. No YAML.
>
> Underneath, it's an ordinary project — real code, real version history, a real repo. You can open
> it in VS Code tomorrow, or hand it to a developer, and nothing needs converting.
>
> You just never have to look at any of that to get your work online.

**This is the strongest section on the page.** It claims completeness (a tool statement) rather than
accommodation (a user statement). Compare Rive: "No mockups, no prototypes, no handoff. The real thing."

## Section 5 — Publishing

> ### One button. A real URL.
>
> Connect your Vercel, Netlify or Cloudflare account once. After that, publishing is a button, and
> the live page matches what you saw in the preview.

## Section 6 — Cost

> ### No credits. It runs on the AI subscription you already have.
>
> Connect Claude, ChatGPT or Copilot and the work goes through your own account. There's a running
> meter so you always know what you've spent, and a limit you set yourself.
>
> Nothing is metered by us, because there's no us in the middle. Graphe is free and open source, and
> there's no account to make.

**This is the strongest section on the page after Section 4, and the research says so.** Designers are
actively leaving competitors over credit burn — *"I spent over $300 to fix a simple parser bug"*,
*"64 AI credits to move a toast 50px"*, *"hiring a fulltime dev will be cheaper"*
([research/02](research/02-competitive-landscape.md) §3). Every one of those complaints is about being
billed to fix the tool's own mistakes. Consider testing it as the hero.

**Do not write the obvious version of this section.** No competitor call-outs, no pricing-table
teardown, no "unlike other tools". The restraint is the credibility — state what we do and let the
reader make the comparison.

> ⚠️ **Accuracy note for whoever builds this page:** per Pi's docs, Claude Pro/Max used through a
> third-party harness bills as metered extra usage, *not* against plan limits. This section must not
> imply "already paid for". Rewrite once each vendor's behaviour is verified — see
> [research/01](research/01-pi-agent.md) §5. Getting this wrong on a landing page is the fastest way
> to lose this audience permanently.

## Section 7 — Learning, if you want it

> ### It explains itself, only when you ask.
>
> Ask why it did something and you get a straight answer, not a lecture. Turn on **Show me** and it
> names the real thing behind each step, so the vocabulary arrives when you're curious rather than
> when you're stuck.
>
> Plenty of people never turn it on. That's fine too.

## Section 8 — Installing it

The one place on the page that has to be handled with real care. We are asking a terminal-averse
audience to open a terminal, on the landing page, before they trust us. Done badly it is the whole
funnel. Done well it is thirty seconds and a small feeling of competence.

> ### One line, once.
>
> Open Terminal — press ⌘Space, type "terminal", hit return. Paste this in and press return again.
>
> ```
> brew install --cask graphe
> ```
> **[Copy]**
>
> That's the only time you'll need it. Everything after this is a window.
>
> <sub>No Homebrew yet? [One more line, and we'll explain that too →]</sub>

**Why this copy works:**

- **"One line, once"** sets the scope before the fear arrives. The dread isn't the command, it's not
  knowing where it ends.
- **The ⌘Space instruction is not condescending** — it's the same register as telling a new colleague
  which room the meeting is in. Assume competence, supply the coordinate.
- **"That's the only time you'll need it. Everything after this is a window"** is the single most
  important sentence on the page. It converts a red flag into a one-off toll, and it is a promise the
  product actually keeps.
- **A copy button, not a "select the text" instruction.** Mis-pasting a partial command is the most
  likely first failure.

**Also build:** a short silent loop showing the paste and the app opening. Seeing it take fifteen
seconds removes more anxiety than any sentence can. And a linked page for the Homebrew prerequisite,
written in the same voice, because "command not found: brew" is the most probable point of collapse.

**Do not:** apologise for the terminal, joke about it ("don't worry, it won't bite!"), or use scare
quotes around "Terminal". Treating it as unremarkable is what makes it unremarkable.

> **Note for later:** this is the alpha route, and it is free — Homebrew installs aren't quarantined,
> so there's no Gatekeeper warning ([architecture](ARCHITECTURE.md)). When there's traction, $99/year
> to Apple buys a signed `.dmg` and this section becomes a download button.

## Closing

> ### Made by people who watched designers get stuck.
>
> Graphe is open source. Take it apart, file an issue, send a patch.
>
> **[Download for Mac]** · [GitHub] · [How it works]

---

## Art direction

**Do:**
- Real product screenshots at 1:1, straight-on. Never a floating laptop at an angle
- Show real Figma files and real generated pages — the artifact *is* the argument
- One accent colour, used sparingly. Let screenshots carry the colour
- A typeface with a point of view. Anything but Inter and Poppins (research/04 §3)
- Generous whitespace, left-aligned text, varied section rhythm
- Motion only where it explains something. Real easing, honour `prefers-reduced-motion`

**Do not:**
- Purple-to-blue gradient anything
- Glassmorphism, frosted panels, floating UI cards
- Abstract 3D blobs, or any AI-generated illustration
- A three-card icon grid of Fast / Secure / Simple
- Pulsing dots, animated "AI" sparkles, typewriter text
- Stock photography of people at laptops
- Identical padding and radius on every section — vary the rhythm deliberately

**Banned vocabulary** (full list in research/04 §3): unleash, supercharge, seamless, elevate,
revolutionize, cutting-edge, effortless, magical, game-changing, "in the age of AI", "10x", "just
describe it and watch it happen".

**Also banned, specific to us:** "even non-developers", "no coding required", "anyone can code now",
"you don't need to be technical". Every one of these defines the reader by a gap. The reader is a
professional with taste who is missing a tool, not a skill.
