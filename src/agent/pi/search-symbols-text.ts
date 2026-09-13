/** Minimal LSP-like tools: diagnostics/references/definition/preview via grep,
 *  and a rename that writes.
 *
 * No language server binary is required. Diagnostics scans for TODO/FIXME, and
 * the rest walk the project and grep. If a real server were available this
 * would delegate; without one the tools still work, which is the whole point.
 *
 * The rename is a tool of its own because it writes every file it matches. The
 * Guard judges a call by its name, so a write sharing a name with a read is a
 * write nobody is asked about.
 */

import { readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { containsPath, isCredentialPath } from '../guard/paths';

type LspOptions =
  | string
  | { projectRoot?: string; cwd?: string; root?: string; maxFiles?: number };

function resolveRoot(options: LspOptions): string {
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

/** Two characters match half a project, and a sweep nobody can picture is one
 *  to refuse rather than confirm. */
const MIN_SYMBOL = 3;

/** Past either of these a rename has stopped being a rename and become a
 *  rewrite of the project, which belongs in pieces somebody can read. */
const MAX_RENAME_FILES = 100;
const MAX_RENAME_OCCURRENCES = 1000;

/**
 * What the rename is allowed to write to. An allowlist, not a blocklist: a file
 * type we do not recognise as source is one we leave alone, because the cost of
 * being wrong here is somebody's file destroyed rather than one extra step.
 */
const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs',
  '.vue', '.svelte', '.astro',
  '.json', '.jsonc',
  '.css', '.scss', '.sass', '.less',
  '.html', '.htm', '.xml', '.svg',
  '.md', '.mdx', '.txt',
  '.yml', '.yaml', '.toml', '.ini', '.cfg', '.conf',
  '.py', '.rb', '.go', '.rs', '.java', '.kt', '.kts', '.swift', '.php', '.cs',
  '.c', '.h', '.cc', '.cpp', '.hpp', '.m', '.mm',
  '.sh', '.bash', '.zsh',
  '.sql', '.graphql', '.gql', '.prisma',
]);

/** Source by extension, written by a machine. Renaming inside one breaks it and
 *  fixes nothing — the tool that generated it is the thing to run again. */
const GENERATED =
  /(?:^|\/)(?:package-lock\.json|npm-shrinkwrap\.json|composer\.lock)$|\.min\.(?:js|css)$/i;

/** What says what the project is. A word-boundary match finds `name` inside
 *  `"name"` as readily as inside a variable, and renaming a symbol has never
 *  needed one of these — while rewriting one stops the project building. */
const MANIFEST =
  /(?:^|\/)(?:package\.json|jsr\.json|deno\.jsonc?|tsconfig(?:\.[\w-]+)?\.json|jsconfig\.json|composer\.json|Cargo\.toml|pyproject\.toml|go\.mod|Gemfile|build\.gradle(?:\.kts)?|pom\.xml)$/i;

/** A quick skip before opening anything, so a walk does not read a film into
 *  memory to find out it is a film. The content check below is the one that
 *  decides. */
const BINARY_EXTENSION =
  /\.(?:png|jpe?g|gif|webp|avif|bmp|tiff?|ico|icns|pdf|zip|tar|gz|bz2|xz|7z|rar|mp[34]|mov|avi|mkv|wav|flac|ogg|woff2?|ttf|otf|eot|wasm|node|so|dylib|dll|exe|a|o|class|jar|sqlite3?|db|parquet|pack|idx|psd|sketch|fig)$/i;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extensionOf(relative: string): string {
  const base = relative.slice(relative.lastIndexOf('/') + 1);
  const dot = base.lastIndexOf('.');
  return dot <= 0 ? '' : base.slice(dot).toLowerCase();
}

/** Source we are prepared to rewrite. */
function isRenameable(relative: string): boolean {
  if (GENERATED.test(relative) || MANIFEST.test(relative)) return false;
  return SOURCE_EXTENSIONS.has(extensionOf(relative));
}

/** `readFile(…, 'utf8')` does not throw on binary. It substitutes U+FFFD, and
 *  writing that back re-encodes every one of them and destroys the file. */
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
      // Keys and passwords are never read into the conversation and never
      // rewritten, wherever they sit — folders of them included, so .ssh and
      // .aws are refused as a whole rather than file by file.
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

async function readDiagnostics(root: string, file: string): Promise<string> {
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
  if (hits.length === 0) return `No diagnostics in ${file}: no TODO/FIXME found.`;
  return `Diagnostics for ${file}:\n${hits.join('\n')}`;
}

async function findReferences(
  root: string,
  symbol: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a symbol to search for.';
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
  if (hits.length === 0) return `No references to "${trimmed}" found.${partial(walk)}`;
  const more = hits.length >= MAX_RESULTS ? `\n… (first ${String(MAX_RESULTS)} shown)` : '';
  return `References to "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}${more}${partial(walk)}`;
}

