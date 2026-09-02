/** What Electron starts, and why it is not the shell itself.
 *
 *  Both things asserted here fail silently if they regress. A compile cache
 *  turned on after the thing it was meant to cache has already been compiled
 *  saves nothing and says nothing; a top-level `await app.whenReady()` in an
 *  ESM entry wedges the process with no error printed at all. Neither is
 *  visible in a screenshot or a passing suite, so they are held here. */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../electron/boot.ts', import.meta.url), 'utf8');
/** The code, without the prose. The comment above it names the mistakes it is
 *  avoiding, so a search over the whole file finds them being described. */
const BOOT = SOURCE.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const BUILD = readFileSync(new URL('../scripts/build-electron.mjs', import.meta.url), 'utf8');
const MANIFEST = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
  main: string;
};

describe('the file Electron starts', () => {
  it('is the shim, not the shell', () => {
    expect(MANIFEST.main).toBe('dist-electron/boot.mjs');
    expect(BUILD).toContain('electron/boot.ts');
    expect(BUILD).toContain('dist-electron/boot.mjs');
  });

  it('turns the cache on before it reaches the shell', () => {
    expect(BOOT.indexOf('enableCompileCache')).toBeLessThan(BOOT.indexOf('await import('));
  });

  it('reaches the shell through a specifier the bundler cannot follow', () => {
    // A literal would be inlined, and an inlined shell is compiled by the same
    // pass that compiles this file — before the line above it has run.
    expect(BOOT).not.toMatch(/import\(['"]\.\/main\.mjs['"]\)/);
    expect(BOOT).toContain("new URL('./main.mjs', import.meta.url)");
  });

  it('keeps the cache out of the bundle, which cannot be written to', () => {
    expect(BOOT).toContain("app.getPath('userData')");
  });

  it('never waits on ready at the top level', () => {
    // Electron's ESM loader does not drain the module graph before it fires
    // ready, so this deadlocks with nothing printed.
    expect(BOOT).not.toMatch(/await\s+app\.whenReady\(\)/);
  });
});

describe('the model the meaning engine downloads', () => {
  const MEMORY = readFileSync(new URL('../src/agent/memory.ts', import.meta.url), 'utf8');
  const ADAPTER = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');

  it('is kept somewhere the app can actually write', () => {
    // Left alone it goes in a folder inside the package, which in a shipped app
    // is a read-only archive — so it is downloaded again on every launch, and
    // nothing says so, because every embedding failure is the word path.
    expect(MEMORY).toContain('env.cacheDir = cacheDir');
    expect(ADAPTER).toContain("defaultEmbedder(join(agentDir, 'model')");
  });
});
