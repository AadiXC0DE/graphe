/** Markdown, read safely.
 *
 * Everything the agent writes is untrusted text. It arrives from a model, it is
 * shown inside an Electron window that can read the user's disk, and it is the
 * one thing in the app nobody reviews before it appears on screen. So this file
 * has one job and one rule.
 *
 * The job: turn a string of Markdown into a token tree, mid-sentence or not.
 * The rule: **the tree never carries HTML**. `Markdown.tsx` renders these tokens
 * as React elements, so there is no HTML string to sanitise, no
 * `dangerouslySetInnerHTML` on model output, and nothing an injected `<script>`
 * or `<img onerror=...>` can attach itself to — a raw HTML tag in the source
 * comes out the other end as the literal characters somebody typed.
 *
 * Links are the one place a string still becomes a browsable thing, so they are
 * checked here rather than at the call site: `http`, `https` and `mailto` only,
 * after entity-decoding, so `java&#115;cript:` is caught along with the obvious
 * spelling. Anything else stops being a link and stays as text.
 */

import { Lexer, type Token, type Tokens } from 'marked';

export type { Token, Tokens };

/**
 * Lex, with a floor under it.
 *
 * Called on every streamed delta, which means most calls see a half-finished
 * document: an unclosed fence, a table with one row of its header, a link whose
 * closing bracket has not arrived. Marked handles all of those by treating the
 * rest of the string as the block it is inside, which is exactly right — the
 * code block simply grows a line at a time rather than appearing at the end.
 *
 * The catch is not decoration. A parse that throws mid-stream would replace
 * somebody's reply with a blank space, so a failure here falls back to showing
 * the text as it arrived. Unreadable formatting beats a disappeared answer.
 */
export function parseMarkdown(text: string): readonly Token[] | null {
  return lexIncrementally(null, text).tokens;
}

function lexAll(text: string): readonly Token[] | null {
  try {
    return new Lexer({ gfm: true, breaks: true }).lex(text);
  } catch {
    return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Lexing a reply that is still arriving                                       */
/* -------------------------------------------------------------------------- */

/**
 * What a message looked like last time it was read, kept so the next token does
 * not cost a whole re-read.
 *
 * A two-hundred-block reply re-lexed on every delta is the whole document,
 * sixty times a second, for the sake of one character at the end of it. Only
 * the end can change: everything above the last couple of blocks is settled
 * text that no amount of typing at the bottom can rewrite. So the settled part
 * is kept and the tail alone is read again.
 */
export type Cached = {
  /** The text these tokens were read from. */
  text: string;
  /** Null when it could not be read at all — the caller shows it plain. */
  tokens: readonly Token[] | null;
  /** Characters of `text` covered by blocks that can no longer change. */
  settled: number;
  /** How many blocks the last call had to read. The measure the streaming
   *  path is judged on. */
  lexed: number;
};

/** Blocks left open at the bottom. One is enough for the cases that matter — a
 *  paragraph growing, a fence closing, a list gaining an item — and the second
 *  is cheap insurance against the ones nobody has thought of. */
const OPEN = 2;

/** A link definition anywhere in the tail changes how links read above it, so
 *  its arrival is the one thing that makes the settled part unsettled. */
const DEFINES_A_LINK = /^ {0,3}\[[^\]\n]+\]:/m;

/**
 * The token tree, reading only what the new characters could have changed.
 *
 * Falls back to reading the whole thing whenever the cheap path cannot be
 * trusted: text that was edited rather than appended to, carriage returns
 * (which the lexer rewrites, so character counts stop lining up), or a link
 * definition arriving underneath links that already went past.
 */
export function lexIncrementally(before: Cached | null, text: string): Cached {
  const whole = (): Cached => {
    const tokens = lexAll(text);
    return {
      text,
      tokens,
      settled: tokens === null ? 0 : settledBy(tokens, text),
      lexed: tokens?.length ?? 0,
    };
  };

  if (
    before === null ||
    before.tokens === null ||
    before.settled <= 0 ||
    text.length <= before.text.length ||
    !text.startsWith(before.text) ||
    text.includes('\r')
  ) {
    return whole();
  }

  const tail = text.slice(before.settled);
  if (DEFINES_A_LINK.test(tail)) return whole();

  const read = lexAll(tail);
  if (read === null) return whole();

  const kept = before.tokens.slice(0, countUpTo(before.tokens, before.settled));
  const tokens = [...kept, ...read];
  return { text, tokens, settled: before.settled + settledBy(read, tail), lexed: read.length };
}

/**
 * Where the settled part ends: everything but the last `OPEN` blocks.
 *
 * Zero unless the blocks account for every character of the source. They
 * normally do, and when they do not the offsets this returns would cut the text
 * in the wrong place — which is a corrupted reply, not a slow one.
 */
function settledBy(tokens: readonly Token[], source: string): number {
  let all = 0;
  for (const token of tokens) all += token.raw.length;
  if (all !== source.length) return 0;
  let settled = 0;
  for (let at = 0; at < tokens.length - OPEN; at += 1) settled += tokens[at]?.raw.length ?? 0;
  return settled;
}

/** How many blocks the first `characters` of the text cover. */
function countUpTo(tokens: readonly Token[], characters: number): number {
  let running = 0;
  let count = 0;
  for (const token of tokens) {
    if (running >= characters) break;
    running += token.raw.length;
    count += 1;
  }
  return count;
}

/* -------------------------------------------------------------------------- */
/* Entities                                                                    */
/* -------------------------------------------------------------------------- */

const NAMED: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '...',
  mdash: '—',
  ndash: '–',
  colon: ':',
  Tab: '\t',
  NewLine: '\n',
};

