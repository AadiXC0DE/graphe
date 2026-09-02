/** One model does the work; a stronger one is asked when it matters.
 *
 * The advisor itself is Pi's `pi-advisor-flow` package, not ours. It
 * registers the tool, holds the second conversation, and gives that
 * conversation no tools at all — it answers and nothing else. What lives here
 * is the words, the choice somebody makes, and the small amount of translation
 * between that choice and the settings file the package reads.
 */

import type { ModelChoice, ThinkingLevel } from '../lib/ipc';
import { byTier, type Priced } from '../lib/modeltiers';
import { THINKING_LEVELS } from '../lib/thinking';

/** The addition that does the thinking. Also on the shelf in `pi/packages.ts`. */
export const ADVISOR_PACKAGE = 'pi-advisor-flow';

/** Where the package keeps its settings, inside Pi's own folder. Somebody who
 *  wants the precise controls edits this file; we only write what we own. */
export const ADVISOR_SETTINGS_FILE = 'advisor.json';

export const advisorWords = {
  /** The row inside the model menu that leads here, and what that row says
   *  while nobody is advising. */
  name: 'Advisor',
  none: 'Off',
  note: 'One model does the work; a stronger one is asked about the hard parts, instead of paying for the stronger one all day.',
  /** The row that turns it off, which is where the list starts, and the press
   *  beside the row that says it is on. Named for what it does, because "off"
   *  is the word somebody looking for it already has. */
  off: 'Off',
  offNote: 'One model does all of it and decides for itself.',
  turnOff: 'Turn off',
  /** How long the advisor thinks. The same row, and the same word, as the one
   *  the model doing the work already has. */
  thinking: 'Thinking time',
  /** Shown until somebody has answered the question: the advising model's own
   *  setting stands, and saying a level it may not be using would be a lie. */
  thinkingUnset: 'default',
  /** The two roles the section is built from. */
  does: 'Does the work',
  advises: 'Advises',
  advisesNote: 'Asked before a plan, after repeated failures, and before it calls something done. It never touches your project.',
  /** Said before anything is offered, because until the addition is here a
   *  choice made here would quietly do nothing. */
  missing: 'The advisor comes from an addition somebody else wrote, and nothing here works until that addition is on this computer.',
  /** Named after where it lands, so the press is not a surprise. */
  missingAdd: 'Add more to Graphe',
} as const;

/** The two moments somebody can ask the advisor into, beyond the ones it takes
 *  itself. Both off: each one pauses work that was going fine. */
export const advisorSwitchWords = {
  completionGate: {
    label: 'Ask the advisor before saying it’s done',
    hint: 'A second read at the end, worth having on a change that would be hard to undo. It answers with whatever is still unproven, so expect a longer finish.',
  },
  loopGate: {
    label: 'Ask when it repeats itself',
    hint: 'Pauses for a second opinion when the same step comes round again. Running the checks a few times counts as repeating, so leave this off unless you want the pause.',
  },
} as const;

/** The notice when something installed has refused everything since. Said as
 *  what happened, with the two ways out of it. */
export const addonBlockedWords = {
  what: 'An add-on has stopped every step.',
  because: (n: number) => `${n} in a row were refused, each for the same reason.`,
  reset: 'Reset it for this conversation',
  off: 'Turn it off here',
} as const;

/** How Pi's own settings name a model: the provider, then the model. */
export function modelRef(choice: ModelChoice): string {
  return `${choice.providerId}/${choice.modelId}`;
}

/** A choice out of whatever a file held. Anything unreadable is nobody chosen,
 *  which is the off state rather than an error. */
export function asAdvisor(value: unknown): ModelChoice | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const providerId = raw['providerId'];
  const modelId = raw['modelId'];
  if (typeof providerId !== 'string' || providerId.trim() === '') return null;
  if (typeof modelId !== 'string' || modelId.trim() === '') return null;
  return { providerId, modelId };
}

/** How long the advisor thinks, out of whatever a file held. Anything the
 *  ladder does not name is nobody's answer, which is the model's own default. */
export function asAdvisorThinking(value: unknown): ThinkingLevel | null {
  return THINKING_LEVELS.find((level) => level === value) ?? null;
}

export function sameAdvisor(one: ModelChoice | null, other: ModelChoice | null): boolean {
  if (one === null || other === null) return one === other;
  return one.providerId === other.providerId && one.modelId === other.modelId;
}

/**
 * Whether there is anything here to choose between.
 *
 * An advisor from the same band as the model doing the work is the same opinion
 * twice at twice the price, so the control stays out of the way until the account
 * actually offers a step up.
 */
export function worthHaving(models: readonly Priced[]): boolean {
  return byTier(models) !== null;
}

/* -------------------------------------------------------------------------- */
/* The package's own settings                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The keys Graphe owns, written on every start.
 *
 * A file written by an older install kept its own answers for good, so a live
 * machine ran with a 15 000-character window (the package stops at the first
 * result too big for it, and answers on the omission marker), secrets travelling
 * unredacted, and a single provider hiccup refusing every tool for the rest of
 * the sitting. These nine are ours to keep right; every other key in the file
 * belongs to whoever opened it and is left exactly as it was.
 *
 * The gates are off because both fire on ordinary work — three test runs is
 * "repeating itself", and a verdict asked for at the end arrives as a list of
 * everything still unproven, which reads as "not finished".
 */
