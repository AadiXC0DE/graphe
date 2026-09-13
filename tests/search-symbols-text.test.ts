/** Searching the text of a project without a language server.
 *
 *  This is a walk and a regex, so the things worth protecting are the ones a
 *  read can leak or a count can mislead about: a file holding keys, a binary, a
 *  word that also appears in prose, and a sweep reported as the whole project
 *  when it stopped early. Everything runs against real files in a scratch
 *  folder, because the bugs here were all in what came back off the disk.
 */

import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import { evaluate } from '../src/agent/guard/policy';
import { searchSymbolsTextTool } from '../src/agent/pi/search-symbols-text';
import { grapheTools } from '../src/agent/pi/tools';

const ROOT = '/tmp/agent';

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
  tool: ToolDefinition,
  params: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const result = await tool.execute('call-1', params as never, signal, undefined, undefined as never);
  return result.content.find((entry) => entry.type === 'text')?.text ?? '';
}

const search = (maxFiles?: number): ToolDefinition =>
  searchSymbolsTextTool({ projectRoot: dir, maxFiles });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graphe-search-text-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('what the model is handed', () => {
  it('is the name in the toolbox, and no tool named lsp is registered', () => {
    const names = grapheTools(ROOT, 'a-figma-token').map((one) => one.name);

    expect(names).toContain('search_symbols_text');
    expect(names).not.toContain('lsp');
    expect(names).not.toContain('lsp_rename');
  });

  it('describes itself as a text search that uses no language server', () => {
    const tool = grapheTools(ROOT, 'a-figma-token').find(
      (one) => one.name === 'search_symbols_text',
    );
    expect(tool).toBeDefined();
    const words = [
      tool?.description ?? '',
      tool?.promptSnippet ?? '',
      ...(tool?.promptGuidelines ?? []),
    ].join(' ');
    const said = words.toLowerCase();

    expect(said).toContain('text search');
    expect(said).toMatch(/no language server|not a language server/);
    // The claim this whole change exists to remove.
    expect(said).not.toMatch(/diagnostic/);
  });

  it('is read by the Guard as a search rather than as an instruction it cannot place', () => {
    const verdict = evaluate(
      { id: 'x', name: 'search_symbols_text', input: { symbol: 'formatBytes' } },
      { projectRoot: dir },
    );

    expect(verdict.kind).toBe('allow');
  });
});

describe('searching the text of a project', () => {
  beforeEach(() => {
    write('src/format.ts', 'export function formatBytes(n: number) {\n  return `${n} B`;\n}\n');
    write('src/panel.tsx', "import { formatBytes } from './format';\nconst size = formatBytes(12);\n");
    write('src/report.ts', "import { formatBytes } from './format';\nexport const line = formatBytes(3);\n");
  });

  it('finds every line a word appears on, with its file and line number', async () => {
    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).toContain('src/format.ts:1');
    expect(said).toContain('src/panel.tsx:1');
    expect(said).toContain('src/report.ts:1');
    expect(said).toContain('(5)');
  });

  it('offers lines that look like a declaration, and says that is a pattern', async () => {
    const said = await run(search(), { operation: 'definition', symbol: 'formatBytes' });

    expect(said).toContain('src/format.ts:1');
    expect(said).toMatch(/look like a declaration/i);
  });

  it('answers a rename by saying there is none here', async () => {
    const said = await run(search(), { operation: 'rename', symbol: 'formatBytes' });

    expect(said).toMatch(/no rename/i);
    expect(read('src/format.ts')).toContain('formatBytes');
  });

  it('lists the markers a file still holds', async () => {
    write('src/todo.ts', 'const a = 1; // TODO: tidy this\nconst b = 2; // FIXME later\n');

    const said = await run(search(), { operation: 'todos', file: 'src/todo.ts' });

    expect(said).toContain('src/todo.ts:1');
    expect(said).toContain('TODO');
    expect(said).toContain('FIXME');
  });

  it('says a file holds no markers rather than that it has no problems', async () => {
    write('src/clean.ts', 'export const a = 1;\n');

    const said = await run(search(), { operation: 'todos', file: 'src/clean.ts' });

    expect(said).toContain('No TODO');
    expect(said).toMatch(/not a check of it/i);
    expect(said).not.toMatch(/diagnostic/i);
  });

  it('says a search was cut short rather than answering for the whole project', async () => {
    for (let at = 0; at < 8; at++) write(`src/file${String(at)}.ts`, 'export const somethingElse = 1;\n');

    const said = await run(search(3), { operation: 'references', symbol: 'formatBytes' });

    expect(said).toMatch(/not the whole project/i);
  });

  it('finds a word in a project\'s own dotted folder', async () => {
    write('.github/workflows/ci.yml', 'run: node scripts/formatBytes.js\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).toContain('.github/workflows/ci.yml');
  });

  it('refuses a file outside the project', async () => {
    const said = await run(search(), { operation: 'todos', file: '../../etc/hosts' });
    expect(said).toMatch(/outside your project/i);
  });
});

describe('what the search never reads into the answer', () => {
  it('never reads a file holding keys, at the top or nested', async () => {
    write('.env', 'API_TOKEN=formatBytes-secret\n');
    write('apps/web/.env', 'TOKEN=formatBytes-secret\n');
    write('.ssh/id_rsa', 'formatBytes private key\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).toContain('src/format.ts:1');
    expect(said).not.toContain('formatBytes-secret');
    expect(said).not.toContain('.ssh/');
    expect(said).not.toContain('.env');
  });

  it('never reads anything inside .git', async () => {
    write('.git/config', '[remote "origin"]\n\turl = formatBytes\n');
    write('.git/HEAD', 'ref: refs/heads/formatBytes\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).not.toContain('.git/');
  });

  it('never searches a binary', async () => {
    write(
      'assets/blob.dat',
      Buffer.from([0x89, 0x50, 0x00, 0x01, ...Buffer.from('formatBytes'), 0x00, 0xff]),
    );
    write('assets/blob.png', 'formatBytes in a name only\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).not.toContain('assets/');
    expect(said).toContain('No line here holds');
  });

  it('leaves dependencies and build output out', async () => {
    write('node_modules/pkg/index.js', 'exports.formatBytes = 1;\n');
    write('dist/bundle.js', 'const formatBytes = 1;\n');
    write('.graphe/worktrees/pr-3/src/format.ts', 'export const formatBytes = 1;\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).not.toContain('node_modules');
    expect(said).not.toContain('dist/');
    expect(said).not.toContain('.graphe/');
    expect(said).toContain('src/format.ts:1');
  });

  it('leaves out folders the project already ignores', async () => {
    write('.gitignore', 'generated\n');
    write('generated/out.ts', 'export const formatBytes = 1;\n');
    write('src/format.ts', 'export const formatBytes = 1;\n');

    const said = await run(search(), { operation: 'references', symbol: 'formatBytes' });

    expect(said).not.toContain('generated/');
    expect(said).toContain('src/format.ts:1');
  });
});
