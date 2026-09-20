/** Which folders somebody is working in right now.
 *
 * Two ways a folder on disk is somebody's, and a sweep may take neither: a
 * conversation is open in the folder it will write in next, and a run holds the
 * workspace it writes in for its whole length — every tool, every child and the
 * pause for an answer. Both are read here, because a sweep that kept a folder
 * and the report saying why have to give one answer: a folder left behind
 * without being named is a folder somebody has to go looking for.
 *
 * Compared as the filesystem knows the path, because a folder reached through a
 * link is the same folder. What is kept is the conversation's name, which is
 * what a person recognises — the folder's own name says nothing about who has
 * it.
 *
 * Pure: the caller reads the leases and says which conversations are open.
 */

import { canonical } from './workspace-registry';

/** A folder somebody has work in, and the conversation to name it by. */
export type LiveWriter = { folder: string; who: string };

/** The lease, as much of it as this needs: the folder, and who holds it. */
export type Leases = {
  keys(): readonly string[];
  state(key: string): { holder: { label: string } | null };
};

export type Live = {
  /** The conversation writing in this folder, or null when nobody is. */
  who: (folder: string) => string | null;
};

/**
 * The live writers in one snapshot.
 *
 * Open conversations first and the lease second, so a conversation with a run
 * going is named by the run that holds the folder rather than by the
 * conversation merely sitting in it — the run is the one writing.
 */
export function writingIn(input: {
  leases: Leases;
  open: readonly LiveWriter[];
}): Live {
  const byFolder = new Map<string, string>();
  for (const one of input.open) byFolder.set(canonical(one.folder), one.who);
  for (const key of input.leases.keys()) {
    const holder = input.leases.state(key).holder;
    if (holder !== null) byFolder.set(canonical(key), holder.label);
  }
  return { who: (folder) => byFolder.get(canonical(folder)) ?? null };
}
