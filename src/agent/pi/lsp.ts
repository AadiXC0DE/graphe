/** Minimal LSP-like tool: diagnostics/references/definition/rename via grep.
 *
 * No language server binary is required. Diagnostics scans for TODO/FIXME,
 * references/definition walk the project and grep, rename returns a preview.
 * If a real server were available this would delegate; without one the tool
 * still works, which is the whole point of the stub.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { containsPath } from '../guard/paths';

type LspOptions = string | { projectRoot?: string; cwd?: string; root?: string };

function resolveRoot(options: LspOptions): string {
  if (typeof options === 'string') return options.trim() === '' ? process.cwd() : options;
  const raw = options.projectRoot ?? options.cwd ?? options.root ?? process.cwd();
  return raw.trim() === '' ? process.cwd() : raw;
}

const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  'out',
  'coverage',
  'vendor',
  '.pi',
  '.next',
  '.turbo',
  '.cache',
]);

const MAX_FILES = 3000;
const MAX_FILE_BYTES = 1_000_000;
const MAX_RESULTS = 200;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function walkFiles(
  root: string,
  onFile: (relative: string, content: string) => void,
  signal?: AbortSignal,
): Promise<number> {
  let count = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (count >= MAX_FILES) return;
    if (signal?.aborted) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (count >= MAX_FILES) return;
      if (signal?.aborted) return;
      if (entry.name.startsWith('.') && entry.name !== '.env' && entry.name !== '.env.example') {
        // Keep dotfiles that are not git-like? Skip hidden dirs generally
        if (entry.isDirectory()) continue;
      }
      if (SKIP_DIRS.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full, rel);
      } else if (entry.isFile()) {
        // Skip large or binary-ish by extension quickly
        // Allow any text file; skip common binaries
        if (/\.(?:png|jpg|jpeg|gif|webp|ico|pdf|zip|tar|gz|mp4|mp3|woff2?|ttf|eot)$/i.test(entry.name)) continue;
        const content = await readFile(full, 'utf8').catch(() => null);
        if (content === null) continue;
        if (content.length > MAX_FILE_BYTES) continue;
        onFile(rel, content);
        count += 1;
      }
    }
  };
  await walk(resolve(root), '');
  return count;
}

async function readDiagnostics(root: string, file: string): Promise<string> {
  const check = containsPath(root, file);
  if (!check.inside) return check.reason ?? 'This file is outside the project.';
  const resolved = check.resolved ?? resolve(root, file);
  const text = await readFile(resolved, 'utf8').catch(() => null);
  if (text === null) return `I could not read ${file}: it does not exist or cannot be read.`;
  const lines = text.split('\n');
  const hits: string[] = [];
  const re = /(TODO|FIXME|HACK|XXX|BUG)\b\s*:?\s*(.*)/i;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    const m = re.exec(line);
    if (m) hits.push(`${file}:${String(i + 1)}: ${m[1]?.toUpperCase()} ${m[2]?.trim() ?? ''}`.trim());
  }
  if (hits.length === 0) return `No diagnostics in ${file}: no TODO/FIXME found.`;
  return `Diagnostics for ${file}:\n${hits.join('\n')}`;
}

async function findReferences(
  root: string,
  symbol: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a symbol to search for.';
  const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
  const re = isIdent ? new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'g') : null;
  const hits: string[] = [];
  await walkFiles(
    root,
    (rel, content) => {
      if (hits.length >= MAX_RESULTS) return;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= MAX_RESULTS) break;
        const line = lines[i] ?? '';
        const match = re !== null ? re.test(line) : line.includes(trimmed);
        // Reset lastIndex for global
        if (re !== null) re.lastIndex = 0;
        if (match) hits.push(`${rel}:${String(i + 1)}: ${line.trim().slice(0, 200)}`);
      }
    },
    signal,
  );
  if (hits.length === 0) return `No references to "${trimmed}" found.`;
  const more = hits.length >= MAX_RESULTS ? `\n… (first ${String(MAX_RESULTS)} shown)` : '';
  return `References to "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}${more}`;
}

async function findDefinition(
  root: string,
  symbol: string,
  signal?: AbortSignal,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a symbol to search for.';
  const esc = escapeRegExp(trimmed);
  // Definition-like patterns
  const defRe = new RegExp(
    `\\b(?:function|class|interface|type|const|let|var|def|struct|enum|fn|export)\\s+${esc}\\b|\\b${esc}\\s*[:=]\\s*(?:function|\\(|=>)|\\b${esc}\\s*\\(`,
  );
  const hits: string[] = [];
  await walkFiles(
    root,
    (rel, content) => {
      if (hits.length >= MAX_RESULTS) return;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (hits.length >= MAX_RESULTS) break;
        const line = lines[i] ?? '';
        if (defRe.test(line)) hits.push(`${rel}:${String(i + 1)}: ${line.trim().slice(0, 200)}`);
      }
    },
    signal,
  );
  if (hits.length === 0) {
    // Fallback: at least show where symbol appears (grepped) and call it possible definition
    return `No definition pattern for "${trimmed}" found. Try references to see where it appears.`;
  }
  return `Definitions of "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}`;
}

async function previewRename(
  root: string,
  symbol: string,
  newName: string,
  signal?: AbortSignal,
): Promise<string> {
  const from = symbol.trim();
  const to = newName.trim();
  if (from === '' || to === '') return 'I need both the current symbol and the new name.';
  if (from === to) return 'The new name is the same as the old one, so nothing would change.';
  const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(from) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(to);
  if (!isIdent) return 'Both names should be valid identifiers (letters, numbers, underscore, not starting with a number).';
  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
  const hits: string[] = [];
  let total = 0;
  await walkFiles(
    root,
    (rel, content) => {
      if (signal?.aborted) return;
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const matches = line.match(re);
        if (matches !== null) {
          total += matches.length;
          if (hits.length < MAX_RESULTS) {
            const preview = line.replace(re, to).trim().slice(0, 200);
            hits.push(`${rel}:${String(i + 1)}: ${line.trim().slice(0, 120)}  →  ${preview}`);
          }
        }
      }
    },
    signal,
  );
  if (total === 0) return `No occurrences of "${from}" found — nothing to rename.`;
  const more = total > hits.length ? `\n… (${String(total - hits.length)} more occurrences)` : '';
  return `Rename preview: "${from}" → "${to}" — ${String(total)} occurrence(s) in project:\n${hits.join('\n')}${more}\n\nThis is a preview; no files were changed. Apply with edit after confirming.`;
}

export function lspTool(options: LspOptions): ToolDefinition {
  const projectRoot = resolveRoot(options);

  return {
    name: 'lsp',
    label: 'Code intelligence',
    description:
      'Diagnostics, references, definition and rename — grep-backed so it works without a language server. Use it to find where a symbol is used, where it is defined, what TODOs a file has, or to preview a rename.',
    promptSnippet: 'lsp(operation, file?, symbol?, newName?) — diagnostics / references / definition / rename (grep-backed)',
    promptGuidelines: [
      'Operations: diagnostics needs file; references and definition need symbol; rename needs symbol and newName.',
      'Diagnostics reads the file and reports TODO/FIXME; no server needed.',
      'References/definition walk the project and grep; rename is a preview and does not write.',
      'File paths must stay inside the project; outside paths are refused.',
    ],
    parameters: Type.Object({
      operation: Type.Optional(Type.String({ description: 'One of diagnostics, references, definition, rename.' })),
      op: Type.Optional(Type.String({ description: 'Alias for operation.' })),
      file: Type.Optional(Type.String({ description: 'File path, relative to project or absolute.' })),
      path: Type.Optional(Type.String({ description: 'Alias for file.' })),
      filePath: Type.Optional(Type.String({ description: 'Alias for file.' })),
      symbol: Type.Optional(Type.String({ description: 'Symbol to search for.' })),
      word: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      name: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      newName: Type.Optional(Type.String({ description: 'New name for rename.' })),
      to: Type.Optional(Type.String({ description: 'Alias for newName.' })),
    }),
    executionMode: 'parallel',
    execute: async (
      _callId: string,
      params: {
        operation?: string;
        op?: string;
        file?: string;
        path?: string;
        filePath?: string;
        symbol?: string;
        word?: string;
        name?: string;
        newName?: string;
        to?: string;
      },
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<unknown>> => {
      const say = (text: string): AgentToolResult<unknown> => ({
        content: [{ type: 'text', text }],
        details: {},
      });

      const opRaw = (params.operation ?? params.op ?? '').trim().toLowerCase();
      const fileRaw = (params.file ?? params.path ?? params.filePath ?? '').trim();
      const symbolRaw = (params.symbol ?? params.word ?? params.name ?? '').trim();
      const newNameRaw = (params.newName ?? params.to ?? '').trim();

      const op = opRaw === '' ? '' : opRaw;
      if (op === '') return say('I need an operation: diagnostics, references, definition, or rename.');

      // Guard: any file arg must stay inside project
      if (fileRaw !== '') {
        const check = containsPath(projectRoot, fileRaw);
        if (!check.inside) return say(check.reason ?? 'This file is outside the project, so I have left it alone.');
      }

      try {
        if (op === 'diagnostics' || op === 'diagnostic' || op === 'diag') {
          if (fileRaw === '') return say('Diagnostics needs a file path.');
          const text = await readDiagnostics(projectRoot, fileRaw);
          // If text is the outside reason, we already checked; still return
          return say(text);
        }

        if (op === 'references' || op === 'refs' || op === 'find_references' || op === 'reference') {
          if (symbolRaw === '') return say('References needs a symbol.');
          const text = await findReferences(projectRoot, symbolRaw, signal);
          return say(text);
        }

        if (op === 'definition' || op === 'def' || op === 'goto_definition' || op === 'definitions') {
          if (symbolRaw === '') return say('Definition needs a symbol.');
          const text = await findDefinition(projectRoot, symbolRaw, signal);
          return say(text);
        }

        if (op === 'rename' || op === 'rename_symbol' || op === 'renamesymbol') {
          if (symbolRaw === '' || newNameRaw === '') return say('Rename needs both symbol and newName.');
          const text = await previewRename(projectRoot, symbolRaw, newNameRaw, signal);
          return say(text);
        }

        return say(`Unknown operation "${opRaw}". Use diagnostics, references, definition, or rename.`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'something went wrong.';
        return say(`LSP operation failed: ${message}`);
      }
    },
  };
}
