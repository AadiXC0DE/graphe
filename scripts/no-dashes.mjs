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

function look(path, name, found) {
  if (statSync(path).isDirectory()) {
    if (skipDirs.has(name)) return found
    for (const child of readdirSync(path).sort()) look(join(path, child), child, found)
    return found
  }
  if (!/\.(ts|tsx|html|md)$/.test(name)) return found
  const n = countInFile(path, name)
  if (n) found.push([n, relative(root, path).split(sep).join('/')])
  return found
}

const found = []
for (const entry of shipped) look(join(root, entry), entry.split('/').pop(), found)

let total = 0
for (const [n, path] of found) {
  total += n
  console.log(`${n} ${path}`)
}
if (total) {
  console.error(`\n${total} em dash${total === 1 ? '' : 'es'} in copy a person or the model reads.`)
  console.error('Use a comma, a colon, a full stop or a short parenthesis. Never a hyphen.')
  process.exit(1)
}
console.log('No em dashes in shipped copy.')
