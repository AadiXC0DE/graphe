/** Several designs of the same thing, held so they can be compared.
 *
 * A person asks for variations in plain words — "give me 4 designs for this
 * card" — and gets back a set: each variation named after what it is, each
 * rendered from its own isolated folder, none of them touching the real work.
 * This module is the pure shape of that set: how a request becomes names, which
 * variation is in front, and what the strip in the pane shows. Everything that
 * touches a disk (making the folders, building and serving them) lives outside
 * it, exactly like the rest of the preview layer.
 */

/** One variation, in front of the person looking. */
export type Variation = {
  /** Ours, short and stable, so switching names it and nothing else is needed. */
  id: string;
  /** What it is, said plainly: "Minimal and clean". */
  name: string;
  /** The served address reading this variation, or null before it is ready. */
  address: string | null;
};

/** A finished set. Empty until a request has actually been made. */
export type VariationSet = {
  /** The thing being varied, so the strip can stand against it. */
  subject: string;
  /** The variations, in the order they were asked for. */
  variations: readonly Variation[];
  /** Which one is being looked at now; empty when none is. */
  inFront: string | null;
};

/** A name somebody asked for — a sentence, or nothing when they said nothing. */
export type VariationRequest = {
  /** The designed name: "Minimal and clean". */
  name: string;
  /** The instruction that goes with this variation, for whoever makes it. */
  brief: string;
};

/** An id both readable and safe in a URL and a folder: lowercased words joined
 *  by hyphens, taken from the name. "Minimal and clean" → `minimal-and-clean`. */
export function variationId(name: string): string {
  const kept = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
  return kept === '' ? 'variation' : kept.slice(0, 40);
}

/** The one sentence under the strip: how many there are, and which is open. */
export function stripSays(set: VariationSet): string {
  const count = set.variations.length;
  if (count === 0) return 'Nothing to compare yet.';
  const open = set.inFront === null ? null : set.variations.find((one) => one.id === set.inFront);
  if (open === null || open === undefined)
    return `${count} ${count === 1 ? 'variation' : 'variations'} to compare.`;
  return `${open.name}, one of ${count}.`;
}

/** Put one variation in front. Unknown ids are let go rather than guessed. */
export function frontOf(set: VariationSet, id: string | null): VariationSet {
  if (id === null || set.variations.some((one) => one.id === id)) {
    return { ...set, inFront: id };
  }
  return set;
}

/** A fresh set from the shapes a person actually asked for. The original
 *  subject stays; the variations are the request's own, in order, none ready
 *  until a folder has been served for it. */
export function setFrom(subject: string, requested: readonly VariationRequest[]): VariationSet {
  const seen = new Set<string>();
  const variations: Variation[] = [];
  for (const one of requested) {
    let id = variationId(one.name);
    let n = 2;
    while (seen.has(id)) {
      const suffix = n.toString();
      id = `${variationId(one.name)}-${suffix}`;
      n += 1;
    }
    seen.add(id);
    variations.push({ id, name: one.name, address: null });
  }
  return { subject, variations, inFront: variations.length === 0 ? null : (variations[0]?.id ?? null) };
}
