/** What Electron starts, so that the shell beside it can be compiled once.
 *
 * `module.enableCompileCache` keeps V8's bytecode for whatever is compiled
 * after it, and hands it back on the next launch instead of parsing again.
 * The shell is 4.4MB of bundle and costs about 65ms to compile cold, 5ms warm.
 *
 * It has to be its own file. Turning the cache on is a statement, `import` is a
 * declaration, and declarations are hoisted — put both in one file and the
 * shell is compiled before the line that would have cached it ever runs. So the
 * shell is reached through a dynamic import, and through a specifier built at
 * run time, because a literal one is what the bundler would follow and inline.
 *
 * Never a top-level `await app.whenReady()` in here. Electron's ESM loader does
 * not drain the module graph before it fires ready, so awaiting it at the top
 * of an entry wedges the process with nothing printed. Awaiting an import is
 * fine, which is the only thing this waits for.
 */

import { enableCompileCache } from 'node:module';
import { join } from 'node:path';

import { app } from 'electron';

try {
  // Beside the app's other data, never inside the bundle: a packaged app's own
  // folder is a read-only archive, and a cache it cannot write is a slower
  // launch every time rather than a faster one after the first.
  enableCompileCache(join(app.getPath('userData'), 'compiled'));
} catch {
  // Older Node, or nowhere to write. The shell runs either way.
}

await import(new URL('./main.mjs', import.meta.url).href);