async function findDefinition(
  root: string,
  symbol: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const trimmed = symbol.trim();
  if (trimmed === '') return 'I need a symbol to search for.';
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
    // Fallback: at least show where symbol appears (grepped) and call it possible definition
    return `No definition pattern for "${trimmed}" found. Try references to see where it appears.${partial(walk)}`;
  }
  return `Definitions of "${trimmed}" (${String(hits.length)}):\n${hits.join('\n')}${partial(walk)}`;
}

/** Both names have to be identifiers, or the word boundaries mean nothing. */
function checkNames(from: string, to: string): string | null {
  if (from === '' || to === '') return 'I need both the current symbol and the new name.';
  if (from === to) return 'The new name is the same as the old one, so nothing would change.';
  const isIdent = /^[A-Za-z_][A-Za-z0-9_]*$/.test(from) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(to);
  if (!isIdent) {
    return 'Both names should be valid identifiers (letters, numbers, underscore, not starting with a number).';
  }
  return null;
}

async function previewRename(
  root: string,
  symbol: string,
  newName: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const from = symbol.trim();
  const to = newName.trim();
  const wrong = checkNames(from, to);
  if (wrong !== null) return wrong;
  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
  const hits: string[] = [];
  const files: string[] = [];
  let total = 0;
  const walk = await walkFiles(
    root,
    (rel, content) => {
      const lines = content.split('\n');
      let inFile = 0;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i] ?? '';
        const matches = line.match(re);
        if (matches === null) continue;
        inFile += matches.length;
        total += matches.length;
        if (hits.length < MAX_RESULTS) {
          const preview = line.replace(re, to).trim().slice(0, 200);
          hits.push(`${rel}:${String(i + 1)}: ${line.trim().slice(0, 120)}  →  ${preview}`);
        }
      }
      if (inFile > 0) files.push(rel);
    },
    signal,
    maxFiles,
  );
  if (total === 0) return `No occurrences of "${from}" found. Nothing to rename.${partial(walk)}`;
  const skipped = files.filter((rel) => !isRenameable(rel));
  const more = total > hits.length ? `\n… (${String(total - hits.length)} more occurrences)` : '';
  const left =
    skipped.length === 0
      ? ''
      : `\n\nNot source, so a rename would leave these alone: ${skipped.slice(0, 10).join(', ')}`;
  return [
    `Rename preview: "${from}" → "${to}", ${String(total)} occurrence(s) in ${String(files.length)} file(s):`,
    hits.join('\n') + more,
    left,
    '\nNothing was changed. Apply it with lsp_rename.',
  ].join('\n') + partial(walk);
}