/** `&amp;` is meant to be read as an ampersand, not as five characters. Marked
 *  leaves entities alone in its tokens because its own renderer escapes on the
 *  way out; we render through React, which escapes for us, so the decoding has
 *  to happen somewhere and this is it. */
export function decodeEntities(text: string): string {
  if (!text.includes('&')) return text;
  return text.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (whole, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith('#x')) return fromCode(Number.parseInt(body.slice(2), 16), whole);
    if (lower.startsWith('#')) return fromCode(Number.parseInt(body.slice(1), 10), whole);
    return NAMED[body] ?? NAMED[lower] ?? whole;
  });
}

function fromCode(code: number, whole: string): string {
  if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff) return whole;
  try {
    return String.fromCodePoint(code);
  } catch {
    return whole;
  }
}

/* -------------------------------------------------------------------------- */
/* Links                                                                       */
/* -------------------------------------------------------------------------- */

/** Schemes a sentence is allowed to turn into something clickable. `javascript:`
 *  and `data:` are the two that matter, and an allowlist is the only way to be
 *  sure of catching the third one nobody has thought of yet. */
const BROWSABLE = /^(?:https?|mailto):/i;

/**
 * Drop spaces and control characters before the scheme is read.
 *
 * `java<newline>script:alert(1)` is a working URL in more than one browser, and
 * it is not a scheme any test catches while the newline is still in the middle
 * of it. Written as a loop rather than a character class because a regex full of
 * escaped control codes is the kind of line that gets "tidied" by somebody who
 * cannot tell what it is for.
 */
function withoutBlanks(value: string): string {
  let out = '';
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code > 0x20 && code !== 0x7f) out += character;
  }
  return out;
}

/**
 * The href to use, or null when the link should stay as plain text.
 *
 * Relative links are refused as well as dangerous ones, and for a reason that is
 * easy to miss: this app is a single window with no router, so `/settings` from
 * a model would navigate the whole interface away and take the conversation with
 * it. Nothing the agent writes may move the window.
 */
export function safeHref(href: string | null | undefined): string | null {
  if (typeof href !== 'string') return null;
  const cleaned = withoutBlanks(decodeEntities(href));
  return BROWSABLE.test(cleaned) ? cleaned : null;
}

/** Images get a narrower list still: a picture is fetched without anyone
 *  clicking it, and `data:` URLs can carry SVG, which can carry script. */
export function safeImageSrc(src: string | null | undefined): string | null {
  if (typeof src !== 'string') return null;
  const cleaned = withoutBlanks(decodeEntities(src));
  return /^https?:/i.test(cleaned) ? cleaned : null;
}

/* -------------------------------------------------------------------------- */
/* Code fences                                                                 */
/* -------------------------------------------------------------------------- */

/** Languages we can colour. Anything else renders as plain text rather than
 *  fetching a grammar on the off-chance — see src/lib/highlight.ts. */
const LANGUAGES: Readonly<Record<string, string>> = {
  ts: 'typescript',
  typescript: 'typescript',
  tsx: 'tsx',
  js: 'javascript',
  javascript: 'javascript',
  mjs: 'javascript',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  css: 'css',
  scss: 'scss',
  html: 'html',
  xml: 'html',
  svg: 'html',
  md: 'markdown',
  markdown: 'markdown',
  sh: 'bash',
  bash: 'bash',
  zsh: 'bash',
  shell: 'bash',
  console: 'bash',
  diff: 'diff',
  patch: 'diff',
  yml: 'yaml',
  yaml: 'yaml',
  py: 'python',
  python: 'python',
  sql: 'sql',
};

/**
 * The grammar to colour a fence with, or null to leave it alone.
 *
 * Fence info strings are a free-for-all — ```ts title="src/a.ts" is common — so
 * only the first word counts, and an unknown word is not an error. It just means
 * plain text, which is what an unlabelled fence gets anyway.
 */
export function languageOf(info: string | null | undefined): string | null {
  if (typeof info !== 'string') return null;
  const first = info.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  return LANGUAGES[first] ?? null;
}

/** A fence that asks for a diagram: ```mermaid. Deliberately not in LANGUAGES —
 *  the diagram engine owns it, not the highlighter, so a mermaid fence must not
 *  be coloured like code on the way past. */
export function isMermaid(info: string | null | undefined): boolean {
  if (typeof info !== 'string') return false;
  return info.trim().split(/\s+/)[0]?.toLowerCase() === 'mermaid';
}

const LABELS: Readonly<Record<string, string>> = {
  ts: 'TypeScript',
  typescript: 'TypeScript',
  tsx: 'TSX',
  js: 'JavaScript',
  javascript: 'JavaScript',
  jsx: 'JSX',
  json: 'JSON',
  css: 'CSS',
  scss: 'SCSS',
  html: 'HTML',
  svg: 'SVG',
  md: 'Markdown',
  markdown: 'Markdown',
  sh: 'Shell',
  bash: 'Shell',
  zsh: 'Shell',
  shell: 'Shell',
  console: 'Shell',
  diff: 'Changes',
  patch: 'Changes',
  yml: 'YAML',
  yaml: 'YAML',
  py: 'Python',
  python: 'Python',
  sql: 'SQL',
};

/** What to print above a code block: the name people recognise rather than the
 *  grammar's, and nothing at all when the fence did not say. */
export function languageLabel(info: string | null | undefined): string | null {
  if (typeof info !== 'string') return null;
  const first = info.trim().split(/\s+/)[0] ?? '';
  if (first === '') return null;
  return LABELS[first.toLowerCase()] ?? first;
}
