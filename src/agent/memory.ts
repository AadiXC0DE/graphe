/** The project's memory: facts the agent keeps between sittings.
 *
 * A small SQLite store (sql.js — SQLite compiled to wasm, so there is no
 * native module to rebuild for Electron) that lives next to the app's other
 * data, one database per project. Nothing in it ever leaves the machine; the
 * whole point is that the machine is where the memory belongs.
 *
 * The agent writes facts mid-run (`remember`), pulls them back (`recall`),
 * revises them (`update`) and lets them go (`forget`). Recall ranks by meaning
 * first — cosine similarity when the embedding engine is available, word
 * overlap when it is not — then by how recent the fact is and how important
 * it was marked. The scoring weights live here once, so a test can hold the
 * ranking to account.
 *
 * Pi-free on purpose, like the rest of the layer under the tools: the engine
 * is a file on disk and a pure scoring function, testable without a session.
 */

import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import initSqlJs, { type Database } from 'sql.js';

/* -------------------------------------------------------------------------- */
/* Embeddings                                                                 */
/* -------------------------------------------------------------------------- */

/** Turns words into a vector of meaning, or says it cannot right now. The
 *  recall scorer works either way — cosine when it can, words when it cannot. */
export type Embedder = (text: string) => Promise<number[] | null>;

/** The embedder that never answers: the fallback for a machine that cannot
 *  download the model, and the stand-in for tests that want the word path. */
export const noEmbedder: Embedder = async () => null;

/** The embedding engine, loaded once and only when first needed. Transformers
 *  (onnx, wasm) — the model comes down on first use and lives in the app's
 *  cache after that. Any failure is the word path, never an error. */
let embeddingPromise: Promise<Embedder> | null = null;

async function loadTransformers(): Promise<Embedder> {
  const { env, pipeline } = (await import('@huggingface/transformers')) as {
    env?: { backends?: { onnx?: { backend?: string } } };
    pipeline: (task: string, model: string, options: unknown) => Promise<unknown>;
  };
  // Node defaults to a native onnx runtime; the wasm one needs no native module,
  // which is what an Electron app must have. Any failure here is the word path.
  try {
    if (env?.backends?.onnx !== undefined) env.backends.onnx.backend = 'web';
  } catch {
    // The wasm path it is, or no meaning engine at all.
  }
  // The pipeline is a union of many shapes; the feature-extraction one is the
  // narrow slice we use, so it is cast to that slice once, here.
  type Extractor = (text: string, options: unknown) => Promise<{ data: ArrayLike<number> }>;
  let extractor: Extractor | null = null;
  return async (text: string) => {
    try {
      extractor ??= (await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
        dtype: 'q8',
      })) as unknown as Extractor;
      const out = await extractor(text, { pooling: 'mean', normalize: true });
      return Array.from(out.data);
    } catch {
      return null;
    }
  };
}

/** The default embedder: real when it can be, the word path when it cannot. */
export function defaultEmbedder(): Embedder {
  embeddingPromise ??= loadTransformers().catch(() => noEmbedder);
  return (text: string) => embeddingPromise!.then((embed) => embed(text));
}

/* -------------------------------------------------------------------------- */
/* The store                                                                   */
/* -------------------------------------------------------------------------- */

export type Memory = {
  id: string;
  content: string;
  /** 1–5. 5 is "do not lose this". */
  importance: number;
  /** How much of what it says was verified. */
  veracity?: string;
  /** Where the fact was learned, so a fact from a page is not a fact from us. */
  source?: string;
  /** 'project' by default; 'global' memories follow the person everywhere. */
  scope: 'project' | 'global';
  tags: readonly string[];
  createdAt: number;
  updatedAt: number;
};

export type RememberInput = {
  content: string;
  importance?: number;
  veracity?: string;
  source?: string;
  scope?: 'project' | 'global';
  tags?: readonly string[];
};

/** A word or two more, so a rank that ties on the numbers has something to
 *  point at. */
function randomId(): string {
  return randomUUID().slice(0, 8);
}

function tokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, ' ')
      .split(/\s+/)
      .map((word) => word.replace(/^(?:s|es|ed|ing|ly)$/, ''))
      .filter((word) => word.length > 2),
  );
}

/** How much of the question's words the fact's words cover. */
function wordOverlap(query: string, content: string): number {
  const queryTokens = tokens(query);
  if (queryTokens.size === 0) return 0;
  const contentTokens = tokens(content);
  let hit = 0;
  for (const word of queryTokens) if (contentTokens.has(word)) hit += 1;
  return hit / queryTokens.size;
}

function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    normA += ai * ai;
    normB += bi * bi;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/** How fresh a fact still is. A week is nearly new; a year has mostly faded,
 *  but a fact marked important still outweighs that — importance is scored
 *  separately below. */
function recency(now: number, createdAt: number): number {
  const days = (now - createdAt) / 86_400_000;
  return 0.4 + 0.6 * Math.exp(-days / 45);
}

/** The whole ranking in one place: meaning (cosine when the embedder answers,
 *  word overlap when it does not), then how fresh, then how important. */
export function scoreMemory(
  memory: Pick<Memory, 'content' | 'importance' | 'createdAt'>,
  query: string,
  now: number,
  queryVector: readonly number[] | null,
  contentVector: readonly number[] | null,
): number {
  const words = wordOverlap(query, memory.content);
  const similar = queryVector !== null && contentVector !== null ? cosine(queryVector, contentVector) : words;
  const meaning = queryVector !== null ? 0.6 * similar + 0.2 * words : 0.8 * words;
  const fresh = 0.2 * recency(now, memory.createdAt);
  const weight = 0.2 * (memory.importance / 5);
  return meaning + fresh + weight;
}

export type RecallOptions = {
  limit?: number;
  scope?: 'project' | 'global';
  tag?: string;
};

export type MemoryStore = {
  remember(input: RememberInput): Promise<Memory>;
  recall(query: string, options?: RecallOptions): Promise<readonly Memory[]>;
  update(id: string, input: Partial<Pick<RememberInput, 'content' | 'importance' | 'veracity' | 'tags'>>): Promise<Memory | null>;
  forget(id: string): Promise<boolean>;
  all(): Promise<readonly Memory[]>;
  /** How many facts are kept. */
  count(): Promise<number>;
  /** Write what is pending and release the database. Awaited by tests; the
   *  app lets it run and forgets about it. */
  close(): Promise<void>;
};

/** The sql.js database, plus the embedding engine and the file it persists to.
 *  Persistence is whole-file and atomic: export the database and swap it in,
 *  so a crash mid-write cannot leave a half-written memory. */
