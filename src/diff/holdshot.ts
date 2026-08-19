/** The copy, photographed before anybody agrees to it.
 *
 * Whatever can photograph a folder is handed in rather than reached for, so the
 * pairing, the order and the honesty run without a browser. A width that could
 * not be photographed says so and the decision is still offered: the picture is
 * what makes the answer informed, never what makes it possible.
 */

import type { Change } from '../design/gate';
import { WIDTHS, type Look, type Width } from '../design/widths';

/** One folder, at every width somebody's camera could manage. */
export type Looking = {
  looks: readonly Look[];
  /** Why there are no pictures. Already a sentence. */
  trouble?: string | null;
  /** How far each width has moved since the picture that was agreed to. Absent
   *  when no comparison was asked for, which is not the same as nothing moved. */
  changes?: readonly Change[];
};

/** Whatever can photograph a folder. Handed in so everything below can be run
 *  without a browser. `compare` asks for the changes as well; only the copy is
 *  worth comparing, and only once. */
export type Photographer = {
  look: (folder: string, compare?: boolean) => Promise<Looking>;
};

/** One width, with the two states somebody is choosing between. */
export type Sight = {
  id: string;
  name: string;
  width: number;
  /** The project as it stands. Null when it could not be photographed. */
  now: string | null;
  /** What the work made, still in the copy. Null when it could not be
   *  photographed. */
  changed: string | null;
  /** Why this width is short of a picture. Null when both came out. */
  missing: string | null;
  /** Something worth saying about this width, already a sentence. */
  trouble: string | null;
};

/** Work that has not reached the project, with the pictures of what it would
 *  do to it. */
export type Held = {
  id: string;
  /** What the work was asked to do, in the person's own words. */
  doing: string;
  /** When the pictures were taken, epoch ms. */
  at: number;
  /** Smallest width first, the way a designer reads them. */
  sights: readonly Sight[];
  /** Something true about the whole set that is not any one width. */
  note: string | null;
  /** How far each width has moved since the one that was agreed to. Empty when
   *  nothing was compared, and read as "no gate" rather than as "nothing
   *  moved" — see `src/design/gate.ts`. */
  changes: readonly Change[];
};

/* --------------------------------------------------------------------- words */

const NEITHER = 'Neither picture came out at this width.';
const NO_CHANGED = 'The changed one didn’t come out, so this is only how it looks now.';
const NO_NOW = 'There is no picture of how it looks now, so this is the change on its own.';

/** The reason of last resort, so a missing picture is never left unexplained. */
export const NOTHING_CAME_OUT =
  'This couldn’t be shown as a picture. A project that won’t build is the usual reason.';

function saysShort(now: string | null, changed: string | null): string {
  if (now === null && changed === null) return NEITHER;
  return changed === null ? NO_CHANGED : NO_NOW;
}

function lower(name: string): string {
  return name.toLowerCase();
}

function listOf(names: readonly string[]): string {
  const said = names.map(lower);
  if (said.length <= 1) return said[0] ?? '';
  return `${said.slice(0, -1).join(', ')} and ${said[said.length - 1] ?? ''}`;
}

function tidy(sentence: string | null | undefined): string | null {
  const one = (sentence ?? '').trim();
  return one === '' ? null : one;
}

/* -------------------------------------------------------------------- sights */

export type SightRequest = {
  id: string;
  name: string;
  width: number;
  now: string | null;
  changed: string | null;
  /** Why a picture is missing. Filled in when one is missing without a reason. */
  missing?: string | null;
  trouble?: string | null;
};

/** A sight, with the rule that matters held by construction: a picture that is
 *  not there and no reason for it cannot both be true. */
export function sightOf(request: SightRequest): Sight {
  const short = request.now === null || request.changed === null;
  const said = tidy(request.missing);
  return {
    id: request.id,
    name: request.name,
    width: Math.max(0, Math.round(Number.isFinite(request.width) ? request.width : 0)),
    now: request.now,
    changed: request.changed,
    missing: short ? (said ?? saysShort(request.now, request.changed)) : null,
    trouble: tidy(request.trouble),
  };
}

/* ------------------------------------------------------------------ the work */

export type HoldshotRequest = {
  photographer: Photographer;
  /** The copy the work happened in. */
  copy: string;
  /** The project as it stands, for the half somebody already knows. Null shows
   *  only what the change makes. */
  project?: string | null;
  id: string;
  doing: string;
  /** Which sizes to expect. Every one of them gets a sight, photographed or
   *  honestly not. */
  sizes?: readonly Width[];
  clock?: () => number;
};

function byId(looking: Looking | null): Map<string, Look> {
  const found = new Map<string, Look>();
  for (const look of looking?.looks ?? []) if (!found.has(look.id)) found.set(look.id, look);
  return found;
}

function anyPictures(looking: Looking): boolean {
  return looking.looks.some((look) => look.shot !== null);
}

