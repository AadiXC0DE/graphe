/** Everything about how a project looks, read from the one stylesheet.
 *
 * The panel and the design view both need the same four readings, and computing
 * them twice would mean two answers to the same question. Pure: values in,
 * findings out, nothing spawned and no file read.
 */

import { findDrift, type Finding as DriftFinding } from './drift';
import { findTrouble, type Finding as ReadFinding } from './legibility';
import { pairsToCheck, paletteFrom } from './pairs';
import { readMotion, type Motion } from '../motion/read';
import type { StyleToken, Swatch } from '../lib/ipc';

export type Styles = { file: string; tokens: readonly StyleToken[]; text: string };

export type DesignReading = {
  /** How the project moves, or null when there is no stylesheet to read. */
  motion: Motion | null;
  /** Values written by hand that were nearly one of the project's own. */
  drifted: readonly DriftFinding[];
  /** Pairings of the project's own colours that cannot be read. */
  unreadable: readonly ReadFinding[];
  /** Which token to move to repair one of those, by finding id. */
  repairs: ReadonlyMap<string, string>;
};

const NOTHING: DesignReading = {
  motion: null,
  drifted: [],
  unreadable: [],
  repairs: new Map(),
};

/**
 * Only the tokens are paired, because only a token can be moved from the panel;
 * the swatches still count as colours a repair may come out of.
 */
export function readDesign(
  styles: Styles | null,
  swatches: readonly Swatch[] = [],
): DesignReading {
  if (styles === null) return NOTHING;
  const pairs = pairsToCheck(styles.tokens);
  return {
    motion: readMotion(styles.text),
    drifted: findDrift(styles.text, styles.tokens),
    unreadable: findTrouble(
      pairs.map((one) => one.spot),
      paletteFrom([...styles.tokens, ...swatches]),
    ),
    repairs: new Map(pairs.map((one) => [one.spot.id, one.front.name])),
  };
}