async function performRename(
  root: string,
  symbol: string,
  newName: string,
  signal?: AbortSignal,
  maxFiles?: number,
): Promise<string> {
  const from = symbol.trim();
  const to = newName.trim();
  const wrong = checkNames(from, to);
  if (wrong !== null) return wrong;
  if (from.length < MIN_SYMBOL) {
    return `"${from}" is too short to rename across a whole project safely; it would match far more than you mean. Rename it a file at a time with edit instead.`;
  }

  const re = new RegExp(`\\b${escapeRegExp(from)}\\b`, 'g');
  const absRoot = resolve(root);
  const candidates: { rel: string; full: string; content: string }[] = [];
  let total = 0;
  const walk = await walkFiles(
    root,
    (rel, content) => {
      const matches = content.match(re);
      if (matches === null) return;
      total += matches.length;
      if (isRenameable(rel)) candidates.push({ rel, full: join(absRoot, rel), content });
    },
    signal,
    maxFiles,
  );
  if (signal?.aborted) return `Stopped before anything was written. Nothing changed.`;
  if (total === 0) return `No occurrences of "${from}" found. Nothing to rename.${partial(walk)}`;
  if (candidates.length > MAX_RENAME_FILES || total > MAX_RENAME_OCCURRENCES) {
    return `"${from}" appears ${String(total)} time(s) in ${String(candidates.length)} file(s). That is too broad to rename in one go, and a sweep that size is not one anybody can check. Run lsp preview to see it, then rename in smaller pieces, or pick a more specific name.`;
  }

  const realRoot = await realpath(absRoot).catch(() => absRoot);
  const changed: string[] = [];
  const stale: string[] = [];
  let totalReplacements = 0;
  let staleOccurrences = 0;
  let stoppedAt: number | null = null;

  for (let at = 0; at < candidates.length; at++) {
    if (signal?.aborted) {
      stoppedAt = at;
      break;
    }
    const one = candidates[at];
    if (one === undefined) continue;
    // The real containment check the lexical one cannot make: a link inside the
    // project pointing out of it resolves here and is left alone.
    const real = await realpath(one.full).catch(() => null);
    if (real === null || !containsPath(realRoot, real).inside) continue;
    // The walk's copy is seconds old and edit, write and bash all run alongside
    // this. Writing it back would undo whatever landed in between.
    const current = await readFile(real, 'utf8').catch(() => null);
    if (current === null || current !== one.content) {
      stale.push(one.rel);
      staleOccurrences += (one.content.match(re) ?? []).length;
      continue;
    }
    const next = current.replace(re, to);
    if (next === current) continue;
    const count = (current.match(re) ?? []).length;
    try {
      await writeFile(real, next, 'utf8');
    } catch (cause) {
      const why = cause instanceof Error ? cause.message : 'it could not be written';
      const done = changed.length === 0 ? 'Nothing was written' : `Changed:\n${changed.join('\n')}`;
      return `Renaming "${from}" → "${to}" stopped at ${one.rel}: ${why}. ${done}\n\nThe rest were left alone, so the project is half renamed. Put it back or finish it by hand.`;
    }
    totalReplacements += count;
    changed.push(`${one.rel}: ${String(count)}`);
  }

  const staleNote =
    stale.length === 0
      ? ''
      : `\n\nLeft alone because ${stale.length === 1 ? 'it' : 'they'} changed while I was working: ${stale.join(', ')}. Writing would have undone that change, so "${from}" may still be there.`;

  if (changed.length === 0) {
    if (stoppedAt !== null) return `Stopped before anything was written. Nothing changed.`;
    if (stale.length > 0) return `Nothing was written.${staleNote}`;
    return `Found ${String(total)} occurrence(s) of "${from}", but none of them were in files I will rewrite.`;
  }

  const head = `Renamed "${from}" → "${to}", ${String(totalReplacements)} occurrence(s) in ${String(changed.length)} file(s):\n${changed.join('\n')}`;
  if (stoppedAt !== null) {
    return `${head}\n\nStopped there: ${String(candidates.length - stoppedAt)} file(s) still hold "${from}".${staleNote}`;
  }
  if (walk.truncated) {
    return `${head}\n\nI stopped after ${String(walk.count)} files, so other files may still use "${from}".${staleNote}`;
  }
  const skipped = total - totalReplacements - staleOccurrences;
  if (skipped > 0) {
    return `${head}\n\n${String(skipped)} occurrence(s) are in files I do not rewrite (lock files, bundles, binaries) and were left alone.${staleNote}`;
  }
  if (stale.length > 0) return `${head}${staleNote}`;
  return `${head}\n\nNo file I rewrite still holds "${from}". Dependencies, build output and files holding keys are never walked.`;
}

type LspParams = {
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
};

