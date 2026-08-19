/** What the window is allowed to import.
 *
 * The renderer is a browser bundle. A module it reaches that imports `node:fs`
 * or `node:path` does not fail a typecheck and does not fail a test — both run
 * in Node — it fails `vite build`, which is the last thing anybody runs and the
 * first thing nobody runs while iterating.
 *
 * That is exactly how it broke: a pure one-line helper was added to the file
 * that owns the preference store, the window imported the helper, and the store
 * brought `node:path` into the browser with it.
 */

import { readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = new URL('..', import.meta.url).pathname;

/** Everything the window pulls in, followed from its own entry points. */
function reachedFromTheWindow(): Set<string> {
  const seen = new Set<string>();
  const walk = (file: string): void => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    // `import type` is erased before the bundler sees it, so a file reached only
    // that way is never in the bundle and cannot break the build. Following it
    // reports files that are perfectly safe — which is a guard nobody trusts.
    const real = text.replace(/import\s+type\s+[^;]*?;/g, '');
    for (const m of real.matchAll(/from\s+["'](\.[^"']+)["']/g)) {
      const raw = m[1] as string;
      const base = join(file, '..', raw);
      for (const ext of ['.ts', '.tsx', '/index.ts', '/index.tsx', '']) {
        const guess = base + ext;
        try {
          if (statSync(guess).isFile()) { walk(guess); break; }
        } catch { /* not this one */ }
      }
    }
  };
  walk(join(ROOT, 'src/App.tsx'));
  return seen;
}

const NODE_ONLY = /from\s+["']node:(fs|path|os|child_process|worker_threads|net|http)/;

describe('the window’s own dependency graph', () => {
  it('finds a real graph, so a silent pass means something', () => {
    const reached = reachedFromTheWindow();
    expect(reached.size).toBeGreaterThan(40);
  });

  /** Type-only imports are erased before the bundler sees them, so a file that
   *  only hands the window a type is fine. Anything else is not. */
  it('never reaches a module that needs Node to run', () => {
    const guilty: string[] = [];
    for (const file of reachedFromTheWindow()) {
      const text = readFileSync(file, 'utf8');
      if (!NODE_ONLY.test(text)) continue;
      // `import type { X } from 'node:fs'` costs the bundle nothing.
      const real = text
        .split('\n')
        .filter((line) => NODE_ONLY.test(line) && !line.includes('import type'));
      if (real.length > 0) guilty.push(relative(ROOT, file));
    }
    expect(guilty, `these would break \`vite build\`: ${guilty.join(', ')}`).toEqual([]);
  });
});
