# What we have that nobody else does

Every item here is absent from Lovable, v0, Bolt, Figma Make, Replit, Cursor, Claude Code and Onlook
as of August 2026, and each closes a failure documented in
[research/02](research/02-competitive-landscape.md) or [research/03](research/03-designer-pain-points.md).

Ordered by how much of a reason-to-switch each one is.

---

## 1. Rewind — the undo that actually exists

**The gap:** Replit's agent deleted a production database and *"had no rollback features"* — days of
work gone permanently. Cursor "keeps breaking the other parts of the code." Every tool has chat
history; none has a real restore point.

**What we do:** a vertical timeline, newest first, thumbnail per entry, plain titles. Hover to preview
the whole project at that moment. Click to restore — **code, data and settings together.** Restoring is
itself undoable.

**Why nobody copied it:** it requires snapshotting *before* the agent acts, on every turn, which costs
disk and discipline. Hosted tools would pay for that storage; we write to the user's own disk for free.
**Being local is what makes this affordable.**

> This is the feature that makes everything else safe to try. Without it, a designer is one bad prompt
> from starting over, and they know it — which is why they stop experimenting.

## 2. Cost preflight — know before you spend

**The gap:** the loudest complaint in the entire research. *"I spent over $300 to fix a simple parser
bug."* *"64 AI credits to move a toast message down 50px."* *"50% of mine were spent on fixing errors."*
Nobody shows the price before the work, and nobody refunds you when the agent breaks its own output.

**What we do:**
- An estimate before a large task runs: roughly how many steps, roughly what it costs, based on the
  actual measured history of similar tasks.
- A running meter, always visible, never a surprise.
- A hard ceiling the user sets. It stops and asks; work is preserved.
- **Retries after the agent's own mistake are marked as such** in the meter, so the user can see when
  they're paying for a failure rather than progress.

**Why nobody copied it:** every competitor's revenue *is* the credits. Showing a designer that 40% of
their spend went on the agent's mistakes is directly against their interest. **It costs us nothing,
because we take no cut.**

**And the whole thing is expressed in money, never in jargon.** No tokens, no context windows, no
model names — a designer has no intuition for any of it and no reason to acquire one. Full design in
**[COST-DESIGN.md](COST-DESIGN.md)**, including how long conversations get handled without ever
saying the word "context".

## 3. Fidelity report — honest about what didn't survive

**The gap:** every tool oversells Figma import. Bolt's own docs tell you to switch to screenshot mode.
Figma Make ignores design tokens — confirmed by Figma's own support rep. v0 calls it *"pretty close."*
The designer finds out what broke by scrolling the page and feeling disappointed.

**What we do:** after import, a plain report. *"12 of 14 text styles mapped. 2 didn't — here they are.
Auto layout became flexbox on 9 frames; 1 used absolute positioning because the layer had mixed
constraints. Your spacing scale is 4/8/12/16 — I used it everywhere except this card."*

**Why it matters more than it sounds:** designers are trained to spot a 2px error. A tool that pretends
it was perfect loses their trust the moment they find the first flaw. A tool that says *"here are the
three things I couldn't do"* earns it permanently. **Honesty about limits is a feature, and it is free.**

## 4. Safety you cannot switch off

**The gap:** Cursor's "yolo mode" runs commands without approval, and users "whitelist commands like
`sudo`, `su`, and `rm -rf`." The blast-radius limiter is the first thing disabled by the people least
able to recover.

**What we do:** there is no yolo mode. Destructive operations, secrets, deployments and network writes
always confirm, and that cannot be globally pre-approved. Everything else — reading, searching, editing
a project file — is silent, so the confirmations that *do* appear are rare enough to be read rather
than dismissed.

**The design insight:** confirmation fatigue is what created "Accept All". The fix isn't more prompts,
it's *far fewer, better-chosen* ones. Most tools confirm too much and then let you turn it all off.

## 5. It speaks design, not code

