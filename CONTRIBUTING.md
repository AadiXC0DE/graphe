# Contributing

Contributions are welcome. A few things worth knowing before you start, because Graphe has opinions
that aren't obvious from the code.

## The audience decides everything

Graphe is for designers who are fluent in Figma and not in git. Nearly every design decision follows
from that, and the most common reason a pull request gets pushed back is that it leaks the machinery.

**Words the interface never uses:** commit, branch, merge, push, repository, terminal, deploy,
environment variable, migration, stack trace, token, context window, model names.

**What to say instead:** version, restore, project, publish, your Stripe key, data structure, "something
went wrong", money.

There are tests that fail the build if banned vocabulary reaches a user-facing string. They are not
being fussy — this is the product.

**The one exemption is `src/lib/showme.ts`.** "Show me" exists to name the real command, the real
path and the real git operation for anybody who wants them, and softening those into friendlier words
would make the feature useless and slightly patronising at the same time. So the machinery's own
vocabulary is allowed in that file and nowhere else, it is always secondary to a sentence that
already said what happened in plain language, and it is off by default. If you find yourself wanting
to put a command anywhere else, that is the signal that it belongs there instead.

## Two rules that aren't negotiable

**Safety cannot be made optional.** Confirmations for destructive operations, secrets, and deploys
must not become globally pre-approvable. If your change adds a way to switch them off, it will be
declined. See [SECURITY.md](SECURITY.md) for why.

**Never put the user's lack in the subject of a sentence.** Not "you don't need to know git." The
subject is their design and their judgment; the machinery is the object being quietly handled. This
applies to interface copy, error messages, and documentation alike.

## Working on the interface

Design tokens live in `src/styles/tokens.css`. **Use them.** Don't introduce new colours, easings,
durations, or spacing values without a reason you can defend.

Motion has a specification, and it is mostly about restraint:

- Entering or exiting → `ease-out`. Moving on screen → `ease-in-out`. Hover → `ease`.
- Nothing over 300ms. Animate only `transform` and `opacity`.
- **Anything a user sees a hundred times a day does not animate at all** — sending a message, streaming
  text, the cost meter changing. Motion is spent on the rare moments.
- Every animation ships with its `prefers-reduced-motion` counterpart. No exceptions.

Contrast must pass WCAG AA in both themes, focus states must be visible *and* attractive, and hit
areas are 44px minimum. We cannot ship an inaccessible tool that lectures people about accessibility.

Run `npm run dev` and open `/?gallery` to see every component in both themes. `npm run shot <name>`
captures it. **Look at your work before you send it** — screenshots are the acceptance test for
anything visual.

## Before you open a pull request

```bash
npm test          # all of it must pass
npm run typecheck # clean
```

New behaviour needs tests. Safety-related changes need adversarial tests — assume the model is
confused or being manipulated, and write the case that catches it.

Commit messages: plain sentences explaining *why*, not what. The diff already says what.

## Shipping it

`npm run package` builds a disk image and a zip for both Mac architectures, regenerates the
third-party licence manifest, and then opens the bundle it just made and checks it is what we meant.
The whole release procedure — versioning, tagging, the Homebrew cask, and why the app is ad-hoc
signed rather than notarized — is in [RELEASING.md](RELEASING.md).

Two things there are easy to get wrong and expensive to discover late: the agent runtime is left
external by the shell build and has to arrive through electron-builder's dependency copy, and an
unsigned app does not launch on Apple Silicon at all. `scripts/verify-package.mjs` checks both, and
a failing check means the build does not go out.

## Architecture, briefly

`src/agent/` is the only place allowed to import Pi. Everything else goes through our own types in
`src/agent/types.ts`. Pi is pre-1.0 and shipped three breaking changes in six weeks, so the blast
radius of an upgrade stays inside one module. Please keep it that way.

`src/history/` is the only place that knows git exists.

`src/cost/phrasing.ts` holds every user-facing string about money, in one file, so it can be swept.

## Good first contributions

Error translation is the most useful place to start — turning a specific ugly failure into one plain
sentence and one button that fixes it. Each one is small, self-contained, and directly removes a
moment where somebody would otherwise give up.
