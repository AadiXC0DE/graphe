# Security

Graphe runs an AI agent that reads and writes files and executes commands on your machine, for people
who cannot reasonably be expected to judge whether a command is dangerous. That makes safety a
product requirement, not a checklist item.

## The threat model

The agent is not assumed to be trustworthy. Neither is the content it reads.

A model can be wrong, can be talked into things by text inside a repository, and can misread an
instruction confidently. Every mitigation here is **mechanical** — enforced below the model, where a
persuasive sentence cannot reach it. We do not rely on the system prompt for safety.

## How execution is constrained

**Every tool call is evaluated before it runs** and resolved to one of four outcomes:

| Outcome | Applies to |
|---|---|
| **Allow** | Reading, searching, and editing files inside the project |
| **Snapshot first** | Anything destructive — the version is saved before the change happens |
| **Confirm** | Secrets, deployments, network writes, package installs, anything touching data |
| **Deny** | Anything outside the project folder, credential reads, piped-shell installs, obfuscated destructive commands |

**The policy is deny-biased.** A command it cannot confidently parse becomes a confirmation or a
refusal — never an allow. This will occasionally be annoying. That is the correct direction to be
wrong in.

**Path containment is lexical and adversarial.** Traversal, absolute paths, home expansion,
environment variables, percent-encoding, and Windows separators are all resolved before the check.

**There is no bypass.** Confirmations for destructive operations, secrets, and deployments cannot be
globally pre-approved. There is deliberately no "accept everything" mode, because that switch is the
first thing users flip and the last thing they should.

## What the boundary actually is

- **Policy layer + OS boundary, layered.** Every tool call is judged by a pure, synchronous, deny-by-default
  policy engine (`src/agent/guard/policy.ts`) that never reads model prose. Beneath that, commands run inside
  an OS boundary when the machine offers one: macOS `sandbox-exec` (Seatbelt) and Linux `bubblewrap`. The boundary
  is *proved* at startup by attempting a real escape write and checking it was refused (`src/agent/sandbox`).
  Helpers are additionally wrapped and self-probe from inside; a missing boundary is reported alongside the
  helper's answer, never silently. Helpers that write (builder role) do so only inside a private git worktree.
- **Reads are allow-listed on macOS.** Everything is denied and the places a command genuinely needs are
  named: system libraries and frameworks, certificate stores, the runtime it executes, per-user tool
  installs, and the project itself. File *names and dates* stay readable everywhere — directory traversal
  and `pwd` are impossible without that — but contents outside the list are not, so a Guard bypass no longer
  reaches `~/.ssh` or another tool's saved login. On Linux the boundary is still read-open except for private
  places, because bubblewrap has no read denial and the equivalent is a much larger change.
- **Egress is checked by address on macOS, for the agent's shell and its helpers.** Both go through a
  loopback doorway that accepts `CONNECT` only for known hosts; the profile then opens nothing else, so
  going around the doorway fails in the kernel rather than being asked not to. Extra addresses come from
  `GRAPHE_EGRESS_HOSTS`. If the doorway cannot open, the run says so rather than quietly reverting to
  reaching anything.
- **Known gaps, stated plainly.** Egress on Linux is port-only: with the network namespace shared there is
  nothing to filter with, and with it unshared the doorway is unreachable, so a proxy setting there would be
  a request the child could ignore. A server started by `keep_running` is not put behind the doorway — a dev
  server legitimately reaches many addresses, and breaking that is worse than the narrow case it would close;
  the command itself is still judged by the Guard first. **Windows has no kernel boundary at all** (Guard
  only). `sandbox-exec` is deprecated by Apple since 10.10. The single kill switch is `GRAPHE_SANDBOX=off`.
  See `src/agent/sandbox/index.ts` notes for the full list.
- **Prompt injection cannot be fully prevented.** Text inside a repository can influence the model. The
  guard is designed on the assumption that it sometimes will, which is why enforcement sits below the
  model rather than inside the prompt.
- **Secrets are kept out of version history** by default. That means restoring an old version does not
  bring old secrets back with it.

## Reporting a vulnerability

Please report privately, not as a public issue: **aadityaz2077@gmail.com**

Useful to include: what you did, what happened, and what you expected. If you have a proof of concept
that escapes the project folder or bypasses a confirmation, that is exactly the class of bug most
worth reporting, and it will be treated as the highest priority.

You will get an acknowledgement within a few days. This is a small project — please be patient with
timelines, and I will be honest with you about them.
