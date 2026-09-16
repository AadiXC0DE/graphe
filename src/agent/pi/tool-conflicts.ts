/** Two providers, one tool name.
 *
 * Graphe's own tools, an installed add-on and a bridge an add-on carries all
 * register into the same registry, and Pi keeps one definition per name without
 * saying anything. So the loser simply is not there: an add-on's tool vanishes
 * behind a built-in, or — worse — a built-in that carries the Guard is replaced
 * by somebody else's tool of the same name while every row of the transcript
 * still reads as Graphe's.
 *
 * Nothing here decides from a package name. The decision is about names, and it
 * is made before the session is built rather than discovered afterwards:
 *
 *  - the tools that carry Graphe's boundary stay Graphe's. An add-on may not
 *    take `bash` or `read`, because the Guard is attached to them.
 *  - every other name the person installed keeps theirs. Installing an add-on
 *    is an explicit act, and Graphe's convenience tool of the same name is the
 *    one that gives way.
 *  - between two add-ons, the first to ask keeps it. "First" is the order the
 *    caller read them in, written down here rather than left to whichever
 *    finished loading last.
 *
 * Either way the name itself never changes: a transcript holds tool names, and
 * an old one must still read as the tool that ran. What changes is which
 * definition is registered, and the person is told.
 */

/** The names Graphe's own boundary keeps, whichever add-on wants one of them.
 *
 * They are the tools Graphe registers into the session as its own — Pi's seven —
 * and the definitions the Guard is attached to: a foreign `bash` or `read` would
 * take that definition while every row of the transcript still read as ours.
 *
 * The Guard's tables judge far more names than these, and allow a few of
 * Graphe's own outright — `running`, `stoprunning`, `cancelbuild`, `stepdone`.
 * None of that is protected here: an add-on bringing one of those keeps it, just
 * as it keeps `task`. */
export const GRAPHE_ONLY: readonly string[] = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'];

/** One tool an add-on wants to register, and which add-on it was.
 *
 *  `where` is what that add-on is called on screen, not who it is: a global
 *  `~/.pi/extensions/lsp` and a project-local one both read as `lsp`. */
export type AddonClaim = { name: string; where: string };

/** A claim that lost a name, and where it sat in the list its caller passed in.
 *  Two add-ons can share a display name, so the position is the only thing that
 *  says which registry the name comes off. */
export type TakenClaim = AddonClaim & { at: number };

/** One name two providers wanted, whoever they were. Both sides are named, so
 *  the sentence about it can say which tool somebody will actually get. */
export type ToolConflict = {
  name: string;
  /** The add-on that keeps the name, or '' when Graphe's own tool does. */
  holder: string;
  /** The add-on whose tool was left out, or '' when Graphe's own was. */
  leftOut: string;
  /** Whether the loser is an add-on's tool, which comes off that add-on's own
   *  registry. False means what lost was one of Graphe's, which is simply not
   *  offered to the session. */
  took: boolean;
};

export type ApartTools = {
  /** Graphe's tool names that stay registered in this session. */
  mine: readonly string[];
  /** The add-ons' tool names that stay, in the order they asked. */
  theirs: readonly string[];
  /** Names an add-on's own registry loses, each with the position its claim sat
   *  at. Everything else that add-on registered is untouched. */
  took: readonly TakenClaim[];
  conflicts: readonly ToolConflict[];
};

/**
 * What each side keeps, given what each side wants.
 *
 * One pass in the order things are registered: Graphe's own names first, then
 * the add-ons. A name already kept is not kept twice, so the first claim wins —
 * except that here it is written down rather than left to load order.
 */
export function apartTools(mine: readonly string[], addons: readonly AddonClaim[]): ApartTools {
  const held = new Set<string>();
  const keptMine: string[] = [];
  for (const name of mine) {
    if (held.has(name)) continue;
    held.add(name);
    keptMine.push(name);
  }
  const ours = new Set(keptMine);

  const conflicts: ToolConflict[] = [];
  const took: TakenClaim[] = [];
  const keptTheirs: string[] = [];
  /** Which add-on first asked for a name, for when a second one asks too. */
  const firstToAsk = new Map<string, string>();
  /** Names one of Graphe's own tools gave up, which are then not registered. */
  const givenUp = new Set<string>();

  for (const [at, claim] of addons.entries()) {
    if (!held.has(claim.name)) {
      held.add(claim.name);
      firstToAsk.set(claim.name, claim.where);
      keptTheirs.push(claim.name);
      continue;
    }
    // A name the boundary carries stays Graphe's and comes off the add-on that
    // wanted it. Everything else is the add-on's — Graphe's own tool of that
    // name is the one left out, and so is a second add-on asking for a name the
    // first already keeps.
    if (GRAPHE_ONLY.includes(claim.name)) {
      took.push({ ...claim, at });
      conflicts.push({ name: claim.name, holder: '', leftOut: claim.where, took: true });
      continue;
    }
    if (ours.has(claim.name)) {
      givenUp.add(claim.name);
      firstToAsk.set(claim.name, claim.where);
      keptTheirs.push(claim.name);
      conflicts.push({ name: claim.name, holder: claim.where, leftOut: '', took: false });
      continue;
    }
    took.push({ ...claim, at });
    conflicts.push({
      name: claim.name,
      holder: firstToAsk.get(claim.name) ?? '',
      leftOut: claim.where,
      took: true,
    });
  }

  return {
    mine: keptMine.filter((name) => !givenUp.has(name)),
    theirs: keptTheirs,
    took,
    conflicts,
  };
}

/** What somebody reads when a name was wanted twice. Short, and it says which
 *  tool they will actually get — the alternative is finding out from a call
 *  that answered nothing. */
export function saysToolConflict(one: ToolConflict): string {
  if (one.leftOut === '') {
    return `${one.holder} also brings a tool called “${one.name}”, so this chat uses theirs and Graphe's own is left out. Turn that add-on off in Add-ons to get it back.`;
  }
  if (one.holder === '') {
    return `${one.leftOut} brings a tool called “${one.name}”, which is one Graphe guards itself. Its other tools still work here; this one is not loaded.`;
  }
  if (one.holder === one.leftOut) {
    // Two add-ons read the same on screen, so naming one of them would say
    // nothing about which tool this chat gets.
    return `Two add-ons both called “${one.leftOut}” bring a tool called “${one.name}”; this chat uses the one that asked first. Turn the other one off in Add-ons to get it back.`;
  }
  return `${one.leftOut} brings a tool called “${one.name}” and ${one.holder} already has one, so this chat uses ${one.holder}'s.`;
}
