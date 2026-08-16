/** The project's memory: facts kept between sittings.
 *
 *  The store is exercised against real sql.js databases — in memory for the
 *  ranking tests, and on a real temp file for the claim that matters most:
 *  a fact written in one sitting is still there in the next. The embedding
 *  engine is a fake with hand-built vectors, so the ranking math is decided
 *  in code, not on the day's model download. */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import {
  memoryFileName,
  noEmbedder,
  openMemory,
  scoreMemory,
  type Embedder,
  type MemoryStore,
} from '../src/agent/memory';

const madeFolders: string[] = [];
afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-memory-')));
  madeFolders.push(folder);
  return folder;
}

async function store(folder: string | null): Promise<MemoryStore> {
  return openMemory({ dbPath: folder === null ? null : join(folder, 'notes.db'), embedder: noEmbedder });
}

/* ========================================================================== */
/* Writing and reading facts                                                  */
/* ========================================================================== */

describe('remembering', () => {
  it('writes a fact and reads it back', async () => {
    const memory = await store(null);
    await memory.remember({ content: 'The nav accent is #b8492c.', importance: 5, tags: ['colour'] });
    const found = await memory.recall('nav accent colour');
    expect(found.length).toBe(1);
    expect(found[0]?.content).toContain('#b8492c');
    expect(await memory.count()).toBe(1);
  });

  it('keeps a fact written in one sitting for the next', async () => {
    const folder = await newFolder();
    const first = await store(folder);
    await first.remember({ content: 'We agreed to call the version "the big one".', importance: 4 });
    await first.close();

    const second = await store(folder);
    expect(await second.count()).toBe(1);
    const found = await second.recall('the big one');
    expect(found[0]?.content).toContain('big one');
    await second.close();
  });

  it('lets a fact go, and revises one by id', async () => {
    const memory = await store(null);
    const saved = await memory.remember({ content: 'The old name.', importance: 2 });
    const revised = await memory.update(saved.id, { content: 'The new name.', importance: 5 });
    expect(revised?.content).toBe('The new name.');

    expect(await memory.forget(saved.id)).toBe(true);
    expect(await memory.forget(saved.id)).toBe(false);
    expect(await memory.count()).toBe(0);
    await memory.close();
  });

  it('names a database file per project, stable across sittings', () => {
    const name = memoryFileName('/Users/mira/Projects/portfolio');
    expect(name).toMatch(/^[0-9a-f]{12}\.db$/);
    expect(memoryFileName('/Users/mira/Projects/portfolio')).toBe(name);
    expect(memoryFileName('/Users/mira/Projects/other')).not.toBe(name);
  });
});

/* ========================================================================== */
/* Ranking                                                                    */
/* ========================================================================== */

describe('recall ranks by meaning, then freshness, then importance', () => {
  it('finds a fact whose words the question does not share, when meaning is available', async () => {
    const byText = new Map<string, number[]>([
      ['morning coffee routine', [1, 0, 0]],
      ['zebra migration patterns', [0, 0, 1]],
      // The question itself: close to the coffee fact in meaning, far from the
      // zebra one, and sharing no word with either.
      ['a warm drink at dawn', [0.9, 0.1, 0]],
    ]);
    const fake: Embedder = async (text) => byText.get(text) ?? [0, 0, 0];
    const memory = await openMemory({ dbPath: null, embedder: fake });
    await memory.remember({ content: 'morning coffee routine', importance: 3 });
    await memory.remember({ content: 'zebra migration patterns', importance: 3 });

    // The question shares no word with the coffee fact, only meaning.
    const found = await memory.recall('a warm drink at dawn');
    expect(found[0]?.content).toBe('morning coffee routine');
    await memory.close();
  });

  it('falls back to word overlap when meaning is unavailable', async () => {
    const memory = await store(null);
    await memory.remember({ content: 'grid is twelve columns', importance: 3 });
    await memory.remember({ content: 'the hero image is a photo', importance: 3 });
    const found = await memory.recall('twelve column grid');
    expect(found[0]?.content).toContain('grid is twelve columns');
  });

  it('prefers an important fact over a plain one when both match', async () => {
    const memory = await store(null);
    await memory.remember({ content: 'the build command is npm run build', importance: 1 });
    await memory.remember({ content: 'the build command is npm run build', importance: 5 });
    const found = await memory.recall('build command');
    expect(found.length).toBe(2);
    // The important one wins the tie.
    expect(found[0]?.importance).toBe(5);
  });
});

describe('the score itself', () => {
  it('is a blend of meaning, freshness and importance', () => {
    const now = Date.now();
    const fresh = scoreMemory({ content: 'alpha beta', importance: 5, createdAt: now - 1000 }, 'alpha', now, null, null);
    const old = scoreMemory({ content: 'alpha beta', importance: 1, createdAt: now - 365 * 86_400_000 }, 'alpha', now, null, null);
    expect(fresh).toBeGreaterThan(old);

    const onTopic = scoreMemory({ content: 'alpha beta', importance: 3, createdAt: now }, 'alpha', now, null, null);
    const offTopic = scoreMemory({ content: 'gamma delta', importance: 3, createdAt: now }, 'alpha', now, null, null);
    expect(onTopic).toBeGreaterThan(offTopic);
  });
});