/** Reading code without a language server, and renaming across it.
 *
 *  The rename writes, so the things worth protecting are the ones a write can
 *  lose: a file holding keys, a binary, something a machine generated, and the
 *  half-done sweep reported as finished. Everything runs against real files in
 *  a scratch folder, because the bugs here were all in what reached the disk.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { lspRenameTool, lspTool } from '../src/agent/pi/lsp';

let dir: string;

function write(relative: string, content: string | Buffer): void {
  const full = join(dir, relative);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

function read(relative: string): string {
  return readFileSync(join(dir, relative), 'utf8');
}

async function run(
  tool: ReturnType<typeof lspTool>,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const result = await tool.execute('call-1', params as never, signal, undefined, undefined as never);
  return result.content.find((entry) => entry.type === 'text')?.text ?? '';
}

const lsp = (maxFiles?: number): ReturnType<typeof lspTool> =>
  lspTool({ projectRoot: dir, maxFiles });
const rename = (maxFiles?: number): ReturnType<typeof lspRenameTool> =>
  lspRenameTool({ projectRoot: dir, maxFiles });

/** Grep the way the acceptance criterion greps: every file, every line. */
function occurrences(word: string, files: readonly string[]): number {
  const re = new RegExp(`\\b${word}\\b`, 'g');
  return files.reduce((total, file) => total + (read(file).match(re) ?? []).length, 0);
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graphe-lsp-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('renaming a symbol across a project', () => {
  const files = ['src/format.ts', 'src/panel.tsx', 'src/report.ts'];

  beforeEach(() => {
    write('src/format.ts', 'export function formatBytes(n: number) {\n  return `${n} B`;\n}\n');
    write('src/panel.tsx', "import { formatBytes } from './format';\nconst size = formatBytes(12);\n");
    write('src/report.ts', "import { formatBytes } from './format';\nexport const line = formatBytes(3);\n");
  });

  it('propagates across all three files, and a grep afterwards finds none', async () => {
    const said = await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(occurrences('formatBytes', files)).toBe(0);
    for (const file of files) expect(read(file)).toContain('formatFileSize');
    expect(said).toContain('3 file(s)');
    expect(said).toContain('No file I rewrite still holds "formatBytes".');
  });

  it('shows every occurrence on a preview and changes nothing', async () => {
    const said = await run(lsp(), {
      operation: 'preview',
      symbol: 'formatBytes',
      newName: 'formatFileSize',
    });

    expect(said).toContain('5 occurrence(s)');
    expect(said).toContain('src/panel.tsx');
    expect(said).toMatch(/Nothing was changed/);
    expect(occurrences('formatBytes', files)).toBe(5);
  });

  it('sends the model to the tool that writes rather than pretending to rename', async () => {
    const said = await run(lsp(), { operation: 'rename', symbol: 'formatBytes', newName: 'x' });
    expect(said).toContain('lsp_rename');
    expect(occurrences('formatBytes', files)).toBe(5);
  });
});

describe('what a rename will not touch', () => {
  it('never reads a file holding keys into the answer, and never writes one', async () => {
    write('.env', 'API_TOKEN=formatBytes-secret\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');
    const before = read('.env');

    const found = await run(lsp(), { operation: 'references', symbol: 'formatBytes' });
    expect(found).not.toContain('.env');
    expect(found).not.toContain('formatBytes-secret');

    await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });
    expect(read('.env')).toBe(before);
  });

  it('leaves a binary file byte for byte as it was', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x00, 0x01, ...Buffer.from('formatBytes'), 0x00, 0xff]);
    write('assets/blob.dat', bytes);
    write('src/format.ts', 'export const formatBytes = 1;\n');

    await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(readFileSync(join(dir, 'assets/blob.dat')).equals(bytes)).toBe(true);
  });

  it('leaves lock files and bundles alone, and says it did', async () => {
    write('package-lock.json', '{ "formatBytes": "1.0.0" }\n');
    write('public/app.min.js', 'function formatBytes(a){return a}\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    const said = await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(read('package-lock.json')).toContain('formatBytes');
    expect(read('public/app.min.js')).toContain('formatBytes');
    expect(read('src/format.ts')).toContain('formatFileSize');
    expect(said).toContain('left alone');
    expect(said).not.toContain('No file I rewrite still holds');
  });

  /* A word-boundary match finds `name` inside `"name"` as readily as inside a
     variable, and a rewritten manifest is a project that no longer builds. */
  it('never rewrites what says what the project is', async () => {
    write('package.json', '{ "name": "paper-street", "version": "1.0.0" }\n');
    write('tsconfig.json', '{ "compilerOptions": { "outDir": "dist" }, "name": "x" }\n');
    write('src/thing.ts', 'export const name = 1;\nexport const other = name + 1;\n');

    const said = await run(rename(), { symbol: 'name', newName: 'label' });

    expect(read('package.json')).toContain('"name"');
    expect(read('tsconfig.json')).toContain('"name"');
    expect(read('src/thing.ts')).toContain('label');
    expect(said).not.toContain('No file I rewrite still holds');
  });

  it('refuses a symbol too short to mean anything', async () => {
    write('src/format.ts', 'const id = 1;\nconst idx = id + 1;\n');
    const said = await run(rename(), { symbol: 'id', newName: 'key' });
    expect(said).toContain('too short');
    expect(read('src/format.ts')).toContain('const id = 1;');
  });

  it('refuses a file outside the project', async () => {
    const said = await run(lsp(), { operation: 'diagnostics', file: '../../etc/hosts' });
    expect(said).toMatch(/outside your project/i);
  });
});