**The gap:** *"The designer couldn't inspect or modify code directly, forcing reliance on prompt
iteration — a trial-and-error approach that consumed tokens."* Agents describe their work in code
terms; designers think in visual terms.

**What we do:**
- Changes are summarised in design language: *"Moved the button 8px down, made it your brand blue,
  added a gentle hover."* Not "modified `Button.tsx`, updated Tailwind classes."
- It understands designer vocabulary as input: *leading*, *tracking*, *optical alignment*, *8pt grid*,
  *this feels cramped*, *make it breathe*.
- **"Why did you do it that way?"** answers in one honest paragraph, without a lecture.

## 6. Preflight before publish

**The gap:** 11% of scanned indie launches leak database credentials. Lovable shipped inverted auth
logic exposing 18,000 users. `NEXT_PUBLIC_` drift silently breaks live apps. **All of it is detectable
before publishing, and nobody checks.**

**What we do:** one automatic pass before the site goes live — exposed keys, publicly readable data,
config still pointing at the preview URL, broken links, missing page titles, images without alt text,
contrast failures. Anything serious blocks; the rest is a list they can accept.

**Why nobody copied it:** it slows the moment of triumph, and growth teams hate that. It is also the
single highest-value thirty seconds in the product.

## 7. The escape hatch, built in from day one

**The gap:** Figma Make's zip export **omits `package.json` and doesn't run.** Lovable has no clean
local export. Replit loses secrets on re-import. The exits are decorative.

**What we do:** the project is an ordinary folder with ordinary git from the first second. Nothing to
export because nothing was ever trapped. Plus a generated **handoff document** — what was built, what
was decided, what's unfinished — so bringing in a developer takes an afternoon, not a rewrite.

**Why this is strategically load-bearing:** it removes the fear of commitment. A designer will try a
tool they can leave. Advertise the exit and more people walk in.

## 8. Design quality as a default, not a lint rule

**The gap:** every tool generates code that technically works and visually doesn't — *"semantic
structure turns into div soup,"* *"fixed pixels show up where layouts should flex,"* interactions and
accessibility get no consideration.

**What we do, without being asked:** focus states that are visible and attractive. Contrast that
passes. 44px minimum tap targets. Real easing curves, never `linear`. `prefers-reduced-motion`
honoured. Fluid type and spacing so it doesn't snap awkwardly between breakpoints. Semantic HTML.

**The bet:** a designer will forgive a tool that is slower, but never one that produces ugly work.
This is where taste becomes a technical requirement.

## 9. It asks before it assumes

**The gap:** context loss and over-eager agents. *"Changed sections I didn't ask it to modify."*
*"Claimed it created components when it hadn't."*

**What we do:** when a brief is genuinely ambiguous, one short clarifying question with two or three
concrete options — *rendered as visual choices where possible*, not a paragraph of questions. And a
persistent **project brief** the agent re-reads every turn, holding decisions the user has already
made, so it stops contradicting itself five messages later.

## 10. Component sense

**The gap:** generated code repeats itself endlessly, which is exactly what designers spent a decade
learning not to do.

**What we do:** notice the third time a pattern repeats and offer — *"You've used this card three
times. Want it to be one component so changing it changes all three?"* This maps onto something
designers already understand perfectly from Figma components, and it keeps the codebase sane on the
way.

---

## The through-line

| Everyone else | Us |
|---|---|
| Chat history | Restorable versions with thumbnails |
| Credits burn silently | Cost shown before, during, and attributed after |
| "Figma import ✨" | An honest report of what mapped and what didn't |
| Safety you can disable | Confirmations that are rare and non-negotiable |
| Explains in code | Explains in design |
| Ship and hope | One preflight pass before it goes live |
| Export as a checkbox | Never trapped in the first place |
| Works, but ugly | Accessible and well-made by default |

**Six of these ten cost a competitor money to build and money to run. They cost us close to nothing,
because we hold no data, take no cut, and run on the user's own machine.** That is the moat — not
"simpler", but *structurally able to do the honest thing.*
