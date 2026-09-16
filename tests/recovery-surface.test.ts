/** A conversation whose folder is gone: how it opens, and what may be done.
 *
 * The registry has written this state down since phase 3 and nothing read it, so
 * a chat whose recorded folder had been deleted looked exactly like one whose
 * folder was there until the moment somebody opened it. The plan is explicit
 * that the two must not be confused: where the folder and its branch are both
 * gone the history opens read-only, says `Workspace unavailable`, and offers a
 * relink or an explicit continuation somewhere new — and nothing pretends the
 * files were recovered.
 *
 * What is asserted here is the decision and the words. The window's half is the
 * band drawn from `OpenedProject.unavailable`, and the shell's half is the
 * read-only branch in `CHANNEL.openConversation`, which is read below as source
 * because it needs a real Electron profile to run.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  RECOVERY_WORDS,
  WORKSPACE_UNAVAILABLE,
  isUnusable,
  unavailableFor,
  usableWhereRecorded,
  whyNotRelink,
} from "../src/work/recovery";
import {
  addConversation,
  addWorkspace,
  emptyIndex,
  ensureProject,
  verifyWorkspace,
} from "../electron/services/workspace-registry";

const here = fileURLToPath(new URL("..", import.meta.url));
const MAIN = readFileSync(`${here}electron/main.ts`, "utf8");
const APP = readFileSync(`${here}src/App.tsx`, "utf8");
const COMPOSER = readFileSync(`${here}src/components/Composer.tsx`, "utf8");

const NOW = 1_700_000_000_000;
const WORKTREE = "/work/atlas-copy";

/** A profile with one project, one worktree conversation, whose folder is gone.
 *  Written through the registry's own operations rather than by hand, so the
 *  fixture is a state the app can really reach. */
function goneFolder() {
  const project = ensureProject(emptyIndex(), "/work/atlas");
  const added = addWorkspace(project.index, {
    projectId: project.project.projectId,
    path: WORKTREE,
    kind: "worktree",
    managed: true,
    branch: "graphe/one",
    repoKey: "repo-1",
    now: NOW,
  });
  const withChat = addConversation(added.index, {
    conversationId: "chat-one",
    workspaceId: added.workspace.workspaceId,
    title: "Make the header sticky",
    now: NOW,
  });
  // The folder is not there. This is the verification the migration performs,
  // and it is what leaves the record `missing` rather than `ready`.
  const verified = verifyWorkspace(
    added.workspace,
    { present: false, repository: false, branch: null },
    NOW + 1,
  );
  return {
    record: verified,
    index: {
      ...withChat.index,
      workspaces: {
        ...withChat.index.workspaces,
        [verified.workspaceId]: verified,
      },
    },
  };
}

describe("a workspace record that cannot be opened where it says", () => {
  it("is missing rather than ready when the folder is not there", () => {
    const { record } = goneFolder();
    expect(record.state).toBe("missing");
    expect(isUnusable(record.state)).toBe(true);
  });

  it("is recovery-required, not ready, when the folder holds something else", () => {
    const { record } = goneFolder();
    const foreign = verifyWorkspace(
      { ...record, state: "ready", repoKey: "repo-1" },
      {
        present: true,
        repository: true,
        repoKey: "repo-other",
        branch: "main",
      },
      NOW + 2,
    );
    expect(foreign.state).toBe("recovery-required");
    expect(isUnusable(foreign.state)).toBe(true);
  });

  /* The sentence is what somebody acting on this actually reads, so it names
   * the folder they recognise and says the conversation is read-only. */
  it("says which folder is gone, and that nothing is written there", () => {
    const { record } = goneFolder();
    const said = unavailableFor({
      state: record.state,
      folder: record.displayPath,
    });
    expect(said?.folder).toBe(WORKTREE);
    expect(said?.because).toContain(WORKTREE);
    expect(said?.because).toContain("read-only");
    expect(RECOVERY_WORDS.heading).toBe(WORKSPACE_UNAVAILABLE);
  });

  /* Nothing to say is the ordinary case, and it must stay silent: a band on
   * every conversation is a band nobody reads. */
  it("says nothing at all for a workspace that is fine", () => {
    expect(unavailableFor({ state: "ready", folder: WORKTREE })).toBeNull();
    expect(unavailableFor(null)).toBeNull();
  });
});