export async function openMemory(options: { dbPath: string | null; embedder?: Embedder }): Promise<MemoryStore> {
  const SQL = await initSqlJs();
  let db: Database;
  let exists = false;
  if (options.dbPath !== null) {
    try {
      const bytes = await readFile(options.dbPath);
      db = new SQL.Database(bytes);
      exists = true;
    } catch {
      db = new SQL.Database();
    }
  } else {
    db = new SQL.Database();
  }
  db.run(`CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    importance INTEGER NOT NULL DEFAULT 3,
    veracity TEXT,
    scope TEXT NOT NULL DEFAULT 'project',
    tags TEXT NOT NULL DEFAULT '',
    source TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`);
  if (!exists) await save();

  const embedder = options.embedder ?? noEmbedder;
  const vectors = new Map<string, Promise<number[] | null>>();

  async function save(): Promise<void> {
    if (options.dbPath === null) return;
    // The export is synchronous, so the bytes are captured the moment save is
    // called — a close that follows immediately still writes the whole truth.
    const bytes = db.export();
    await mkdir(dirname(options.dbPath), { recursive: true });
    const tmp = `${options.dbPath}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, options.dbPath);
  }

  function rows(): Memory[] {
    const result = db.exec('SELECT id, content, importance, veracity, scope, tags, source, created_at, updated_at FROM memories');
    const values = result[0]?.values ?? [];
    return values.map((row: (string | number | null | Uint8Array)[]) => ({
      id: String(row[0]),
      content: String(row[1]),
      importance: Number(row[2]),
      veracity: row[3] === null ? undefined : String(row[3]),
      scope: (row[4] === 'global' ? 'global' : 'project') as Memory['scope'],
      tags: String(row[5]).split(',').filter((tag) => tag !== ''),
      source: row[6] === null ? undefined : String(row[6]),
      createdAt: Number(row[7]),
      updatedAt: Number(row[8]),
    }));
  }

  function vectorOf(memory: Memory): Promise<number[] | null> {
    let pending = vectors.get(memory.id);
    if (pending === undefined) {
      pending = embedder(memory.content).catch(() => null);
      vectors.set(memory.id, pending);
    }
    return pending;
  }

  return {
    async remember(input) {
      const now = Date.now();
      const memory: Memory = {
        id: randomId(),
        content: input.content.trim(),
        importance: Math.min(5, Math.max(1, Math.round(input.importance ?? 3))),
        veracity: input.veracity,
        source: input.source,
        scope: input.scope ?? 'project',
        tags: input.tags ?? [],
        createdAt: now,
        updatedAt: now,
      };
      db.run(
        'INSERT INTO memories (id, content, importance, veracity, scope, tags, source, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [
          memory.id,
          memory.content,
          memory.importance,
          memory.veracity ?? null,
          memory.scope,
          memory.tags.join(','),
          memory.source ?? null,
          memory.createdAt,
          memory.updatedAt,
        ],
      );
      await save();
      return memory;
    },

    async recall(query, options = {}) {
      const all = rows()
        .filter((memory) => (options.scope === undefined ? true : memory.scope === options.scope))
        .filter((memory) => (options.tag === undefined ? true : memory.tags.includes(options.tag)));
      if (all.length === 0) return [];
      const now = Date.now();
      const queryVector = query.trim() === '' ? null : await embedder(query).catch(() => null);
      const scored: { memory: Memory; score: number }[] = [];
      for (const memory of all) {
        const contentVector = queryVector === null ? null : await vectorOf(memory);
        const score = scoreMemory(memory, query, now, queryVector, contentVector);
        scored.push({ memory, score });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, options.limit ?? 6).map((entry) => entry.memory);
    },

    async update(id, input) {
      const memory = rows().find((row) => row.id === id);
      if (memory === undefined) return null;
      const now = Date.now();
      db.run(
        'UPDATE memories SET content = ?, importance = ?, veracity = ?, tags = ?, updated_at = ? WHERE id = ?',
        [
          input.content?.trim() ?? memory.content,
          input.importance === undefined ? memory.importance : Math.min(5, Math.max(1, Math.round(input.importance))),
          input.veracity ?? memory.veracity ?? null,
          input.tags?.join(',') ?? memory.tags.join(','),
          now,
          id,
        ],
      );
      vectors.delete(id);
      await save();
      return { ...memory, content: input.content?.trim() ?? memory.content, updatedAt: now };
    },

    async forget(id) {
      const before = rows().length;
      db.run('DELETE FROM memories WHERE id = ?', [id]);
      const after = rows().length;
      vectors.delete(id);
      if (before !== after) await save();
      return before !== after;
    },

    async all() {
      return rows().sort((a, b) => b.updatedAt - a.updatedAt);
    },

    async count() {
      const result = db.exec('SELECT COUNT(*) FROM memories');
      return Number(result[0]?.values[0]?.[0] ?? 0);
    },

    async close() {
      // The export is synchronous, so the bytes are captured the moment save
      // is called — nothing a close follows can be lost.
      try {
        await save();
      } catch {
        // A folder that vanished meanwhile is a lost note, not an error.
      }
      db.close();
    },
  };
}

/** A stable database file name for a project: the project's folder hashed, so
 *  two projects never share a memory and the same project always finds its own. */
export function memoryFileName(projectRoot: string): string {
  const hash = createHash('sha1').update(projectRoot).digest('hex').slice(0, 12);
  return `${hash}.db`;
}