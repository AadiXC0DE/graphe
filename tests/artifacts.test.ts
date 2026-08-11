/** The band that shows what a turn made, rather than describing it.
 *
 *  Two things are worth guarding here: that nothing a build leaves behind ever
 *  reaches the panel, and that a swatch is only drawn for a real colour. */

import { describe, expect, it } from 'vitest';
import {
  MOST,
  artifactsAmong,
  isPalette,
  paletteFrom,
  saysArtifacts,
  type Artifact,
} from '../src/design/artifacts';

/** What sits in a project's working tree after a real build, with the work in
 *  the middle of it. */
const AFTER_A_BUILD: readonly string[] = [
  'node_modules/react/index.js',
  'node_modules/@acme/brand/logo.png',
  'node_modules/.vite/deps/react.js',
  'dist/assets/index-4f2a91.js',
  'dist/assets/index-4f2a91.js.map',
  'dist/assets/index-4f2a91.css',
  'dist/assets/hero-9d1c.png',
  'dist-electron/main.mjs',
  'coverage/lcov-report/index.html',
  'build/report.csv',
  '.git/COMMIT_EDITMSG',
  '.next/cache/thing.json',
  '.env',
  'package.json',
  'package-lock.json',
  'yarn.lock',
  'tsconfig.json',
  'tsconfig.node.json',
  'vite.config.ts',
  'src/App.tsx',
  'src/components/Card.tsx',
  'src/index.css',
  'README.md',
  'CHANGELOG.md',
  'LICENSE.md',
  'exports/hero.png',
  'exports/hero@2x.webp',
  'public/logo.svg',
  'src/styles/tokens.css',
  'content/homepage.md',
  'data/survey-results.csv',
];

function paths(found: readonly Artifact[]): string[] {
  return found.map((one) => one.path);
}

/* ========================================================================== */
/* What survives                                                              */
/* ========================================================================== */

describe('artifactsAmong', () => {
  it('keeps only the things a designer would open', () => {
    expect(paths(artifactsAmong(AFTER_A_BUILD))).toEqual([
      'exports/hero.png',
      'exports/hero@2x.webp',
      'public/logo.svg',
      'src/styles/tokens.css',
      'content/homepage.md',
      'data/survey-results.csv',
    ]);
  });

  it('lets nothing generated, locked or hidden through', () => {
    const kept = paths(artifactsAmong(AFTER_A_BUILD)).join(' ');
    for (const noise of ['node_modules', 'dist', 'coverage', 'build/', '.git', '.next', '.env']) {
      expect(kept).not.toContain(noise);
    }
  });

  it('leaves source, config and lockfiles alone', () => {
    expect(
      artifactsAmong([
        'src/App.tsx',
        'src/lib/tokens.ts',
        'vite.config.ts',
        'package.json',
        'package-lock.json',
        'pnpm-lock.yaml',
        'Cargo.lock',
        'tsconfig.json',
        'src/index.css',
        'theme.config.json',
      ]),
    ).toEqual([]);
  });

  it('skips the files at the root that nobody opens to look at', () => {
    expect(
      paths(
        artifactsAmong([
          'README.md',
          'CHANGELOG.md',
          'LICENSE.md',
          'LICENCE.txt',
          'CONTRIBUTING.md',
          'docs/readme.txt',
          'notes/brief.md',
        ]),
      ),
    ).toEqual(['notes/brief.md']);
  });

  it('reads a palette by its name and a table by its folder', () => {
    expect(
      artifactsAmong([
        'src/styles/brandColors.json',
        'src/data/records.json',
        'src/lib/state.json',
      ]).map((one) => [one.path, one.kind]),
    ).toEqual([
      ['src/styles/brandColors.json', 'palette'],
      ['src/data/records.json', 'data'],
    ]);
  });

  it('tidies windows slashes and a leading dot', () => {
    expect(paths(artifactsAmong(['.\\exports\\hero.png', 'exports\\hero.png']))).toEqual([
      'exports/hero.png',
    ]);
  });

  it('ignores blanks', () => {
    expect(artifactsAmong(['', '   '])).toEqual([]);
  });
});

/* ========================================================================== */
/* Order, cap and overflow                                                    */
/* ========================================================================== */

