/** One missing function in Electron's Node, patched before anything can miss it.
 *
 * Electron 33 ships Node 20.18 without `worker_threads.markAsUncloneable`.
 * undici — which Pi depends on for every network call it makes — reads that
 * function at import time, and gets `undefined`. The result is that
 * `import('@earendil-works/pi-coding-agent')` throws inside Electron and works
 * everywhere else, so the whole agent is unreachable from the desktop app and
 * perfectly fine from the tests. It is worth being precise about how that
 * presents, because it wasted an hour: the adapter catches the failure and says
 * "I could not start the part of me that does the work", which reads exactly
 * like a missing account.
 *
 * The real function marks an object so that structuredClone refuses to copy it.
 * A no-op means such objects can be cloned instead of throwing, which nothing
 * here relies on. Remove this the day Electron ships a Node that has it.
 *
 * It has to run before the first `import()` of Pi. Two processes need it: the
 * desktop shell itself, and every subagent child we spawn through
 * `ELECTRON_RUN_AS_NODE` — the child is Electron's Node, and it misses the same
 * function. Both import this from module scope, before any dynamic Pi import
 * can happen, which is early enough with room to spare.
 */

import { createRequire } from 'node:module';

export function patchWorkerThreads(): void {
  const workers = createRequire(import.meta.url)('node:worker_threads') as {
    markAsUncloneable?: (value: object) => void;
  };
  if (typeof workers.markAsUncloneable !== 'function') {
    workers.markAsUncloneable = () => {};
  }
}