function say(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

export function lspTool(options: LspOptions): ToolDefinition {
  const projectRoot = resolveRoot(options);
  const maxFiles = typeof options === 'string' ? undefined : options.maxFiles;

  return {
    name: 'lsp',
    label: 'Code intelligence',
    description:
      'Diagnostics, references, definition and rename preview. Grep-backed, so it works without a language server. Reads only: preview lists every occurrence a rename would change and leaves every file alone. The rename itself is lsp_rename.',
    promptSnippet:
      'lsp(operation, file?, symbol?, newName?): diagnostics / references / definition / preview (reads only)',
    promptGuidelines: [
      'Operations: diagnostics needs file; references and definition need symbol; preview needs symbol and newName.',
      'Diagnostics reads the file and reports TODO/FIXME; no server needed.',
      'References, definition and preview walk the project and grep. Nothing here changes a file.',
      'Preview before lsp_rename whenever the symbol is short or a common word: it names every file and line that would change.',
      'File paths must stay inside the project; outside paths are refused, and files holding keys are never read.',
    ],
    parameters: Type.Object({
      operation: Type.Optional(
        Type.String({ description: 'One of diagnostics, references, definition, preview.' }),
      ),
      op: Type.Optional(Type.String({ description: 'Alias for operation.' })),
      file: Type.Optional(Type.String({ description: 'File path, relative to project or absolute.' })),
      path: Type.Optional(Type.String({ description: 'Alias for file.' })),
      filePath: Type.Optional(Type.String({ description: 'Alias for file.' })),
      symbol: Type.Optional(Type.String({ description: 'Symbol to search for.' })),
      word: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      name: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      newName: Type.Optional(
        Type.String({ description: 'The name preview should show the symbol renamed to.' }),
      ),
      to: Type.Optional(Type.String({ description: 'Alias for newName.' })),
    }),
    executionMode: 'parallel',
    execute: async (
      _callId: string,
      params: LspParams,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<unknown>> => {
      const opRaw = (params.operation ?? params.op ?? '').trim().toLowerCase();
      const fileRaw = (params.file ?? params.path ?? params.filePath ?? '').trim();
      const symbolRaw = (params.symbol ?? params.word ?? params.name ?? '').trim();
      const newNameRaw = (params.newName ?? params.to ?? '').trim();

      if (opRaw === '') {
        return say('I need an operation: diagnostics, references, definition, or preview.');
      }

      // Guard: any file arg must stay inside project
      if (fileRaw !== '') {
        const check = containsPath(projectRoot, fileRaw);
        if (!check.inside) return say(check.reason ?? 'This file is outside the project, so I have left it alone.');
      }

      try {
        if (opRaw === 'diagnostics' || opRaw === 'diagnostic' || opRaw === 'diag') {
          if (fileRaw === '') return say('Diagnostics needs a file path.');
          return say(await readDiagnostics(projectRoot, fileRaw));
        }

        if (opRaw === 'references' || opRaw === 'refs' || opRaw === 'find_references' || opRaw === 'reference') {
          if (symbolRaw === '') return say('References needs a symbol.');
          return say(await findReferences(projectRoot, symbolRaw, signal, maxFiles));
        }

        if (opRaw === 'definition' || opRaw === 'def' || opRaw === 'goto_definition' || opRaw === 'definitions') {
          if (symbolRaw === '') return say('Definition needs a symbol.');
          return say(await findDefinition(projectRoot, symbolRaw, signal, maxFiles));
        }

        if (opRaw === 'preview' || opRaw === 'rename_preview' || opRaw === 'dry_run') {
          if (symbolRaw === '' || newNameRaw === '') return say('Preview needs both symbol and newName.');
          return say(await previewRename(projectRoot, symbolRaw, newNameRaw, signal, maxFiles));
        }

        if (opRaw === 'rename' || opRaw === 'rename_symbol' || opRaw === 'renamesymbol') {
          return say(
            'Rename writes files, so it is a tool of its own: call lsp_rename with symbol and newName. Use preview here first to see what it would change.',
          );
        }

        return say(`Unknown operation "${opRaw}". Use diagnostics, references, definition, or preview.`);
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'something went wrong.';
        return say(`LSP operation failed: ${message}`);
      }
    },
  };
}

export function lspRenameTool(options: LspOptions): ToolDefinition {
  const projectRoot = resolveRoot(options);
  const maxFiles = typeof options === 'string' ? undefined : options.maxFiles;

  return {
    name: 'lsp_rename',
    label: 'Rename across the project',
    description:
      'Rename a symbol everywhere it appears: word-bounded, grep-backed, and it writes every source file that holds it (formatBytes → formatFileSize across the project). Preview it with lsp(operation: "preview") first when the symbol is short or a common word; this applies the change without a second look.',
    promptSnippet: 'lsp_rename(symbol, newName): renames across every file (writes)',
    promptGuidelines: [
      'Writes. Every source file holding the symbol is rewritten in one go.',
      'Preview first with lsp(operation: "preview", symbol, newName) whenever the name is short or a common word; that one changes nothing.',
      'Only source is rewritten: lock files, minified bundles, binaries, and anything holding keys are left alone and reported.',
      "A project's own dotted folders (.github, .vscode) are rewritten like any other source; .git, dependencies and build output are not walked.",
      'Grep-backed, not a language server: a name that also appears in prose or with another meaning is changed there too.',
      'A very short symbol, or one matching an enormous part of the project, is refused rather than swept.',
    ],
    parameters: Type.Object({
      symbol: Type.Optional(Type.String({ description: 'The name to rename.' })),
      word: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      name: Type.Optional(Type.String({ description: 'Alias for symbol.' })),
      newName: Type.Optional(Type.String({ description: 'The name to rename it to.' })),
      to: Type.Optional(Type.String({ description: 'Alias for newName.' })),
    }),
    // One working tree, one rename: two of these overlapping interleave writes.
    executionMode: 'sequential',
    execute: async (
      _callId: string,
      params: LspParams,
      signal: AbortSignal | undefined,
    ): Promise<AgentToolResult<unknown>> => {
      const symbolRaw = (params.symbol ?? params.word ?? params.name ?? '').trim();
      const newNameRaw = (params.newName ?? params.to ?? '').trim();
      if (symbolRaw === '' || newNameRaw === '') return say('Rename needs both symbol and newName.');
      try {
        return say(await performRename(projectRoot, symbolRaw, newNameRaw, signal, maxFiles));
      } catch (cause) {
        const message = cause instanceof Error ? cause.message : 'something went wrong.';
        return say(`Rename failed: ${message}`);
      }
    },
  };
}