describe('the order they arrive in', () => {
  it('puts pictures first and data last', () => {
    const found = artifactsAmong([
      'data/rows.csv',
      'notes/copy.md',
      'brand/palette.json',
      'art/logo.svg',
      'art/hero.png',
    ]);
    expect(found.map((one) => one.kind)).toEqual(['image', 'vector', 'palette', 'words', 'data']);
  });

  it('keeps the written order within a kind', () => {
    expect(paths(artifactsAmong(['art/b.png', 'art/a.png', 'art/c.png']))).toEqual([
      'art/b.png',
      'art/a.png',
      'art/c.png',
    ]);
  });

  it('stops at twelve', () => {
    const many = Array.from({ length: 30 }, (_, index) => `exports/frame-${index}.png`);
    const found = artifactsAmong(many);
    expect(found).toHaveLength(MOST);
    expect(found[0]?.path).toBe('exports/frame-0.png');
    expect(found[MOST - 1]?.path).toBe('exports/frame-11.png');
  });

  it('says it is showing the first of them rather than counting what it dropped', () => {
    const many = Array.from({ length: 30 }, (_, index) => `exports/frame-${index}.png`);
    expect(saysArtifacts(artifactsAmong(many))).toBe('The first twelve things worth looking at.');
  });
});

/* ========================================================================== */
/* The line under the heading                                                 */
/* ========================================================================== */

describe('saysArtifacts', () => {
  it('is honest when there is nothing', () => {
    expect(saysArtifacts([])).toBe('Nothing to look at yet.');
  });

  it('names one thing without counting it', () => {
    expect(saysArtifacts(artifactsAmong(['exports/hero.png']))).toBe('A picture to look at.');
  });

  it('counts in words', () => {
    expect(saysArtifacts(artifactsAmong(['a.png', 'b.png', 'src/styles/tokens.css']))).toBe(
      'Two pictures and a set of colours to look at.',
    );
  });

  it('lists three kinds as a sentence', () => {
    expect(
      saysArtifacts(artifactsAmong(['a.png', 'src/styles/tokens.css', 'notes/copy.md'])),
    ).toBe('A picture, a set of colours and a page of copy to look at.');
  });

  it('never uses a word from a build log', () => {
    const sentence = saysArtifacts(artifactsAmong(AFTER_A_BUILD)).toLowerCase();
    for (const jargon of ['file', 'asset', 'artifact', 'output', 'svg', 'json']) {
      expect(sentence).not.toContain(jargon);
    }
  });
});

/* ========================================================================== */
/* The notes                                                                  */
/* ========================================================================== */

describe('the line under each name', () => {
  it('says what the thing is, plainly', () => {
    const found = artifactsAmong([
      'exports/hero.png',
      'exports/shot.jpg',
      'public/logo.svg',
      'src/styles/tokens.css',
      'content/homepage.md',
      'data/survey.csv',
      'data/records.json',
    ]);
    expect(found.map((one) => [one.name, one.note])).toEqual([
      ['hero.png', 'PNG · exported image'],
      ['shot.jpg', 'JPG · exported image'],
      ['logo.svg', 'SVG · a drawing'],
      ['tokens.css', 'your colour tokens'],
      ['homepage.md', 'a page of copy'],
      ['survey.csv', 'CSV · a table of rows'],
      ['records.json', 'JSON · a list of values'],
    ]);
  });
});

/* ========================================================================== */
/* Palettes                                                                   */
/* ========================================================================== */

describe('isPalette', () => {
  it('believes a name that says so', () => {
    expect(isPalette('src/styles/tokens.css')).toBe(true);
    expect(isPalette('src/styles/theme.css')).toBe(true);
    expect(isPalette('design/brandColors.json')).toBe(true);
    expect(isPalette('design/brand-colours.css')).toBe(true);
    expect(isPalette('design/swatches.json')).toBe(true);
    expect(isPalette('src/styles/_palette.scss')).toBe(true);
  });

  it('does not believe a name that does not', () => {
    expect(isPalette('src/index.css')).toBe(false);
    expect(isPalette('src/components/Card.css')).toBe(false);
    expect(isPalette('src/lib/tokenizer.css')).toBe(false);
    expect(isPalette('src/lib/tokens.ts')).toBe(false);
    expect(isPalette('docs/colours.md')).toBe(false);
  });

  it('asks the colours to agree when it can read them', () => {
    const real = ':root { --ink: #101014; --paper: #ffffff; --lift: rgb(91 91 214); }';
    expect(isPalette('src/styles/tokens.css', real)).toBe(true);
  });

  it('says no when the file turns out to hold something else', () => {
    const sizes = ':root { --radius: 8px; --gap: 12px; --shadow: 0 1px 2px; }';
    expect(isPalette('src/styles/tokens.css', sizes)).toBe(false);
    expect(isPalette('design/theme.json', '{"ink":"#101014","paper":"#ffffff"}')).toBe(false);
  });
});

