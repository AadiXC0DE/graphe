/** The safe half of changing a design: the values a slider owns.
 *
 * Two things here have to be exactly right or somebody loses work. Reading must
 * not invent a token that only ever existed inside a comment, and writing must
 * put back the file it was given with one value different and nothing else —
 * not reformatted, not re-indented, not stripped of the comments somebody wrote
 * to explain the number. The rest is arithmetic.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  readTokens,
  saysNudge,
  settle,
  steps,
  writeToken,
  type Nudge,
  type Token,
} from '../src/design/tokens';

/** A stylesheet with every awkward thing in it: a token named in a comment, a
 *  value spread over four lines, a semicolon inside a string, a declaration in
 *  a block that is not `:root`, the same name repeated per theme, and a last
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

  it('ignores custom properties declared anywhere that is not a root block', () => {
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

  it('learns our spacing scale from the file itself', () => {
    const space = real.find((token) => token.name === '--space-4');
    expect(space && steps(space, real)).toEqual([
      '4px',
      '8px',
      '12px',
      '16px',
      '24px',
      '32px',
      '48px',
      '72px',
      '120px',
    ]);
  });
});

/* ========================================================================== */
/* Writing                                                                     */
/* ========================================================================== */

describe('writing one value back', () => {
  it('changes the value and returns the rest of the file byte for byte', () => {
    const after = writeToken(PROJECT, '--space-2', '10px');
    expect(after).toBe(PROJECT.replace('--space-2: 8px;', '--space-2: 10px;'));
    expect(after.length - PROJECT.length).toBe(1);
  });

  it('leaves the same name in a theme block alone', () => {
    const after = writeToken(PROJECT, '--brand', '#112233');
    const brands = readTokens(after).filter((token) => token.name === '--brand');
    expect(brands.map((token) => token.value)).toEqual(['#112233', '#7799ff', '#88aaff']);
    expect(after).toContain('--brand: #88aaff;');
  });

  it('keeps the comment written beside the value', () => {
    const after = writeToken(PROJECT, '--radius-md', '14px');
    expect(after).toContain('--radius-md: 14px; /* the default */');
    expect(after).toBe(PROJECT.replace('--radius-md: 10px;', '--radius-md: 14px;'));
  });

  it('replaces a multi-line value whole, indentation and all', () => {
    const after = writeToken(PROJECT, '--font-ui', 'Inter, sans-serif');
    expect(after).toBe(
      PROJECT.replace("ui-sans-serif,\n    'Segoe UI',\n    sans-serif;", 'Inter, sans-serif;'),
    );
    expect(after).toContain('  --font-ui:\n    Inter, sans-serif;');
    expect(after).toContain('  --ink: var(--brand);');
    expect(readTokens(after).find((token) => token.name === '--font-ui')?.value).toBe(
      'Inter, sans-serif',
    );
  });

  it('takes a name with or without its dashes', () => {
    expect(writeToken(PROJECT, 'space-1', '5px')).toBe(writeToken(PROJECT, '--space-1', '5px'));
    expect(writeToken(PROJECT, 'space-1', '5px')).not.toBe(PROJECT);
  });

  it('returns the file untouched when there is no such token', () => {
    expect(writeToken(PROJECT, '--nothing-like-this', '1px')).toBe(PROJECT);
    expect(writeToken(PROJECT, '--local', '9px')).toBe(PROJECT);
    expect(writeToken(PROJECT, '--fake', 'blue')).toBe(PROJECT);
  });

  it('can be written and put back without drift', () => {
    const once = writeToken(PROJECT, '--space-1', '6px');
    expect(once).not.toBe(PROJECT);
    expect(writeToken(once, '--space-1', '4px')).toBe(PROJECT);
  });

  it('does not disturb the file it was written for', () => {
    const after = writeToken(OURS, '--accent', '#123456');
    expect(after).toBe(OURS.replace('--accent: #b8492c;', '--accent: #123456;'));
    expect(after.split('\n')).toHaveLength(OURS.split('\n').length);
    expect(readTokens(after).filter((token) => token.name === '--accent')[1]?.value).toBe(
      '#e0714d',
    );
  });
});

/* ========================================================================== */
/* Where a slider stops                                                        */
/* ========================================================================== */

