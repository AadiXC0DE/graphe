# Interface and motion

The audience judges software the way they judge a typeface. If the app is ugly, nothing else in this
repo matters — they will close it before they ever discover the version timeline.

Motion guidance follows Emil Kowalski's easing and duration blueprint. The rules below are not
suggestions; inconsistent motion is the single most common way an interface reads as amateur.

---

## Layout

Three regions, resizable, no floating panels:

```
┌──────────────┬───────────────────────────┬──────────┐
│              │                           │          │
│ Conversation │       Live preview        │ Timeline │
│              │                           │          │
│  what you    │   the actual thing,       │ every    │
│  asked for   │   at real size            │ version, │
│              │                           │ newest   │
│              │                           │ first    │
│ ┌──────────┐ │  ┌─────┬─────┬─────┐      │          │
│ │ cost     │ │  │phone│tablet│desk│      │ [thumb]  │
│ └──────────┘ │  └─────┴─────┴─────┘      │ [thumb]  │
└──────────────┴───────────────────────────┴──────────┘
```

**Preview is the largest region and it is never covered.** Diffs, confirmations and errors appear
*beside* it, never on top of it. The designer's work is the subject of the screen at all times — the
moment a modal covers the artwork, the app becomes about itself.

Timeline collapses to a rail. Conversation collapses. Preview never does.

---

## Visual language

**Both themes, and dark is not an afterthought.** Designers work in both; a tool that only nails one
reads as unfinished.

- **One accent colour**, used for exactly one thing at a time. The preview supplies all other colour —
  it belongs to the user's work, not to our chrome.
- **A typeface with a point of view.** Not Inter, not Poppins — they are the two most-used interface
  faces in the world and reading as generic is fatal here. Consider a grotesque with real character
  for the UI and a genuine mono for code.
- **Generous, uneven whitespace.** Identical padding everywhere is the visual signature of a template.
- **Real depth, sparingly.** One or two elevation levels. No glassmorphism, no gradient chrome.
- **Density that respects the work.** Compact enough that the preview dominates, never so tight it
  feels engineered.

**Non-negotiable:** contrast passes, focus rings are visible *and* attractive, hit areas are ≥44px,
nothing depends on colour alone. We cannot ship an inaccessible tool that lectures users about
accessibility.

---

## Motion tokens

```css
/* Entering and exiting — the default for almost everything */
--ease-out-quart: cubic-bezier(0.165, 0.84, 0.44, 1);
--ease-out-expo:  cubic-bezier(0.19, 1, 0.22, 1);

/* Something already on screen moving to a new place */
--ease-in-out-cubic: cubic-bezier(0.645, 0.045, 0.355, 1);

/* Hover and colour only */
--ease-hover: ease;

--dur-micro:  120ms;  /* button press, checkbox, toggle */
--dur-ui:     200ms;  /* tooltip, dropdown, panel */
--dur-large:  280ms;  /* drawer, sheet, view change */
```

**Rules:**

1. Entering or exiting → `ease-out`. Moving on screen → `ease-in-out`. Hover → `ease`.
2. **Nothing over 300ms.** Exits run ~20% faster than entrances.
3. **Animate only `transform` and `opacity`.** Everything else drops frames.
4. Elements that move together share timing exactly — a panel and its backdrop are one object.
5. Things appear from `scale(0.97)`, never `scale(0)`.
6. `linear` is banned except for genuinely constant motion (a progress bar).
7. Every animation ships with its `prefers-reduced-motion` counterpart. No exceptions, including opacity.

**The frequency rule, which matters most here:** anything a user sees a hundred times a day should not
animate at all. Sending a message, streaming text, the cost meter ticking — no animation. Raycast never
animates its launcher for exactly this reason. **Save motion for the rare moments that deserve it.**

---

## The moments worth animating

### Streaming a response
No animation. Text appears. Any fade or typewriter effect adds perceived latency to the single most
frequent event in the app.

### A change lands in the preview
The most important animation in the product, and it must be *reassuring* rather than impressive.
Cross-fade the preview over `200ms ease-out`, then the changed element gets one soft outline pulse
(`400ms`, once, then gone). The user's eye needs to find what moved. That is the entire job.

### Opening the visual diff
Before/after slide in together from a 8px offset, `200ms ease-out-quart`, sharing timing. The wipe
handle between them uses a spring — it is draggable, and springs stay interruptible mid-gesture.

### Scrubbing the timeline
Thumbnails are already rendered; hovering swaps the preview instantly with a `120ms` cross-fade.
**Scrubbing must feel like Figma's version history: immediate, weightless, consequence-free.** Any lag
here makes people afraid to explore, which defeats the feature.

### A confirmation appears
Slides up 12px with fade, `200ms ease-out`. Never a centred modal with a dimmed backdrop — that is the
visual grammar of an error, and these are ordinary moments. It sits beside the preview.

### Publishing
The one place to spend real motion budget, because it happens rarely and it matters emotionally.
A calm progress sequence with honest labels, then the live URL arriving with a spring
(`duration: 0.5, bounce: 0.15`). This is the payoff for everything else — let it feel like something.

### Something goes wrong
**Slower, not faster.** `280ms ease-out`, no shake, no red flash. Panic is contagious; a calm interface
during a failure is what keeps a nervous user in the product. Colour carries the severity, motion stays
gentle.

### The cost meter
Never animates. It is glanceable, always-on furniture. A number that moves draws the eye every time it
changes, which would make it a source of anxiety instead of quiet reassurance.

---

## Interactions worth getting right

- **Buttons** press to `scale(0.97)` on `:active`. It is one line and it makes the whole app feel real.
- **Hover only on real pointers** — `@media (hover: hover) and (pointer: fine)`, or touch users get
  stuck hover states.
- **Drag the diff handle, drag the timeline** — springs, because they can be interrupted.
- **Optimistic everything.** The message appears the instant it is sent.
- **Never a spinner without a sentence.** "Working…" is an apology; "Reading your Figma file" is
  information.
- **Empty states are the first screen anyone sees.** They should show what to do next in one sentence
  and one control, not an illustration of a rocket.
- **Keyboard throughout** — ⌘Z undo, ⌘K command palette, ⌘↵ send, Esc cancels the current run.

---

## Anti-patterns

These are the tells that would make a designer close the app:

| Never | Because |
|---|---|
| Purple-to-blue gradients | The universal signature of AI-generated design in 2026 |
| Glassmorphism, frosted panels | Same |
| Pulsing dots, sparkle icons, animated "AI" shimmer | Reads as decoration standing in for substance |
| Typewriter text | Fake latency on the most frequent interaction in the app |
| A modal over the preview | Makes the app the subject instead of their work |
| Bounce on ordinary UI | Playful once, irritating by the fiftieth time |
| `linear` easing | Robotic; the most common amateur tell |
| Confetti on success | Publishing is a professional act, not a game level |
| Three-card feature grids | Template grammar |
| Skeleton screens that outlast the load | More jarring than an honest blank |
| Anything over 300ms | Feels broken long before it feels smooth |

---

## How we know it's good

- Interaction to visible feedback: **under 100ms**, always.
- Preview updates hold **60fps** while streaming.
- Timeline scrubbing is **immediate** — no perceptible delay.
- Cold start to usable window: **under 2 seconds**.
- With `prefers-reduced-motion`, the app is fully usable and nothing jumps.
- Test 3.2 in the [test plan](TEST-PLAN.md) — zero reports of feeling talked down to — applies to the
  visuals as much as the copy. Condescension has a visual form: oversized rounded corners, cartoon
  illustration, and too much hand-holding all say *we think you're a beginner.*
