# Cost, without the jargon

The loudest complaint in the entire competitive research is about money, and every quote has the same
shape: *"I spent over $300 to fix a simple parser bug."* *"64 AI credits to move a toast message down
50px."* *"50% of mine were spent on fixing errors."* *"Hiring a fulltime dev will be cheaper."*

None of those people knew what they were spending until it was gone.

**The problem isn't that AI costs money. It's that the cost is invisible, unpredictable, and expressed
in units nobody understands.** A designer has no intuition for a token, no idea what a context window
is, and no reason to learn. Asking them to reason about "context management" is like billing a client
in CPU cycles.

**Our position: the user never learns a single one of those words, and still ends up in control.**

---

## The four words we never say

| Never | Because | Say instead |
|---|---|---|
| **Token** | An arbitrary unit with no real-world referent | Money. Always money |
| **Context window** | Requires knowing how models work | "How much of this conversation it can hold" |
| **Compaction** | Implementation detail | "Tidying up so it stays quick" |
| **Model** (as a choice) | "Sonnet vs Opus" means nothing to a designer | "Quick" and "Careful" |

Everything below follows from this. If a screen needs one of the left-hand words to make sense, the
screen is wrong.

---

## 1. Money is the only unit

Every number in the product is currency, in the user's own currency, at the precision that matters.

- **₹0.40** for a small change. **₹18** for a page. Never "1,200 tokens".
- Rounded to something readable. Nobody needs four decimal places.
- The meter sits in the corner, small, permanent, and **never animates** — a number that moves draws
  the eye every time, which turns awareness into anxiety.

## 2. Tell them before, not after

The single biggest fix. Every competitor bills you and then shows you.

> **"This is a bigger job — about ₹35 and roughly four minutes. Want me to go ahead?"**
> **[Go ahead] [Do a smaller version first]**

Estimates come from measured history of similar work, not from guessing. They appear **only for large
tasks** — a threshold the user sets, defaulting to something like ₹20. Small changes just happen, or
the confirmations become noise and get dismissed reflexively, which is how "Accept All" was born.

## 3. Show them what they paid for a mistake

This is the one nobody else will ever build, because for every competitor the mistakes *are* revenue.

At the end of a session:

> **Today: ₹120**
> ₹85 building what you asked for
> ₹35 on attempts that didn't work — mostly me retrying the contact form

Radical, and it does two things at once. It builds trust that nothing else can buy, and it puts
pressure on *us* to make the agent better, because the number is public. **It also costs us nothing,
since we take no cut.**

## 4. "Quick" and "Careful", not model names

Designers should never choose between `claude-sonnet-5` and `claude-opus-5`. They should choose the
way they'd choose a pen.

> ⚡ **Quick** — for small changes and tweaks. Cheaper, nearly instant.
> ◆ **Careful** — for tricky work and big changes. Slower, costs more, thinks harder.

The app picks sensibly on its own and says so quietly: *"This one's fiddly, so I used Careful."* The
control exists for when someone wants it, not as a decision demanded up front.

## 5. Long conversations, handled without a lecture

The real driver of runaway cost is a conversation that grew huge, and "your context window is full" is
exactly the kind of sentence that makes a designer feel stupid.

What we say instead, proactively, before it becomes expensive:

> **"We've covered a lot in here. I'll tidy up my notes so things stay quick — nothing gets lost, and
> you can still scroll back through everything."**

And when a genuinely new task begins:

> **"This looks like a new thing. Starting fresh will be faster and cheaper — want to?"**
> **[Start fresh] [Keep going here]**

Behind that button is compaction and session forking. In front of it is one plain sentence. The agent
carries the project brief across automatically, so "start fresh" never means "explain everything again"
— which is the fear that keeps people in bloated conversations in the first place.

## 6. A ceiling they set, not one we impose

> **"Stop and ask me before going past ₹2,000 this month."**

When it's reached, work is preserved and the agent stops and explains. Never a hard cut mid-task
leaving a half-broken project — that's how a spending limit turns into data loss.

Sensible defaults on day one, adjustable, and a gentle nudge at 80% rather than a wall at 100%.

## 7. Runaway protection, always on

From the research: an agent *"started spawning copies of itself at 11:30pm"* and burned money
inventing fake tools while nobody watched.

- Same failure three times → stop, explain, ask. Never a fourth attempt.
- Unusual spend rate → pause and check in.
- Nothing runs unattended without a ceiling.

## 8. The honest bit about subscriptions

Pi's docs indicate Claude Pro/Max used through a third-party harness bills as **metered extra usage
rather than against plan limits**. If that holds, a user who assumes their ₹1,700/month plan covers
everything is heading for a shock — and for this audience, a surprise bill is a trust-ending event.

So the connect screen says it **before** they click, in plain words:

> **"This uses your Claude account, but it's billed separately from your monthly plan — you pay per
> use, like a taxi meter rather than a travel pass. We'll show you exactly what it costs as you go,
> and you can set a limit now."**
> **[Set a monthly limit] [I understand]**

Losing a few signups here is enormously cheaper than losing trust later. **Verify the actual behaviour
per vendor before shipping this copy** — see [research/01](research/01-pi-agent.md) §5.

---

## What this looks like in the product

| Moment | What the user sees |
|---|---|
| Connecting an account | The metered-billing explanation, and a limit they can set immediately |
| Every screen | A small, still number in the corner |
| Before a big task | An estimate and a choice |
| During a long run | Live spend, and a stop button that always works |
| After a session | Split between work and retries |
| Conversation grows long | One friendly sentence, then it handles itself |
| Approaching the ceiling | A nudge at 80%, a stop-and-ask at 100% |
| Month end | A quiet summary — what was built, what it cost |

---

## Why this is a differentiator and not a nice-to-have

Every competitor's revenue *is* the metered usage. They are structurally unable to:

- show what you spent on their agent's mistakes,
- warn you before an expensive operation,
- or recommend the cheaper model.

**We can do all three, because we make nothing either way.** Of the ten items in
[DIFFERENTIATORS](DIFFERENTIATORS.md), this is the one whose absence elsewhere is not an oversight —
it is a conflict of interest. That makes it the most durable thing we have.

---

## Testing it

Extends the [test plan](TEST-PLAN.md):

| ID | Case | Pass |
|---|---|---|
| C-01 | Full UI string sweep for "token", "context window", "compaction", raw model names | Zero occurrences outside "technical details" |
| C-02 | After a session, ask the user what they spent | ≥90% within 20% of actual |
| C-03 | Ask the user to explain, in their words, why a conversation got expensive | ≥70% substantially correct — **without** using the word token |
| C-04 | Ceiling reached mid-task | Work preserved, plain explanation, no corruption |
| C-05 | Estimate accuracy on large tasks | Within 30% of actual, ≥80% of the time |
| C-06 | Does anyone report a surprise bill? | Zero. **This is a Tier 1 failure** |
