#!/usr/bin/env node
// Em dashes and spaced en dashes in copy a person or the model reads. Working
// notes and developer docs are out of scope; nobody ships a comment either.
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = join(fileURLToPath(new URL('.', import.meta.url)), '..')

const shipped = ['site', 'src', 'electron', 'notes/releases', 'README.md']
const skipDirs = new Set(['node_modules', '.git', 'dist', 'dist-electron', 'release', 'tests'])

const EM = '—'
const SPACED_EN = / – /g

function countIn(text) {
  return text.split(EM).length - 1 + (text.match(SPACED_EN)?.length ?? 0)
}

/** Every string a TypeScript source carries, and nothing else.
 *
 *  The compiler's own parser rather than a regular expression: a `/` can open a
 *  comment, a division or a pattern, a backtick can open or close, and a lexer
 *  that guesses at any of those reads half the file's comments as copy. */
const STRINGS = new Set([
  ts.SyntaxKind.StringLiteral,
  ts.SyntaxKind.NoSubstitutionTemplateLiteral,
  ts.SyntaxKind.TemplateHead,
  ts.SyntaxKind.TemplateMiddle,
  ts.SyntaxKind.TemplateTail,
  ts.SyntaxKind.JsxText,
])

function countInSource(text, name) {
  const tree = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, false, ts.ScriptKind.TSX)
  let n = 0
  const walk = (node) => {
    if (STRINGS.has(node.kind)) n += countIn(node.getText(tree))
    else node.forEachChild(walk)
  }
  tree.forEachChild(walk)
  return n
}

function countInFile(path, name) {
  const text = readFileSync(path, 'utf8')
  if (!name.endsWith('.ts') && !name.endsWith('.tsx')) return countIn(text)
  return countInSource(text, name)
}

/* -------------------------------------------------------------------------- */
/* A button is one line                                                        */
/* -------------------------------------------------------------------------- */

/** A button whose own words run past this is a button that wraps, and a row
 *  that wraps drags everything beside it out of line. */
const MOST_BUTTON = 24;

/** Past the opening tag, whose attributes hold braces and quotes of their own,
 *  so the first `>` is very often inside an arrow function. */
function pastOpenTag(text, at) {
  let depth = 0;
  let quote = '';
  for (let i = at; i < text.length; i += 1) {
    const one = text[i];
    if (quote !== '') {
      if (one === quote) quote = '';
      continue;
    }
    if (one === '"' || one === "'" || one === '`') quote = one;
    else if (one === '{') depth += 1;
    else if (one === '}') depth -= 1;
    else if (one === '>' && depth === 0) return i + 1;
  }
  return -1;
}

/** Everything the code works out at render time, cut away. Balanced rather than
 *  matched: a `{}` in here holds arrow functions and template literals with
 *  braces of their own. */
function withoutBraces(markup) {
  let out = '';
  let depth = 0;
  for (const one of markup) {
    if (one === '{') depth += 1;
    else if (one === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += one;
  }
  return out;
}

/** The static words a button draws, with everything a person never sees taken
 *  out: nested elements, and anything worked out at render time. */
function saysOf(markup) {
  return withoutBraces(markup)
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Where this button's own children end. Buttons nest, so counting is the only
 *  way to find the close that belongs to this open. */
function closeOf(text, from) {
  let depth = 0;
  let at = from;
  while (at < text.length) {
    const open = text.indexOf('<button', at);
    const shut = text.indexOf('</button>', at);
    if (shut < 0) return -1;
    if (open >= 0 && open < shut) {
      depth += 1;
      at = open + 7;
      continue;
    }
    if (depth === 0) return shut;
    depth -= 1;
    at = shut + 9;
  }
  return -1;
}

function longButtonsIn(text) {
  const out = [];
  for (const found of text.matchAll(/<button\b/g)) {
    const from = pastOpenTag(text, found.index);
    if (from < 0) continue;
    const to = closeOf(text, from);
    if (to < 0) continue;
    const says = saysOf(text.slice(from, to));
    if (says.length > MOST_BUTTON) out.push(says);
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* A scroller says which bar it wants                                          */
/* -------------------------------------------------------------------------- */

/** A scroller with no `scroll--auto` and no bar of its own inherits the window's,
 *  which is always visible beside every scroller that behaves. */
/** The shared auto-hiding scroller, which some classes are listed in by name. */
const shared = readFileSync(join(root, 'src/styles/scrollbar.css'), 'utf8');

function bareScrollersIn(text, path) {
  if (!path.startsWith('src/components/') || !path.endsWith('.css')) return [];
  const out = [];
  for (const found of text.matchAll(/(\.[A-Za-z0-9_-]+)\s*\{([^}]*)\}/g)) {
    const body = found[2] ?? '';
    if (!/overflow(-y)?:\s*auto/.test(body)) continue;
    if (/scrollbar-width/.test(body)) continue;
    const named = (found[1] ?? '').slice(1);
    const tsx = path.replace(/\.css$/, '.tsx');
    let markup = '';
    try {
      markup = readFileSync(join(root, tsx), 'utf8');
    } catch {
      markup = '';
    }
    if (markup.includes(`${named} scroll--auto`)) continue;
    if (shared.includes(`.${named}`)) continue;
    out.push(`${found[1]} in ${path}`);
  }
  return out;
}

function look(path, name, found) {
  if (statSync(path).isDirectory()) {
    if (skipDirs.has(name)) return found
    for (const child of readdirSync(path).sort()) look(join(path, child), child, found)
    return found
  }
  const shown = relative(root, path).split(sep).join('/')
  if (/\.tsx$/.test(name)) buttons.push(...longButtonsIn(readFileSync(path, 'utf8')).map((says) => [shown, says]))
  if (/\.css$/.test(name)) scrollers.push(...bareScrollersIn(readFileSync(path, 'utf8'), shown))
  if (!/\.(ts|tsx|html|md)$/.test(name)) return found
  const n = countInFile(path, name)
  if (n) found.push([n, shown])
  return found
}

const buttons = []
const scrollers = []

const found = []
for (const entry of shipped) look(join(root, entry), entry.split('/').pop(), found)

let total = 0
for (const [n, path] of found) {
  total += n
  console.log(`${n} ${path}`)
}
let wrong = total

if (total) {
  console.error(`\n${total} em dash${total === 1 ? '' : 'es'} in copy a person or the model reads.`)
  console.error('Use a comma, a colon, a full stop or a short parenthesis. Never a hyphen.')
}

if (buttons.length) {
  wrong += buttons.length
  console.error(`\n${buttons.length} button${buttons.length === 1 ? '' : 's'} too long to stay on one line:`)
  for (const [where, says] of buttons) console.error(`  ${where}: ${says}`)
  console.error('A button label is the operation, one to three words. The rest is a title or a note.')
}

if (scrollers.length) {
  wrong += scrollers.length
  console.error(`\n${scrollers.length} scroller${scrollers.length === 1 ? '' : 's'} with no bar of their own:`)
  for (const where of scrollers) console.error(`  ${where}`)
  console.error('Add `scroll--auto` to the element, or set scrollbar-width in the rule.')
}

if (wrong) process.exit(1)
console.log('Shipped copy is clean.')