export const GRAPHE_OWNED = {
  advisorRedactSecrets: true,
  contextMaxChars: 48_000,
  advisorToolResultMaxLines: 60,
  advisorToolResultMaxBytes: 3_000,
  advisorLoopThreshold: 4,
  advisorAutoLoopGate: false,
  advisorCompletionGate: false,
  gateFailureMode: 'warn-and-continue',
  advisorBlockOnBlocked: false,
} as const;

/** Where somebody takes a key back. Anything named here Graphe stops owning and
 *  never writes again. */
const OURS = 'graphe';
const TAKEN_BACK = 'ownedOverrides';

/** The two gates somebody can turn on from the advisor row. On or off, the key
 *  stays Graphe's — this changes the value it writes, not who writes it. */
export type AdvisorSwitches = { completionGate?: boolean; loopGate?: boolean };

/** The keys somebody has taken back, out of `graphe.ownedOverrides`. */
export function ownedOverrides(existing: Record<string, unknown>): readonly string[] {
  const ours = existing[OURS];
  if (typeof ours !== 'object' || ours === null || Array.isArray(ours)) return [];
  const listed = (ours as Record<string, unknown>)[TAKEN_BACK];
  if (!Array.isArray(listed)) return [];
  return listed.filter((key): key is string => typeof key === 'string' && key !== '');
}

function ownedValues(switches?: AdvisorSwitches): Record<string, unknown> {
  return {
    ...GRAPHE_OWNED,
    advisorCompletionGate: switches?.completionGate ?? GRAPHE_OWNED.advisorCompletionGate,
    advisorAutoLoopGate: switches?.loopGate ?? GRAPHE_OWNED.advisorAutoLoopGate,
  };
}

/**
 * The file with the owned keys put right and everything else untouched.
 *
 * `changed` is what actually moved, so a caller can say what it corrected.
 */
export function reconcile(
  existing: Record<string, unknown>,
  switches?: AdvisorSwitches,
): { settings: Record<string, unknown>; changed: readonly string[] } {
  const settings: Record<string, unknown> = { ...existing };
  const theirs = new Set(ownedOverrides(existing));
  const changed: string[] = [];
  for (const [key, value] of Object.entries(ownedValues(switches))) {
    if (theirs.has(key)) continue;
    if (!(key in existing) || existing[key] !== value) changed.push(key);
    settings[key] = value;
  }
  return { settings, changed };
}

/**
 * What the advisor is given once, if the file has no answer of its own.
 *
 * Not owned: the three standing gates cover deciding, failing and finishing, and
 * miss judging — a review, an audit, a verdict on somebody else's change reaches
 * none of them, because nothing was planned, nothing failed and nothing was
 * declared done. A sentence somebody has since rewritten is theirs.
 */
const WHEN_UNSAID: Readonly<Record<string, unknown>> = {
  advisorCustomInvocation:
    'you are giving a verdict on code — a review, an audit, or a judgement on somebody else’s change; before a change that touches many files or would be hard to undo; and when what you are about to say rests on an assumption about this project you have not actually checked.',
};

/**
 * The settings file, with our choice in it and everything else left alone.
 *
 * `advisorEffort` is the package's own name for how hard the advisor thinks,
 * and it takes the same ladder of levels the rest of the app uses. Left unsaid,
 * whatever is in the file stands.
 */
export function advisorSettings(
  existing: unknown,
  choice: {
    advises: ModelChoice | null;
    does: ModelChoice | null;
    advisorThinks?: ThinkingLevel | undefined;
    switches?: AdvisorSwitches | undefined;
  },
): Record<string, unknown> {
  const kept =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};
  const { settings } = reconcile(kept, choice.switches);

  if (choice.advises === null) return { ...settings, alwaysOn: false };

  const next: Record<string, unknown> = {
    ...settings,
    advisor: modelRef(choice.advises),
    alwaysOn: true,
  };
  if (choice.does !== null) next['executor'] = modelRef(choice.does);
  if (choice.advisorThinks !== undefined) next['advisorEffort'] = choice.advisorThinks;
  // Per key, because a value already in the file is somebody's answer.
  for (const [key, value] of Object.entries(WHEN_UNSAID)) {
    if (!(key in kept)) next[key] = value;
  }
  return next;
}

/* -------------------------------------------------------------------------- */
/* Which tools came from where                                                 */
/* -------------------------------------------------------------------------- */

/** One extension as Pi's loader hands it back, in the two fields anything here
 *  reads. Kept structural so no Pi shape has to travel with it. */
export type LoadedExtension = {
  path?: string | undefined;
  resolvedPath?: string | undefined;
  tools?: ReadonlyMap<string, unknown> | undefined;
};

/**
 * Every tool the loaded extensions registered.
 *
 * Pi treats a named `tools` array as the whole allowlist, so a name missing
 * from it is a tool somebody installed and can never call.
 */
export function extensionToolNames(extensions: readonly LoadedExtension[]): readonly string[] {
  const names = new Set<string>();
  for (const one of extensions) {
    for (const name of one.tools?.keys() ?? []) {
      if (typeof name === 'string' && name !== '') names.add(name);
    }
  }
  return [...names];
}

/** Segment by segment, so `pi-advisor` never answers for `pi-advisor-flow`. */
export function fromPackage(where: string, id: string): boolean {
  return where.split(/[\\/]/).includes(id);
}

/** The advisor package's own tools — the ones this choice turns on and off. */
export function advisorToolNames(extensions: readonly LoadedExtension[]): readonly string[] {
  return extensionToolNames(
    extensions.filter((one) => fromPackage(one.resolvedPath ?? one.path ?? '', ADVISOR_PACKAGE)),
  );
}
