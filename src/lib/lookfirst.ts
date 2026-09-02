/** Whether a message is the answer to a look-around, per conversation.
 *
 * A plan is followed by "now do it", and the words people reach for there are
 * the same ones that made it look around to begin with — "implement the
 * redesign", "build all of it". Judged again by the same rule, that plans the
 * plan, and the answer never gets built. So the message after a look-around
 * never triggers another, and the one after that is judged fresh. No word list
 * and no guessing at intent: the only thing remembered is that we asked.
 *
 * It used to be one boolean for the whole window, which meant a look-around in
 * one tab exempted the next message in another. It belongs to the conversation
 * that asked, and nowhere else.
 */

import { keyOf } from '../work/owner';

export type LookFirstStore = {
  /** This conversation has just been asked to look around, so its next message
   *  is the answer. */
  asked: (project: string, address: string | null) => void;
  /** Whether this message is that answer. Cleared on reading, so only the
   *  immediate answer is exempt and the one after it is judged fresh. */
  answering: (project: string, address: string | null) => boolean;
  /** What was asked for, so approving the plan sends the same sentence rather
   *  than a reconstruction of it. */
  remember: (project: string, address: string | null, text: string) => void;
  said: (project: string, address: string | null) => string;
};

export function lookFirstStore(): LookFirstStore {
  const waiting = new Set<string>();
  const words = new Map<string, string>();
  const key = (project: string, address: string | null): string => keyOf(project, address ?? '');
  return {
    asked: (project, address) => {
      waiting.add(key(project, address));
    },
    answering: (project, address) => waiting.delete(key(project, address)),
    remember: (project, address, text) => {
      words.set(key(project, address), text);
    },
    said: (project, address) => words.get(key(project, address)) ?? '',
  };
}