describe('the steps a slider snaps to', () => {
  it('snaps to the scale the project already thinks in', () => {
    expect(steps(named('--space-1'), tokens)).toEqual(['4px', '8px', '12px', '16px']);
  });

  it('always includes where the value is now, on scale or not', () => {
    const odd: Token = { name: '--space-9', value: '17px', kind: 'space', line: 1 };
    expect(steps(odd, tokens)).toEqual(['4px', '8px', '12px', '16px', '17px']);
  });

  it('falls back to a ramp when there is no scale to learn from', () => {
    const ramp = steps(named('--radius-md'), tokens);
    expect(ramp).toContain('10px');
    expect(ramp[0]).toBe('0px');
    expect(ramp).toEqual([...ramp].sort((a, b) => parseFloat(a) - parseFloat(b)));
    expect(new Set(ramp).size).toBe(ramp.length);
  });

  it('ramps in whatever unit the value is written in', () => {
    const type = steps(named('--text-base'), tokens);
    expect(type).toContain('1rem');
    expect(type.every((step) => step.endsWith('rem'))).toBe(true);
  });

  it('has nothing to offer for a value a slider cannot move', () => {
    expect(steps(named('--brand'), tokens)).toEqual([]);
    expect(steps(named('--font-ui'), tokens)).toEqual([]);
    expect(steps(named('--shadow-md'), tokens)).toEqual([]);
  });

  it('measures an unfamiliar unit from where the value already is', () => {
    expect(steps(named('--dur-ui'), tokens)).toEqual([
      '100ms',
      '150ms',
      '200ms',
      '250ms',
      '300ms',
      '400ms',
    ]);
  });

  it('works from the token alone when nothing else is handed to it', () => {
    expect(steps(named('--space-1'))).toContain('4px');
  });

  it('learns a scale that is not ours', () => {
    const theirs = readTokens(
      ':root { --gap-xs: 6px; --gap-sm: 12px; --gap-md: 18px; --gap-lg: 24px; }',
    );
    const first = theirs[0];
    expect(first && steps(first, theirs)).toEqual(['6px', '12px', '18px', '24px']);
  });

  it('needs more than a pair before it calls something a scale', () => {
    const thin = readTokens(':root { --gap-xs: 6px; --gap-sm: 13px; }');
    const first = thin[0];
    expect(first && steps(first, thin)).not.toContain('13px');
  });
});

/* ========================================================================== */
/* A burst of dragging                                                         */
/* ========================================================================== */

const drag = (name: string, values: readonly string[]): Nudge[] =>
  values.slice(0, -1).map((from, at) => ({ name, from, to: values[at + 1] ?? from }));

describe('settling a burst of edits', () => {
  it('collapses three seconds of dragging into the change it made', () => {
    const burst = drag('--space-4', ['16px', '17px', '18px', '19px', '20px']);
    expect(burst).toHaveLength(4);
    expect(settle(burst)).toEqual([{ name: '--space-4', from: '16px', to: '20px' }]);
  });

  it('drops a value that was dragged back to where it started', () => {
    expect(settle(drag('--space-4', ['16px', '24px', '32px', '16px']))).toEqual([]);
  });

  it('keeps the order each token was first touched', () => {
    const burst: Nudge[] = [
      { name: '--radius-md', from: '10px', to: '11px' },
      { name: '--brand', from: '#000000', to: '#111111' },
      { name: '--radius-md', from: '11px', to: '14px' },
      { name: '--brand', from: '#111111', to: '#222222' },
      { name: '--space-1', from: '4px', to: '4px' },
    ];
    expect(settle(burst)).toEqual([
      { name: '--radius-md', from: '10px', to: '14px' },
      { name: '--brand', from: '#000000', to: '#222222' },
    ]);
  });

  it('treats a name with and without its dashes as one thing', () => {
    const burst: Nudge[] = [
      { name: '--space-1', from: '4px', to: '6px' },
      { name: 'space-1', from: '6px', to: '8px' },
    ];
    expect(settle(burst)).toEqual([{ name: '--space-1', from: '4px', to: '8px' }]);
  });

  it('has nothing to say about an empty burst', () => {
    expect(settle([])).toEqual([]);
  });

  it('ignores whitespace when deciding a change is a no-op', () => {
    expect(settle([{ name: '--brand', from: ' #fff ', to: '#fff' }])).toEqual([]);
  });

  it('is stable: settling twice says the same thing', () => {
    const burst = drag('--space-4', ['16px', '18px', '20px']);
    expect(settle(settle(burst))).toEqual(settle(burst));
  });
});

