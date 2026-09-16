/** Reading a project's own values, and counting who uses them.
 *
 * One thing here has to be exactly right or the panel lies: a reading must not
 * invent a token that only ever existed inside a comment or a string, and it
 * must land every line number on the declaration it belongs to. The rest is
 * classification and arithmetic.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { readTokens, usesIn, type Token } from '../src/design/tokens';

/** A stylesheet with every awkward thing in it: a token named in a comment, a
 *  value spread over four lines, a semicolon inside a string, a declaration in
 *  a block that is not a root, the same name repeated per theme, and a last
 *  declaration with no semicolon after it. */
const PROJECT = `/* A project's tokens.
   Even this line — --fake: red; — is only prose. */

:root {
  --brand: #3355ff;
  /* --fake: red; */
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --radius-md: 10px; /* the default */
  --text-base: 1rem;
  --shadow-md: 0 4px 16px rgb(0 0 0 / 0.08);
  --font-ui:
    ui-sans-serif,
    'Segoe UI',
    sans-serif;
  --ink: var(--brand);
  --dur-ui: 200ms;
  --paper: url('tile;one.png');
}

@media (prefers-color-scheme: dark) {
  :root {
    --brand: #7799ff;
  }
}

:root[data-theme='dark'] {
  --brand: #88aaff;
}

.card {
  --local: 3px;
  padding: var(--space-2);
}

:root {
  --last: 2px
}
`;

const OURS = readFileSync(new URL('../src/styles/tokens.css', import.meta.url), 'utf8');

const tokens = readTokens(PROJECT);

function named(name: string): Token {
  const found = tokens.find((token) => token.name === name);
  if (!found) throw new Error(`the fixture has no ${name}`);
  return found;
}

const names = tokens.map((token) => token.name);
const kindOf = (name: string): string => named(name).kind;

/* ========================================================================== */
/* Reading                                                                     */
/* ========================================================================== */

describe('reading a stylesheet', () => {
  it('never picks up a token that only exists inside a comment', () => {
    expect(names).not.toContain('--fake');
    expect(tokens.some((token) => token.value.includes('red'))).toBe(false);
  });

  it('finds the tokens declared on :root, in the order they are written', () => {
    expect(names.slice(0, 4)).toEqual(['--brand', '--space-1', '--space-2', '--space-3']);
    expect(names).toContain('--paper');
  });

  it('ignores custom properties declared anywhere that is not a root', () => {
    expect(names).not.toContain('--local');
  });

  it('reads a declaration that has no semicolon after it', () => {
    expect(named('--last').value).toBe('2px');
  });

  it('keeps a multi-line value whole', () => {
    const font = named('--font-ui');
    expect(font.value).toContain('ui-sans-serif');
    expect(font.value).toContain('sans-serif');
    expect(font.value.split('\n')).toHaveLength(3);
  });

  it('is not confused by a semicolon inside a string', () => {
    expect(named('--paper').value).toBe("url('tile;one.png')");
    expect(named('--dur-ui').value).toBe('200ms');
  });

  it('records the 1-based line the declaration is on', () => {
    const lines = PROJECT.split('\n');
    for (const token of tokens) {
      expect(lines[token.line - 1]).toContain(token.name);
    }
    expect(named('--brand').line).toBe(5);
  });

  it('reports the theme copies as well as the first declaration', () => {
    const brands = tokens.filter((token) => token.name === '--brand');
    expect(brands.map((token) => token.value)).toEqual(['#3355ff', '#7799ff', '#88aaff']);
    expect(brands.map((token) => token.line)).toEqual([5, 25, 30]);
  });

  /* Tailwind 4 keeps its whole palette in `@theme`, and a project written that
     way declares its tokens there and nowhere else. */
  it('counts a @theme block as a root', () => {
    const tailwind = readTokens(`@theme {
  --color-ink: #111111;
  --spacing-4: 1rem;
}

@theme inline {
  --font-sans: 'Inter', sans-serif;
}

.card {
  --local: 3px;
}
`);
    expect(tailwind.map((token) => token.name)).toEqual([
      '--color-ink',
      '--spacing-4',
      '--font-sans',
    ]);
    expect(tailwind[0]?.line).toBe(2);
  });

  it('still refuses a block that only mentions the word', () => {
    const near = readTokens(`@theme-switch {
  --not-a-token: 1px;
}
`);
    expect(near).toEqual([]);
  });
});

