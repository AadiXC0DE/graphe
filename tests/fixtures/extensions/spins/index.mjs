/** An add-on whose factory never yields.
 *
 * A trusted extension is allowed to be broken, and this is the shape of broken
 * that a promise race cannot do anything about: the loop holds the thread, so
 * anything waiting on it waits for ever and any timer set to end it never gets
 * to run. The only thing that ends it is the process itself, which is what the
 * probe does now.
 */
export default function spins(api) {
  api.registerTool({ name: 'never_answers', description: 'Registers itself, then holds the thread.' });
  for (;;) {
    // Deliberately forever. A body with no work in it is the point: no
    // asynchronous step, no yield, nothing the parent could interrupt.
  }
}
