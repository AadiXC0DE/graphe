/** The contract between the desktop shell and the window it draws.
 *
 * Both sides import this file and nothing else in common. It is deliberately
 * dependency-free apart from our own event union: the main process runs it under
 * Node, the preload runs it inside a sandbox with almost no Node at all, and the
 * renderer runs it in a browser. Anything that only works in one of those three
 * places does not belong here.
 *
 * Nothing in this file mentions Pi, and nothing ever should. The renderer is not
 * allowed to know that Pi exists (notes/strategy/ARCHITECTURE.md); this is the
 * seam that keeps that true, because it is the widest thing the renderer can
 * see.
 */

import type { AgentEvent } from '../agent/types';

/** Yes or no, from a person. Same two answers the Guard accepts, and no third. */
export type Decision = 'yes' | 'no';

/**
 * Something that went wrong, already written for a person.
 *
 * Troubles are composed in the main process, where the failure actually happens
 * and where the cause is still in hand, so the renderer never has to guess what
 * an exception meant. `details` is the one field allowed to contain the raw
 * text — it lives behind "Show technical details" and nowhere else.
 */
export type Trouble = {
  /** One sentence on what happened, in the user's terms. */
  what: string;
  /** One sentence on the likeliest reason. Honest about being a guess. */
  because: string;
  /** The label on the single button. */
  actionLabel: string;
  /** Raw text for whoever wants it. Never shown unless asked for. */
  details?: string;
};

/** Nothing on this bridge throws across the wire. A call either worked or it
 *  came back with a sentence somebody can read. An exception crossing IPC
 *  arrives as "Error invoking remote method", which is the single least useful
 *  thing we could put in front of a designer. */
export type Result<T> = { ok: true; value: T } | { ok: false; trouble: Trouble };

/** A project folder, as the window refers to it. */
export type OpenedProject = {
  /** Absolute path. Shown only if the user asks for it. */
  path: string;
  /** The folder's own name, which is what people call their project. */
  name: string;
};

/** Channel names. Namespaced so nothing else on the wire can be mistaken for
 *  ours, and centralised so preload and main cannot drift apart. */
export const CHANNEL = {
  openProject: 'graphe:open-project',
  prompt: 'graphe:prompt',
  stop: 'graphe:stop',
  answer: 'graphe:answer',
  chooseFolder: 'graphe:choose-folder',
  event: 'graphe:event',
} as const;

/**
 * Everything the window may ask the shell to do. All of it.
 *
 * There is no `invoke(channel, ...args)` here on purpose. A generic escape hatch
 * would mean the renderer — the one process that loads other people's HTML,
 * other people's CSS and, one day, other people's previews — could reach any
 * handler the main process has ever registered. Six named verbs can be read in
 * one sitting and audited in another.
 */
export type GrapheApi = {
  /** Work in this folder from now on. Replaces whatever was open before. */
  openProject(path: string): Promise<Result<OpenedProject>>;
  /** Say something to the agent. Resolves when it has finished responding. */
  prompt(text: string): Promise<Result<null>>;
  /** Stop what it is doing. Open questions are answered no. */
  stop(): Promise<Result<null>>;
  /** Answer a question the Guard asked. False when there was no such question. */
  answer(callId: string, decision: Decision): Promise<Result<boolean>>;
  /** Ask the person to pick a folder. Null when they closed the picker. */
  chooseFolder(): Promise<Result<string | null>>;
  /** Listen to the agent. Returns the function that stops listening. */
  onEvent(listener: (event: AgentEvent) => void): () => void;
};
