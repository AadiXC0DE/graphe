/** Text search over a project's own files: every line a word appears on, the
 *  lines that look like a declaration, and the TODO markers in one file.
 *
 * This is a walk and a regex, not a language server. A word that also appears
 * in prose or a comment matches here too, and "definition" is a text pattern
 * rather than what a compiler knows. The names say so, and anything needing
 * real semantics belongs to an installed language server.
 *
 * Reads only: there is no built-in rename. Rewriting every match of a word
 * would change the ones that are a different thing with the same spelling, and
 * a tool that cannot tell them apart must not write.
 */

import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { containsPath, isCredentialPath } from '../guard/paths';

type SearchOptions =
  | string
  | { projectRoot?: string; cwd?: string; root?: string; maxFiles?: number };

function resolveRoot(options: SearchOptions): string {
  if (typeof options === 'string') return options.trim() === '' ? process.cwd() : options;
  const raw = options.projectRoot ?? options.cwd ?? options.root ?? process.cwd();
  return raw.trim() === '' ? process.cwd() : raw;
}

/** Never walked. Dependencies, build output, and the dotted folders that are
 *  tooling state rather than a project's own configuration. */
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
  '.graphe',
  '.hg',
  '.svn',
  '.idea',
  '.yarn',
  '.pnpm-store',
  '.parcel-cache',
  '.nuxt',
  '.svelte-kit',
  '.vercel',
  '.terraform',
  '.gradle',
  '.dart_tool',
  '.venv',
  '.tox',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
]);

const MAX_FILES = 3000;
/** Characters, not bytes: this is the length `readFile` hands back. */
const MAX_FILE_CHARS = 1_000_000;
const MAX_RESULTS = 200;

/** A quick skip before opening anything, so a walk does not read a film into
 *  memory to find out it is a film. The content check below is the one that
 *  decides. */
const BINARY_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|ico|icns|pdf|zip|tar|gz|bz2|xz|7z|rar|mp[34]|mov|avi|mkv|wav|flac|ogg|woff2?|ttf|otf|eot|wasm|node|so|dylib|dll|exe|a|o|class|jar|sqlite3?|db|parquet|pack|idx|psd|sketch|fig)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** `readFile(…, 'utf8')` does not throw on binary. It substitutes U+FFFD, which
 *  would otherwise be searched for words that cannot be in it. */
function looksBinary(content: string): boolean {
  return content.slice(0, 8192).includes('\u0000') || content.includes('\uFFFD');
}

/** Names the project's own `.gitignore` says to leave alone. Root file only,
 *  plain names only — anything with a glob or a slash in it is left to
 *  `SKIP_DIRS`, because a full ignore engine is a dependency we do not want. */
async function ignoredNames(root: string): Promise<Set<string>> {
  const text = await readFile(join(root, '.gitignore'), 'utf8').catch(() => '');
  const names = new Set<string>();
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('!')) continue;
    const name = line.replace(/^\/+/, '').replace(/\/+$/, '');
    if (name === '' || name.includes('/') || /[*?[\]]/.test(name)) continue;
    names.add(name);
  }
  return names;
}

/** How the walk ended. `truncated` is the difference between "there are none"
 *  and "there are none in the part I looked at", and every message that reports
 *  a total has to say which one it is. */
type Walk = { count: number; truncated: boolean };

async function walkFiles(
  root: string,
  onFile: (relative: string, content: string) => void,
  signal?: AbortSignal,
  maxFiles: number = MAX_FILES,
): Promise<Walk> {
  const absRoot = resolve(root);
  const ignored = await ignoredNames(absRoot);
  let count = 0;
  let truncated = false;

  const walk = async (dir: string, prefix: string): Promise<void> => {
    if (signal?.aborted) return;
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (signal?.aborted) return;
      if (count >= maxFiles) {
        truncated = true;
        return;
      }
      if (SKIP_DIRS.has(entry.name) || ignored.has(entry.name)) continue;
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
      // Keys and passwords are never read into the conversation, wherever they
      // sit — folders of them included, so .ssh and .aws are refused as a whole
      // rather than file by file.
      if (isCredentialPath(rel)) continue;
      const full = join(dir, entry.name);
      // A symlink is neither isDirectory() nor isFile() here, so links are
      // skipped. Deliberate: we do not follow one out of the project.
      if (entry.isDirectory()) {
        await walk(full, rel);
        continue;
      }
      if (!entry.isFile()) continue;
      if (BINARY_EXTENSION.test(entry.name)) continue;
      const content = await readFile(full, 'utf8').catch(() => null);
      if (content === null) continue;
      if (content.length > MAX_FILE_CHARS) continue;
      if (looksBinary(content)) continue;
      onFile(rel, content);
      count += 1;
    }
  };

  await walk(absRoot, '');
  return { count, truncated };
}

/** What to add to a count so it never reads as the whole project when it is not. */
function partial(walk: Walk): string {
  return walk.truncated
    ? `\n\nI stopped after ${String(walk.count)} files, so this is not the whole project.`
    : '';
}

/** TODO markers in one file. A marker a person typed, not a compiler's opinion:
 *  "no TODOs" is not "no problems", and the answer says which. */
