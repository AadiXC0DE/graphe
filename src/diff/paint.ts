/** Syntax colour and word marks over the same characters.
 *
 * Two things want to decorate one line of a diff, and they do not agree about
 * where the boundaries are: the highlighter cuts on grammar, the word marks cut
 * on what actually changed. Both cuts are applied at once here, so a changed
 * argument inside a call keeps its colour and picks up the mark.
 *
 * Pure: a line, its tokens, its marks, and a list of runs out.
 */

import type { Mark } from './sidebyside';

/** One run of a line, ready to become a single span. */
export type Piece = { text: string; colour: string | null; marked: boolean };

/** A token as the highlighter hands it over. Named here so this module does not
 *  depend on the highlighter to be read or tested. */
export type Token = { text: string; colour: string | null };

function whole(tokens: readonly Token[]): number {
  let length = 0;
  for (const token of tokens) length += token.text.length;
  return length;
}

/**
 * A line cut into runs, each with its colour and whether it is inside a mark.
 *
 * Tokens that do not add up to the line are dropped rather than trusted: the
 * highlighter is asked for a hunk's worth of code at a time, and a line that
 * does not line up is a line whose colour would land on the wrong characters.
 */
export function piecesOf(
  text: string,
  tokens: readonly Token[] | null,
  marks: readonly Mark[],
): readonly Piece[] {
  if (text === '') return [];
  const usable = tokens !== null && tokens.length > 0 && whole(tokens) === text.length ? tokens : null;
  if (usable === null && marks.length === 0) return [{ text, colour: null, marked: false }];

  const cuts = new Set<number>([0, text.length]);
  if (usable !== null) {
    let at = 0;
    for (const token of usable) {
      at += token.text.length;
      if (at > 0 && at < text.length) cuts.add(at);
    }
  }
  for (const mark of marks) {
    if (mark.from > 0 && mark.from < text.length) cuts.add(mark.from);
    if (mark.to > 0 && mark.to < text.length) cuts.add(mark.to);
  }

  const edges = [...cuts].sort((one, other) => one - other);
  const out: Piece[] = [];
  let token = 0;
  let tokenEnd = usable === null ? text.length : (usable[0]?.text.length ?? text.length);

  for (let step = 0; step < edges.length - 1; step += 1) {
    const from = edges[step] ?? 0;
    const to = edges[step + 1] ?? text.length;
    while (usable !== null && from >= tokenEnd && token < usable.length - 1) {
      token += 1;
      tokenEnd += usable[token]?.text.length ?? 0;
    }
    const colour = usable === null ? null : (usable[token]?.colour ?? null);
    const marked = marks.some((mark) => from >= mark.from && to <= mark.to);
    const last = out[out.length - 1];
    if (last !== undefined && last.colour === colour && last.marked === marked) {
      last.text += text.slice(from, to);
      continue;
    }
    out.push({ text: text.slice(from, to), colour, marked });
  }
  return out;
}