/**
 * Photograph the copy, and the project it would replace.
 *
 * The copy goes first, and the project is only photographed when the copy came
 * out: a picture of what somebody already has, on its own, tells them nothing
 * about what they are agreeing to and costs another render of somebody's site.
 */
export async function photographHeld(request: HoldshotRequest): Promise<Held> {
  const sizes = request.sizes ?? WIDTHS;
  const clock = request.clock ?? Date.now;

  const changed = await request.photographer.look(request.copy, true);
  const project = tidy(request.project ?? null);
  const now =
    project === null || !anyPictures(changed) ? null : await request.photographer.look(project);

  const changedById = byId(changed);
  const nowById = byId(now);
  const stopgap = tidy(changed.trouble) ?? NOTHING_CAME_OUT;
  const nothing = !anyPictures(changed);

  const order = [...sizes.map((size) => size.id)];
  for (const look of [...changed.looks, ...(now?.looks ?? [])]) {
    if (!order.includes(look.id)) order.push(look.id);
  }

  const sights = order.map((id) => {
    const size = sizes.find((one) => one.id === id);
    const made = changedById.get(id);
    const was = nowById.get(id);
    return sightOf({
      id,
      name: made?.name ?? was?.name ?? size?.name ?? id,
      width: made?.width ?? was?.width ?? size?.width ?? 0,
      now: was?.shot ?? null,
      changed: made?.shot ?? null,
      // The whole folder's reason beats a per-width one when the folder is why.
      missing: nothing ? stopgap : null,
      // The copy's own, because the copy is the thing being decided about.
      trouble: made?.trouble ?? null,
    });
  });

  return {
    id: request.id,
    doing: request.doing.trim(),
    at: clock(),
    sights,
    note: nothing ? stopgap : null,
    changes: changesFor(sights, changed.changes, stopgap),
  };
}

/**
 * One reading per width somebody is being shown, however few came back.
 *
 * A folder that will not build photographs nothing and so compares nothing, and
 * an empty set reads as "nothing moved" — which would let a project that does
 * not build through without a word. Every width the person can see gets an
 * answer, and a width with no picture says so.
 */
function changesFor(
  sights: readonly Sight[],
  compared: readonly Change[] | undefined,
  stopgap: string,
): readonly Change[] {
  if (compared === undefined) return [];
  const found = new Map(compared.map((one) => [one.id, one]));
  return sights.map(
    (sight) =>
      found.get(sight.id) ?? {
        kind: 'nopicture',
        id: sight.id,
        name: sight.name,
        width: sight.width,
        why: sight.missing ?? stopgap,
      },
  );
}

/* ------------------------------------------------------------------- reading */

/** The widths nobody could photograph. */
export function whatIsMissing(held: Held): readonly Sight[] {
  return held.sights.filter((sight) => sight.changed === null);
}

/** True when there is not one picture of what the work made. The decision is
 *  offered anyway; this only decides what is said around it. */
export function nothingCameOut(held: Held): boolean {
  return !held.sights.some((sight) => sight.changed !== null);
}

/**
 * The set in one plain sentence.
 *
 * `ok` is true only when every width came out. A width that could not be
 * photographed is never quietly counted as a pass — somebody is about to say yes
 * on the strength of this.
 */
export function readsHeld(held: Held): { ok: boolean; says: string } {
  const note = tidy(held.note);
  if (held.sights.length === 0) {
    return { ok: false, says: note ?? NOTHING_CAME_OUT };
  }

  const came = held.sights.filter((sight) => sight.changed !== null);
  const lost = held.sights.filter((sight) => sight.changed === null);

  if (lost.length === 0) {
    const which = listOf(came.map((sight) => sight.name));
    return {
      ok: true,
      says:
        came.length === 1
          ? `A picture of it on the ${which}.`
          : `Pictures of it on the ${which}.`,
    };
  }

  const parts: string[] = [];
  if (came.length > 0) parts.push(`Pictures of it on the ${listOf(came.map((one) => one.name))}.`);
  if (came.length === 0) {
    parts.push(note ?? NOTHING_CAME_OUT);
  } else {
    const which = listOf(lost.map((one) => one.name));
    parts.push(
      lost.length === 1 ? `The ${which} one didn’t come out.` : `The ${which} ones didn’t come out.`,
    );
    if (note !== null) parts.push(note);
  }

  return { ok: false, says: parts.join(' ') };
}

/** Which width to open on: the widest that shows the change, because that is
 *  where the work was done. Null only when there is nothing at all. */
export function whichToShow(held: Held): Sight | null {
  const widest = (sights: readonly Sight[]): Sight | null =>
    sights.reduce<Sight | null>(
      (best, one) => (best === null || one.width > best.width ? one : best),
      null,
    );
  return (
    widest(held.sights.filter((sight) => sight.changed !== null)) ??
    widest(held.sights.filter((sight) => sight.now !== null)) ??
    widest(held.sights)
  );
}