/* ========================================================================== */
/* What the timeline says about it                                             */
/* ========================================================================== */

describe('the title a burst is saved under', () => {
  it('says which way the spacing went', () => {
    expect(saysNudge(drag('--space-4', ['16px', '20px', '24px']))).toBe('Loosened the spacing');
    expect(saysNudge(drag('--space-4', ['24px', '20px', '16px']))).toBe('Tightened the spacing');
  });

  it('speaks about corners', () => {
    expect(saysNudge([{ name: '--radius-md', from: '10px', to: '16px' }])).toBe(
      'Rounded the corners a little more',
    );
    expect(saysNudge([{ name: '--radius-md', from: '16px', to: '10px' }])).toBe(
      'Rounded the corners a little less',
    );
  });

  it('speaks about text when it is text that changed', () => {
    expect(saysNudge([{ name: '--text-base', from: '1rem', to: '1.125rem' }])).toBe(
      'Made the text a little bigger',
    );
    expect(saysNudge([{ name: '--text-base', from: '1rem', to: '0.875rem' }])).toBe(
      'Made the text a little smaller',
    );
    expect(saysNudge([{ name: '--topbar-height', from: '38px', to: '44px' }])).toBe(
      'Adjusted the sizing',
    );
  });

  it('counts colours rather than naming them', () => {
    expect(saysNudge([{ name: '--brand', from: '#000000', to: '#3355ff' }])).toBe(
      'Changed a colour',
    );
    expect(
      saysNudge([
        { name: '--brand', from: '#000000', to: '#3355ff' },
        { name: '--paper-colour', from: '#ffffff', to: '#fafafa' },
      ]),
    ).toBe('Changed a few colours');
  });

  it('stays general when several kinds of thing moved at once', () => {
    expect(
      saysNudge([
        { name: '--brand', from: '#000000', to: '#3355ff' },
        { name: '--space-4', from: '16px', to: '20px' },
      ]),
    ).toBe('Adjusted the styling');
  });

  it('settles first, so a burst and its net change read the same', () => {
    const burst = drag('--space-4', ['16px', '17px', '18px', '19px', '20px']);
    expect(saysNudge(burst)).toBe(saysNudge([{ name: '--space-4', from: '16px', to: '20px' }]));
  });

  it('still has a sentence when nothing survived settling', () => {
    expect(saysNudge([])).toBe('Adjusted the styling');
    expect(saysNudge(drag('--space-4', ['16px', '24px', '16px']))).toBe('Adjusted the styling');
  });

  it('says none of the words the timeline has retired', () => {
    const said = [
      saysNudge([]),
      saysNudge([{ name: '--brand', from: '#000', to: '#111' }]),
      saysNudge([{ name: '--space-4', from: '16px', to: '20px' }]),
      saysNudge([{ name: '--space-4', from: '20px', to: '16px' }]),
      saysNudge([{ name: '--space-4', from: '16px', to: 'clamp(1rem, 2vw, 2rem)' }]),
      saysNudge([{ name: '--radius-md', from: '10px', to: '16px' }]),
      saysNudge([{ name: '--text-base', from: '1rem', to: '1.25rem' }]),
      saysNudge([{ name: '--shadow-md', from: '0 1px 2px #000', to: '0 2px 8px #000' }]),
      saysNudge([
        { name: '--shadow-md', from: '0 1px 2px #000', to: '0 2px 8px #000' },
        { name: '--shadow-sm', from: '0 1px 1px #000', to: '0 1px 2px #000' },
      ]),
      saysNudge([{ name: '--dur-ui', from: '200ms', to: '240ms' }]),
    ];
    for (const sentence of said) {
      expect(sentence).not.toMatch(/token|variable|css|property|commit|colour value|px|rem/i);
      expect(sentence.length).toBeLessThanOrEqual(72);
      expect(sentence).toMatch(/^[A-Z]/);
      expect(sentence).not.toMatch(/[.!]$/);
    }
  });
});