describe("opening one read-only", () => {
  it("is refused where the folder is gone, and where it is another repository", () => {
    expect(
      usableWhereRecorded("missing", { present: false, sameRepository: false }),
    ).toBe(false);
    expect(
      usableWhereRecorded("ready", { present: true, sameRepository: false }),
    ).toBe(false);
    expect(
      usableWhereRecorded("recovery-required", {
        present: true,
        sameRepository: true,
      }),
    ).toBe(false);
    // The one answer that opens a session.
    expect(
      usableWhereRecorded("ready", { present: true, sameRepository: true }),
    ).toBe(true);
  });
});

describe("relinking to the folder the work is really in", () => {
  it("accepts a folder that is there and is this project", () => {
    expect(whyNotRelink({ present: true, sameRepository: true })).toBeNull();
  });

  it("refuses one that is not there, and says which", () => {
    expect(whyNotRelink({ present: false, sameRepository: false })).toContain(
      "not there",
    );
  });

  /* The refusal that matters: pointing a conversation at somebody else's
   * repository leaves the agent editing files that are not this conversation's
   * work, which is the failure the whole shell is arranged around. */
  it("refuses a folder holding a different repository, rather than editing it", () => {
    const said = whyNotRelink({ present: true, sameRepository: false });
    expect(said).toContain("not a checkout of this project");
  });
});

describe("the shell, where a profile is needed to run it", () => {
  it("checks the recorded folder before it builds anything", () => {
    const handler = MAIN.indexOf("CHANNEL.openConversation, async");
    const readOnly = MAIN.indexOf("await readOnlyOpening(path, record)");
    const built = MAIN.indexOf(
      "const started = await startConversation(open, openingFor(path, true, pressed))",
    );
    expect(readOnly).toBeGreaterThan(handler);
    expect(readOnly).toBeLessThan(built);
    // Read-only means no session at all: there is no working directory to build
    // one in, and the history comes off the disk through readTranscript.
    expect(MAIN).toContain("readTranscript(file)");
    expect(MAIN).toContain("readOnly: true");
  });

  it("carries the sentence rather than inventing one in the window", () => {
    expect(MAIN).toContain("workspaceTrouble(record)");
    expect(MAIN).toContain("unavailable: said");
  });

  /* The list is where somebody finds out before opening it. A row that reads
   * the same for a chat whose folder is gone and one whose folder is there is
   * the whole defect this repairs. */
  it("marks the row on the shelf, not only the open conversation", () => {
    expect(MAIN).toContain("const trouble = workspaceTrouble(workspace);");
    expect(MAIN).toContain(
      "...(trouble === null ? {} : { workspace: trouble }),",
    );
  });

  it("repairs the record in place rather than copying anything", () => {
    const handler = MAIN.indexOf("CHANNEL.conversationRelink");
    expect(handler).toBeGreaterThan(0);
    const body = MAIN.slice(handler, handler + 2600);
    expect(body).toContain(
      "attachConversation(workspaceIndex, asked, verified.workspaceId)",
    );
    expect(body).toContain("whyNotRelink(facts)");
    // A stale checkout row would spread the conversation out somewhere else.
    expect(body).toContain("open.held.checkouts.delete(asked)");
  });
});

describe("the window", () => {
  it("draws the band above the thread and outside it", () => {
    expect(APP).toContain("unavailable === null ? null : (");
    expect(APP).toContain("<Recovery");
    expect(APP).toContain("onRelink={() => void relinkConversation()}");
    expect(APP).toContain("onContinue={continueFromHere}");
  });

  /* Both ways forward are real operations: a relink on this conversation and a
   * continuation into a new one. Neither resolves the missing folder. */
  it("offers the folder picker and a new-workspace continuation", () => {
    expect(APP).toContain("bridge.relinkConversation(picked.value, where)");
    expect(APP).toContain('void startFrom(here.address, "continue")');
  });

  it("refuses a message from a conversation that is open read-only", () => {
    expect(APP).toContain("readOnly: unavailable.because");
    expect(COMPOSER).toContain("if (readOnly !== undefined) {");
    // Never accepted and then failed: the box says so before the press, and the
    // keyboard path takes the same door.
    expect(APP).toContain("if (unavailable !== null) return;");
  });
});
