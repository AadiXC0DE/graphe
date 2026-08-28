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
 * What the advisor is given, if the file has no answer of its own.
 *
 * The package walks the conversation newest first and stops at the first entry
 * too big for the window, so one 47KB file read left the advisor with an
 * omission marker and nothing else — it answered, on nothing. Capping each
 * result and widening the window keeps the walk going past a large one.
 *
 * Secrets are redacted here rather than by the Guard: the context is built
 * inside the package, out of the conversation and the working tree, so the
 * Guard's own check on the call never sees it.
 */
const WHEN_UNSAID: Readonly<Record<string, unknown>> = {
  advisorRedactSecrets: true,
  contextMaxChars: 48_000,
  advisorToolResultMaxLines: 60,
  advisorToolResultMaxBytes: 3_000,
};

/**
 * The settings file, with our choice in it and everything else left alone.
 *
 * The keys behind a control are always ours — somebody pressing the row is
 * answering the question again — and the rest of `WHEN_UNSAID` is written once
 * and never again. Which gates fire, how much of the working tree travels, how
 * many calls a sitting may make — those belong to whoever opened this file, and
 * rewriting them would be us overruling a decision somebody made deliberately.
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
  },
): Record<string, unknown> {
  const kept =
    typeof existing === 'object' && existing !== null && !Array.isArray(existing)
      ? { ...(existing as Record<string, unknown>) }
      : {};

  if (choice.advises === null) return { ...kept, alwaysOn: false };

  const next: Record<string, unknown> = {
    ...kept,
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
function fromPackage(where: string, id: string): boolean {
  return where.split(/[\\/]/).includes(id);
}

/** The advisor package's own tools — the ones this choice turns on and off. */
export function advisorToolNames(extensions: readonly LoadedExtension[]): readonly string[] {
  return extensionToolNames(
    extensions.filter((one) => fromPackage(one.resolvedPath ?? one.path ?? '', ADVISOR_PACKAGE)),
  );
}