async function findTodos(root: string, file: string): Promise<string> {
  const check = containsPath(root, file);
  if (!check.inside) return check.reason ?? 'This file is outside the project.';
  if (isCredentialPath(file)) return 'That file holds keys or passwords, so I have left it alone.';
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
  if (hits.length === 0) {
    return `No TODO, FIXME, HACK, XXX or BUG markers in ${file}. That is a scan of the file's text, not a check of it.`;
  }
  return `Markers left in ${file}:\n${hits.join('\n')}`;
}

async function findReferences(
  root: string,
  symbol: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a word to search for.';
  const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(trimmed);
  const re = isIdent ? new RegExp(`\\b${escapeRegExp(trimmed)}\\b`, 'g') : null;
  const hits: string[] = [];
  const walk = await walkFiles(
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
    maxFiles,
  );
  if (hits.length === 0) return `No line here holds "${trimmed}".${partial(walk)}`;
  const more = hits.length >= MAX_RESULTS ? `\n… (first ${String(MAX_RESULTS)} shown)` : '';
  return `Lines holding "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}${more}${partial(walk)}`;
}

async function findDefinition(
  root: string,
  symbol: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a word to search for.';
  const esc = escapeRegExp(trimmed);
  // Definition-like patterns
  const defRe = new RegExp(
    `\\b(?:function|class|interface|type|const|let|var|def|struct|enum|fn|export)\\s+${esc}\\b|\\b${esc}\\s*[:=]\\s*(?:function|\\(|=>)|\\b${esc}\\s*\\(`,
  );
  const hits: string[] = [];
  const walk = await walkFiles(
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
    maxFiles,
  );
  if (hits.length === 0) {
    return `No line here looks like a declaration of "${trimmed}". That is a text pattern, not what a compiler knows. Try references to see every line it appears on.${partial(walk)}`;
  }
  return `Lines that look like a declaration of "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}${partial(walk)}`;
}

type SearchParams = {
  operation?: string;
  op?: string;
  file?: string;
  path?: string;
  filePath?: string;
  symbol?: string;
  word?: string;
  name?: string;
};

function say(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

export function searchSymbolsTextTool(options: SearchOptions): ToolDefinition {
  const projectRoot = resolveRoot(options);
  const maxFiles = typeof options === 'string' ? undefined : options.maxFiles;

  return {
    name: 'search_symbols_text',
    label: 'Text search',
    description:
      'Text search over the project’s files. Not a language server and it does not use one: it matches characters and word boundaries, so a word that also appears in prose or a comment matches too. Operations: references lists every line the word appears on, definition lists lines matching a declaration pattern, todos lists TODO/FIXME markers in one file. Reads only; there is no rename here.',
    promptSnippet:
      'search_symbols_text(operation, file?, symbol?): text search, no language server (reads only)',
    promptGuidelines: [
      'Operations: references and definition need symbol; todos needs file.',
      'Grep-backed, not semantic: a name that also appears in prose, a comment or with another meaning is matched too.',
      'Nothing here changes a file. To rename, edit the files yourself or use an installed language server.',
      'File paths must stay inside the project; outside paths are refused, and files holding keys are never read.',
    ],
    parameters: Type.Object({
      operation: Type.Optional(
        Type.String({ description: 'One of references, definition, todos.' }),
      ),
      op: Type.Optional(Type.String({ description: 'Alias for operation.' })),
      file: Type.Optional(Type.String({ description: 'File path, relative to project or absolute.' })),
      path: Type.Optional(Type.String({ description: 'Alias for file.' })),
      filePath: Type.Optional(Type.String({ description: 'Alias for file.' })),
      symbol: Type.Optional(Type.String({ description: 'Word to search for.' })),
      word: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      name: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
    }),
    executionMode: 'parallel',
    execute: async (
      _callId: string,
      params: SearchParams,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<unknown>> => {
      const opRaw = (params.operation ?? params.op ?? '').trim().toLowerCase();
      const fileRaw = (params.file ?? params.path ?? params.filePath ?? '').trim();
      const symbolRaw = (params.symbol ?? params.word ?? params.name ?? '').trim();

      if (opRaw === '') {
        return say('I need an operation: references, definition, or todos.');
      }

      // Guard: any file arg must stay inside project
      if (fileRaw !== '') {
        const check = containsPath(projectRoot, fileRaw);
        if (!check.inside) return say(check.reason ?? 'This file is outside the project, so I have left it alone.');
      }

      try {
        if (opRaw === 'todos' || opRaw === 'todo' || opRaw === 'fixme') {
          if (fileRaw === '') return say('Listing markers needs a file path.');
          return say(await findTodos(projectRoot, fileRaw));
        }

        if (opRaw === 'references' || opRaw === 'refs' || opRaw === 'find_references' || opRaw === 'reference') {
          if (symbolRaw === '') return say('References needs a word.');
          return say(await findReferences(projectRoot, symbolRaw, signal, maxFiles));
        }

        if (opRaw === 'definition' || opRaw === 'def' || opRaw === 'declarations') {
          if (symbolRaw === '') return say('Definition needs a word.');
          return say(await findDefinition(projectRoot, symbolRaw, signal, maxFiles));
        }

        if (opRaw === 'rename' || opRaw === 'rename_symbol' || opRaw === 'renamesymbol') {
          return say(
            'There is no rename here: this searches text and cannot tell which matches are the symbol you mean. Edit the files yourself, or use an installed language server.',
          );
        }

        return say(`Unknown operation "${opRaw}". Use references, definition, or todos.`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'something went wrong.';
        return say(`Text search failed: ${message}`);
      }
    },
  };
}