describe('what kind of thing a token is', () => {
  it('knows a colour by its value, not by its name', () => {
    expect(kindOf('--brand')).toBe('colour');
    expect(readTokens(':root { --a: rgb(1 2 3); --b: transparent; --c: hsl(20 5% 5%); }')).toEqual([
      { name: '--a', value: 'rgb(1 2 3)', kind: 'colour', line: 1 },
      { name: '--b', value: 'transparent', kind: 'colour', line: 1 },
      { name: '--c', value: 'hsl(20 5% 5%)', kind: 'colour', line: 1 },
    ]);
  });

  it('follows a var() reference to work out what it is', () => {
    expect(kindOf('--ink')).toBe('colour');
  });

  it('separates spacing, size and rounding by the words in the name', () => {
    expect(kindOf('--space-1')).toBe('space');
    expect(kindOf('--radius-md')).toBe('radius');
    expect(kindOf('--text-base')).toBe('size');
  });

  it('calls a shadow a shadow', () => {
    expect(kindOf('--shadow-md')).toBe('shadow');
    expect(readTokens(':root { --lift: 0 1px 2px rgba(0,0,0,.2); }')[0]?.kind).toBe('shadow');
  });

  it('leaves what it cannot place alone rather than guessing', () => {
    expect(kindOf('--dur-ui')).toBe('other');
    expect(kindOf('--font-ui')).toBe('other');
    expect(kindOf('--paper')).toBe('other');
  });
});

describe('reading the tokens this app ships with', () => {
  const real = readTokens(OURS);

  it('finds the whole palette and scale', () => {
    const found = real.map((token) => token.name);
    expect(found).toContain('--space-4');
    expect(found).toContain('--accent');
    expect(found).toContain('--radius-md');
  });

  it('classifies the file it was written for', () => {
    const kind = (name: string): string | undefined =>
      real.find((token) => token.name === name)?.kind;
    expect(kind('--space-4')).toBe('space');
    expect(kind('--radius-md')).toBe('radius');
    expect(kind('--text-base')).toBe('size');
    expect(kind('--topbar-height')).toBe('size');
    expect(kind('--accent')).toBe('colour');
    expect(kind('--shadow-sm')).toBe('shadow');
    expect(kind('--selection')).toBe('colour');
    expect(kind('--code-token-keyword')).toBe('colour');
    expect(kind('--ease-hover')).toBe('other');
    expect(kind('--dur-ui')).toBe('other');
  });

  it('lands every line number on the declaration it belongs to', () => {
    const lines = OURS.split('\n');
    for (const token of real) {
      expect(lines[token.line - 1]).toContain(token.name);
    }
  });
});

/* ========================================================================== */
/* Who reaches for a value                                                     */
/* ========================================================================== */

describe('counting what leans on a value', () => {
  it('counts every var() that names it, across every sheet it was given', () => {
    const uses = usesIn([
      ':root { --space-2: 8px; }\n.card { padding: var(--space-2) var(--space-2); }',
      '.row { gap: var(--space-2); }',
    ]);
    expect(uses.get('--space-2')).toBe(3);
  });

  it('says nothing at all about a name nothing reaches for', () => {
    expect(usesIn([':root { --lonely: 1px; }']).get('--lonely')).toBeUndefined();
    expect(usesIn([':root { --lonely: 1px; }']).get('--lonely') ?? 0).toBe(0);
  });

  /* A `var()` written down in a comment or a string is prose, and counting it
     would tell somebody a value is load-bearing when nothing uses it. */
  it('does not count a use that only exists inside a comment or a string', () => {
    const uses = usesIn(['/* was var(--old) */\n:root { --a: "var(--fake)"; }']);
    expect(uses.get('--old')).toBeUndefined();
    expect(uses.get('--fake')).toBeUndefined();
  });

  it('reads a fallback without taking the fallback for a name', () => {
    const uses = usesIn(['.a { color: var(--ink, #000); }']);
    expect(uses.get('--ink')).toBe(1);
    expect([...uses.keys()]).toEqual(['--ink']);
  });
});