describe('paletteFrom', () => {
  const STYLESHEET = `
    /* the brand */
    :root {
      --brand-ink: #101014;
      --brand-veil: #fff8;
      --brand-tint: #f05;
      --brand-lift: rgb(91 91 214);
      --brand-glow: rgba(91, 91, 214, 0.4);
      --brand-wash: hsl(210 40% 96%);
      --brand-deep: hsla(210, 40%, 16%, 0.9);
      --brand-paper: whitesmoke;
      --brand-edge: #101014ff;
      --radius: 8px;
      --font-ui: ui-sans-serif, system-ui;
      --ease: cubic-bezier(0.2, 0, 0, 1);
      --link: var(--brand-lift);
    }
  `;

  it('reads every colour syntax and skips everything else', () => {
    expect(paletteFrom(STYLESHEET)).toEqual([
      { name: 'brand-ink', value: '#101014' },
      { name: 'brand-veil', value: '#fff8' },
      { name: 'brand-tint', value: '#f05' },
      { name: 'brand-lift', value: 'rgb(91 91 214)' },
      { name: 'brand-glow', value: 'rgba(91, 91, 214, 0.4)' },
      { name: 'brand-wash', value: 'hsl(210 40% 96%)' },
      { name: 'brand-deep', value: 'hsla(210, 40%, 16%, 0.9)' },
      { name: 'brand-paper', value: 'whitesmoke' },
      { name: 'brand-edge', value: '#101014ff' },
    ]);
  });

  it('reads scss and less names too', () => {
    expect(paletteFrom('$ink: #101014;\n@paper: #ffffff;')).toEqual([
      { name: 'ink', value: '#101014' },
      { name: 'paper', value: '#ffffff' },
    ]);
  });

  it('shows the first spelling of a name when a dark block repeats it', () => {
    const both = `
      :root { --ink: #101014; }
      @media (prefers-color-scheme: dark) { :root { --ink: #f5f5f7; } }
    `;
    expect(paletteFrom(both)).toEqual([{ name: 'ink', value: '#101014' }]);
  });

  it('drops !important without dropping the colour', () => {
    expect(paletteFrom(':root { --ink: #101014 !important; }')).toEqual([
      { name: 'ink', value: '#101014' },
    ]);
  });

  it('walks a json palette and names the nesting', () => {
    const json = `{
      "brand": {
        "primary": { "value": "#5b5bd6" },
        "ink": "hsl(240 6% 10%)"
      },
      "accent": ["rgb(255 0 85)", "not-a-colour"],
      "paper": "whitesmoke",
      "spacing": { "sm": "8px" },
      "font": "Inter"
    }`;
    expect(paletteFrom(json)).toEqual([
      { name: 'brand primary', value: '#5b5bd6' },
      { name: 'brand ink', value: 'hsl(240 6% 10%)' },
      { name: 'accent 1', value: 'rgb(255 0 85)' },
      { name: 'paper', value: 'whitesmoke' },
    ]);
  });

  it('finds nothing where there is nothing', () => {
    expect(paletteFrom('body { margin: 0; padding: 0; }')).toEqual([]);
    expect(paletteFrom('{"spacing":{"sm":"8px","md":"16px"},"font":"Inter"}')).toEqual([]);
    expect(paletteFrom('')).toEqual([]);
  });

  it('turns down half a colour', () => {
    const wrong = `:root {
      --a: #abcde;
      --b: rgb(91 91);
      --c: hsl(a b c);
      --d: #12345;
      --e: rgb(91, 91, 214, 0.5, 2);
    }`;
    expect(paletteFrom(wrong)).toEqual([]);
  });
});