describe('when it cannot finish', () => {
  it('stops the moment it is asked to and says how far it got', async () => {
    const names = Array.from({ length: 12 }, (_, at) => `src/file${String(at)}.ts`);
    for (const name of names) write(name, 'export const formatBytes = 1;\n');
    const done = (): number => names.filter((name) => read(name).includes('formatFileSize')).length;
    // Esc pressed the instant the first file lands, which is the case the walk
    // alone cannot cover: the signal has to be read inside the write loop.
    const signal = {
      get aborted() {
        return done() > 0;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;

    const said = await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' }, signal);

    expect(done()).toBe(1);
    expect(said).toContain('Stopped there: 11 file(s) still hold "formatBytes"');
    expect(said).not.toContain('No file I rewrite still holds');
  });

  it('leaves a file that changed underneath it alone, and names the one it skipped', async () => {
    const names = ['src/a.ts', 'src/b.ts', 'src/c.ts'];
    for (const name of names) write(name, 'export const formatBytes = 1;\n');
    const renamed = (name: string): boolean => read(name).includes('formatFileSize');
    const edited: string[] = [];
    // An edit lands on a file still waiting its turn, so the copy the walk took
    // of it is now a revert waiting to be written.
    const signal = {
      get aborted() {
        if (edited.length === 0 && names.some(renamed)) {
          const next = names.find((name) => !renamed(name));
          if (next !== undefined) {
            edited.push(next);
            write(next, 'export const formatBytes = 2;\n');
          }
        }
        return false;
      },
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    } as unknown as AbortSignal;

    const said = await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' }, signal);
    const [skipped = ''] = edited;

    expect(skipped).not.toBe('');
    expect(read(skipped)).toBe('export const formatBytes = 2;\n');
    expect(said).toContain(skipped);
    expect(said).toContain('changed while I was working');
    expect(said).not.toContain('No file I rewrite still holds');
  });

  it('never claims the grep is clean when it stopped walking early', async () => {
    for (let at = 0; at < 8; at++) write(`src/file${String(at)}.ts`, 'export const formatBytes = 1;\n');

    const said = await run(rename(3), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(said).not.toContain('No file I rewrite still holds');
    expect(said).toMatch(/stopped after 3 files/i);
    expect(occurrences('formatBytes', ['src/file7.ts'])).toBe(1);
  });

  it('says a search was cut short rather than answering for the whole project', async () => {
    for (let at = 0; at < 8; at++) write(`src/file${String(at)}.ts`, 'export const somethingElse = 1;\n');

    const said = await run(lsp(3), { operation: 'references', symbol: 'formatBytes' });

    expect(said).toMatch(/not the whole project/i);
  });
});

describe('what the walk skips', () => {
  it('never promises a clean grep when the name also sits in a hidden path', async () => {
    write('.github/workflows/ci.yml', 'run: node scripts/formatBytes.js\n');
    write('.eslintrc.json', '{ "rules": { "formatBytes": "off" } }\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    const said = await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(read('.github/workflows/ci.yml')).toContain('formatBytes');
    expect(read('.eslintrc.json')).toContain('formatBytes');
    expect(read('src/format.ts')).toContain('formatFileSize');
    expect(said).toMatch(/hidden paths are not walked/i);
  });

  it('leaves out folders the project already ignores', async () => {
    write('.gitignore', 'generated\n');
    write('generated/out.ts', 'export const formatBytes = 1;\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    await run(rename(), { symbol: 'formatBytes', newName: 'formatFileSize' });

    expect(read('generated/out.ts')).toContain('formatBytes');
    expect(read('src/format.ts')).toContain('formatFileSize');
  });
});
