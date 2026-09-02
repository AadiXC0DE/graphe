/** Saying that the memory engine is fetching its model.
 *
 * The first recall on a new machine downloads twenty-three megabytes from
 * Hugging Face, and until now it did it in silence — a conversation that simply
 * sat there. So the store says it once, before the first ask, and only when
 * there is an engine that could be downloading anything.
 */

import { describe, expect, it } from 'vitest';

import { memoryWords, noEmbedder, openMemory, type Embedder } from '../src/agent/memory';

describe('the sentence about the download', () => {
  it('names the size and says it happens once', () => {
    expect(memoryWords.downloading).toBe(
      'Downloading a small model for memory (23 MB). This happens once.',
    );
  });

  it('is said once, before the first ask of the engine', async () => {
    const said: string[] = [];
    const engine: Embedder = async () => [0.1, 0.2, 0.3];
    const memory = await openMemory({
      dbPath: null,
      embedder: engine,
      onFirstDownload: () => said.push(memoryWords.downloading),
    });
    try {
      expect(said).toEqual([]);
      await memory.remember({ content: 'the hero image is a photograph, not a render' });
      await memory.recall('hero image');
      await memory.recall('hero image again');
      expect(said).toEqual([memoryWords.downloading]);
    } finally {
      await memory.close();
    }
  });

  it('says nothing where there is no engine to download', async () => {
    const said: string[] = [];
    const memory = await openMemory({
      dbPath: null,
      embedder: noEmbedder,
      onFirstDownload: () => said.push(memoryWords.downloading),
    });
    try {
      await memory.remember({ content: 'the nav is sticky on desktop only' });
      await memory.recall('nav');
      // The word path downloads nothing, so it has nothing to say.
      expect(said).toEqual([]);
    } finally {
      await memory.close();
    }
  });

  it('leaves recall working whether or not anybody is listening', async () => {
    const memory = await openMemory({ dbPath: null });
    try {
      await memory.remember({ content: 'the footer links go in two columns' });
      const found = await memory.recall('footer');
      expect(found.map((one) => one.content)).toContain('the footer links go in two columns');
    } finally {
      await memory.close();
    }
  });
});
