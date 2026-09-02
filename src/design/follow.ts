/** Asking Figma for a file, and nothing else.
 *
 * The thin half. Everything that decides what a reading means lives in
 * `moved.ts`, which never learns that Figma is somewhere you have to go. This
 * file exists so that the one impure step — a reader that makes requests — is a
 * single narrow interface anybody can stand in for.
 */

import { parseFigmaUrl, type FigmaReader } from './figma';
import { nameOfDesign, type Design } from './moved';

/** Where a reading comes from. Implemented over the connected account, and in a
 *  test over anything at all. */
export type ReadDesign = (target: {
  fileKey: string;
  nodeId: string | null;
}) => Promise<Design>;

/** A file that has been read, and what to call it. */
export type Following = {
  fileKey: string;
  url: string;
  name: string;
  design: Design;
};

const NOT_A_LINK =
  'That is not a Figma link I can follow. Copy the address out of Figma itself, the one with the file in it, and I will try again.';

/**
 * A reading, through a connected Figma account.
 *
 * The frames come first so a failure there is the one reported: a file nobody
 * has shared fails on the frames as readably as on the values, and running the
 * two together would race two sentences for the same screen.
 */
export function throughFigma(reader: FigmaReader): ReadDesign {
  return async ({ fileKey, nodeId }) => {
    const frames = await reader.frames(fileKey, nodeId === null ? [] : [nodeId]);
    const values = await reader.tokens(fileKey);
    return { frames: frames.map(({ id, name }) => ({ id, name })), values };
  };
}

/**
 * Follow the file behind a pasted address.
 *
 * Throws the reader's own sentence when Figma will not answer — those are
 * already written for the person who pasted the link, and rewrapping them would
 * only make them worse.
 */
export async function follow(address: string, read: ReadDesign): Promise<Following> {
  const target = parseFigmaUrl(address);
  if (target === null) throw new Error(NOT_A_LINK);

  const design = await read(target);
  return {
    fileKey: target.fileKey,
    url: address.trim(),
    name: nameOfDesign(address, design.frames),
    design,
  };
}
