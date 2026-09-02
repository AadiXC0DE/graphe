/** What ends up inside a shipped Graphe.
 *
 *  A packaging mistake is the quietest kind this project has: everything still
 *  builds, the tests still pass, and the only symptom is a download twice the
 *  size it needed to be, or — worse — a package the app reaches for at run time
 *  that is not there, on somebody else's laptop, three weeks later.
 *
 *  So the two halves of the claim are asserted separately. Anything the shell
 *  does not compile in has to arrive as files. Anything it does compile in must
 *  not arrive twice. */

import { describe, expect, it, vi } from 'vitest';

import { RUNTIME, carriedAlong, leaveOut } from '../scripts/what-ships.mjs';

/* Every assertion here walks node_modules, which is seconds of real disk on
   an idle machine and several times that under a full parallel run. */
vi.setConfig({ testTimeout: 30_000 });

describe('what travels with the app', () => {
  it('carries everything the shell leaves for the runtime to resolve', async () => {
    const carried = await carriedAlong();
    // Electron is the one exception: the process supplies it, so it is external
    // to the bundle and still never copied.
    for (const name of RUNTIME.filter((one) => one !== 'electron' && one !== 'onnxruntime-node')) {
      expect(carried).toContain(name);
    }
  });

  it('carries what those in turn reach for', async () => {
    // Pi is useless without its own tree, and the meaning engine cannot read a
    // model without its tokenizer.
    const carried = await carriedAlong();
    expect(carried).toContain('@huggingface/tokenizers');
    expect(carried).toContain('onnxruntime-web');
  });

  it('leaves behind what the window already has compiled into it', async () => {
    const dropped = await leaveOut();
    // Representative rather than exhaustive: these are the largest, and Vite
    // puts every one of them inside dist/ before packaging starts.
    for (const name of ['react-icons', 'mermaid', 'shiki', 'katex', 'cytoscape', 'react-dom']) {
      expect(dropped).toContain(`!node_modules/${name}`);
    }
  });

  it('leaves behind the native onnx runtime nothing ever loads', async () => {
    // src/agent/memory.ts sets the backend to 'web' before it asks for anything.
    const carried = await carriedAlong();
    expect(carried).not.toContain('onnxruntime-node');
    expect(carried).not.toContain('sharp');
    expect(carried.filter((name) => name.startsWith('@img/'))).toEqual([]);
  });

  it('never both carries and leaves behind the same thing', async () => {
    const carried = new Set(await carriedAlong());
    const whole = (await leaveOut()).filter((line) => !line.includes('/**/*'));
    for (const line of whole) {
      const name = line.replace('!node_modules/', '');
      // The per-file trimmings sit inside a package that is carried; only the
      // whole-package exclusions are a contradiction.
      if (name.includes('/dist/')) continue;
      expect(carried.has(name)).toBe(false);
    }
  });

  it('keeps the builds those packages actually import', async () => {
    const dropped = await leaveOut();
    // sql.js resolves to dist/sql-wasm.js, which reads dist/sql-wasm.wasm from
    // beside itself. Everything else in there is a spare build.
    expect(dropped).not.toContain('!node_modules/sql.js/dist/sql-wasm.js');
    expect(dropped).not.toContain('!node_modules/sql.js/dist/sql-wasm.wasm');
    expect(dropped).toContain('!node_modules/sql.js/dist/sql-asm.js');
    // Every target in onnxruntime-web's exports map is a minified build.
    expect(dropped.filter((line) => line.includes('onnxruntime-web') && line.includes('.min.'))).toEqual([]);
    expect(dropped).toContain('!node_modules/onnxruntime-web/dist/ort.all.js');
  });
});

describe('the packaging config', () => {
  it('leaves the shell source maps out of the download', async () => {
    const { default: packaging } = await import('../electron-builder.js');
    expect((await packaging()).files).toContain('!dist-electron/*.map');
  });

  it('asks for the exclusions to be worked out rather than written down', async () => {
    const { default: packaging } = await import('../electron-builder.js');
    const files = (await packaging()).files as string[];
    // If this ever collapses to a handful, the list has been hand-edited and
    // will be stale the next time Pi changes its dependencies.
    expect(files.filter((one) => one.startsWith('!node_modules/')).length).toBeGreaterThan(100);
  });
});
