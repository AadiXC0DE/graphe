/** Who a piece of long-running state belongs to.
 *
 * The same conversation used to be filed under four different keys — the
 * project on its own, the project and address joined, the project with an empty
 * address for the front conversation, and a run key that looked like none of
 * them. Four spellings of one identity is four chances for a loop to write into
 * a map the loop reading it never looks at, which is how a run carries on twice
 * or not at all.
 *
 * So: one shape, one spelling, one way back. `src/lib/keys.ts` is the keyboard,
 * which is why this is not there.
 *
 * Pure. Nothing here stores anything; it only says what to file it under.
 */

/** One conversation: the project folder it is in, and which conversation within
 *  it. The front conversation — the one a project opens on — has no address of
 *  its own, so its address is the empty string. */
export type ConversationKey = { readonly project: string; readonly address: string };

/** A path can hold every other character, including spaces, tabs and newlines,
 *  so this is the only join a key always splits back out of. */
const JOIN = '\u0000';

function clean(part: string): string {
  return part.split(JOIN).join('');
}

/** The string one conversation is filed under. */
export function keyOf(project: string, address: string): string {
  return `${clean(project)}${JOIN}${clean(address)}`;
}

/** The conversation a key was made from. */
export function ownerOf(key: string): ConversationKey {
  const at = key.indexOf(JOIN);
  if (at < 0) return { project: key, address: '' };
  return { project: key.slice(0, at), address: key.slice(at + 1) };
}

export function sameOwner(a: ConversationKey, b: ConversationKey): boolean {
  return a.project === b.project && a.address === b.address;
}

/** The front conversation of a project — what project-level state falls back to
 *  when nothing said which conversation it belonged to. */
export function frontKey(project: string): string {
  return keyOf(project, '');
}

/** Whether a key names the conversation a project opens on. */
export function isFront(key: string): boolean {
  return ownerOf(key).address === '';
}
