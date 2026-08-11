/** Which colours get read against which.
 *
 * Everything downstream of this file is measurement, and measurement is right
 * or wrong on its own terms. This is the guess, and the only guess in the
 * chain: a wrong pairing produces a confident, well-worded, entirely invented
 * problem in somebody's own vocabulary. So the tests here mostly ask when it
 * says nothing.
 */

import { describe, expect, it } from 'vitest';

import { pairsToCheck, paletteFrom, type Named, type Pairing } from '../src/design/pairs';
import { findTrouble } from '../src/design/legibility';

function wheres(pairs: readonly Pairing[]): readonly string[] {
  return pairs.map((one) => one.spot.where);
}

function names(pairs: readonly Pairing[]): readonly string[] {
  return pairs.map((one) => `${one.front.name}|${one.back.name}`);
}

const INK = '#1a1a19';
const MUTED = '#a3a3a0';
const PAPER = '#fbfbfa';
const SUNKEN = '#f1f1ee';

/* ========================================================================== */
/* P-01 names that say what they are                                           */
/* ========================================================================== */

describe('P-01 names that say what they are', () => {
  const tokens: Named[] = [
    { name: '--text', value: INK },
    { name: '--text-muted', value: MUTED },
    { name: '--bg', value: PAPER },
    { name: '--bg-sunken', value: SUNKEN },
  ];

  it('pairs every text colour with every surface', () => {
    expect(names(pairsToCheck(tokens))).toEqual([
      '--text|--bg',
      '--text|--bg-sunken',
      '--text-muted|--bg',
      '--text-muted|--bg-sunken',
    ]);
  });

  it('says where in the words the names were reaching for', () => {
    expect(wheres(pairsToCheck(tokens))).toEqual([
      'The text on the background',
      'The text on the sunken background',
      'Muted text on the background',
      'Muted text on the sunken background',
    ]);
  });

  it('carries the colours through as the project wrote them', () => {
    const one = pairsToCheck(tokens)[3];
    expect(one?.spot.front).toBe(MUTED);
    expect(one?.spot.back).toBe(SUNKEN);
    expect(one?.front.name).toBe('--text-muted');
  });

  it('leaves the size alone, so a pairing is judged as body text', () => {
    for (const pair of pairsToCheck(tokens)) expect(pair.spot.text).toBeUndefined();
  });

  it('gives every pairing an id of its own', () => {
    const found = pairsToCheck(tokens).map((one) => one.spot.id);
    expect(new Set(found).size).toBe(found.length);
  });

  it('reads every spelling of text', () => {
    for (const name of ['--fg', '--foreground', '--ink', '--text', '--colorTextMuted']) {
      const said = pairsToCheck([{ name, value: MUTED }, { name: '--surface', value: PAPER }]);
      expect(names(said)).toEqual([`${name}|--surface`]);
    }
  });

  it('reads every spelling of a surface', () => {
    for (const name of ['--bg', '--background', '--surface', '--card', '--panel', '--paper']) {
      const said = pairsToCheck([{ name: '--ink', value: INK }, { name, value: PAPER }]);
      expect(names(said)).toEqual([`--ink|${name}`]);
    }
  });

  it('takes a name that says both for text, because that is the only way round it happens', () => {
    // `--card-foreground` is text on a card; nothing means the reverse.
    const said = pairsToCheck([
      { name: '--card-foreground', value: MUTED },
      { name: '--card', value: PAPER },
    ]);
    expect(names(said)).toEqual(['--card-foreground|--card']);
    expect(wheres(said)).toEqual(['Card text on the card background']);
  });
});

/* ========================================================================== */
/* P-02 names that say nothing                                                 */
/* ========================================================================== */

describe('P-02 names that say nothing', () => {
  it('is empty when nothing was handed over', () => {
    expect(pairsToCheck([])).toEqual([]);
  });

  it('is empty when no name gives it anything to go on', () => {
    expect(
      pairsToCheck([
        { name: '--grey-100', value: '#f4f4f4' },
        { name: '--grey-500', value: '#8a8a8a' },
        { name: '--grey-900', value: '#151515' },
        { name: '--blue', value: '#2b6cb0' },
      ]),
    ).toEqual([]);
  });

  it('is empty when a lone word could go either way', () => {
    // Half the systems in the world call a pale grey background "muted".
    expect(pairsToCheck([{ name: '--muted', value: '#f0f0ef' }, { name: '--faint', value: MUTED }]))
      .toEqual([]);
  });

  it('is empty when the only named side has nobody to pair with', () => {
    expect(pairsToCheck([{ name: '--text', value: INK }])).toEqual([]);
    expect(pairsToCheck([{ name: '--bg', value: PAPER }])).toEqual([]);
  });

  it('drops anything it cannot measure rather than guessing at it', () => {
    expect(
      pairsToCheck([
        { name: '--text', value: 'var(--ink)' },
        { name: '--bg', value: PAPER },
      ]),
    ).toEqual([]);
  });

  it('never takes a hairline, a shadow or a disabled colour for either role', () => {
    for (const name of ['--border', '--divider-text', '--text-disabled', '--shadow-surface']) {
      expect(pairsToCheck([{ name, value: MUTED }, { name: '--bg', value: PAPER }])).toEqual([]);
    }
  });

  it('never reads the label off a button against the page behind it', () => {
    // White on the accent is white on a button, and it is on no page anywhere.
    for (const name of ['--accent-text', '--brand-fg', '--primary-foreground']) {
      const said = pairsToCheck([
        { name, value: '#ffffff' },
        { name: '--text', value: INK },
        { name: '--bg', value: PAPER },
      ]);
      expect(names(said)).toEqual(['--text|--bg']);
    }
  });
});

/* ========================================================================== */
/* P-03 lightness, where the names ran out                                     */
/* ========================================================================== */

describe('P-03 lightness, where the names ran out', () => {
  it('takes a colour clear of every surface for the text nobody named', () => {
    const said = pairsToCheck([
      { name: '--bg', value: PAPER },
      { name: '--slate-600', value: '#6b6b68' },
    ]);
    expect(names(said)).toEqual(['--slate-600|--bg']);
  });

  it('takes a colour clear of the text for the surface nobody named', () => {
    const said = pairsToCheck([
      { name: '--ink', value: INK },
      { name: '--porcelain', value: PAPER },
    ]);
    expect(names(said)).toEqual(['--ink|--porcelain']);
  });

  it('leaves a colour that sits close to the surface alone', () => {
    // Another shade of the same paper, or a border somebody never named one.
    expect(
      pairsToCheck([
        { name: '--bg', value: PAPER },
        { name: '--hairline', value: '#eeeeec' },
      ]),
    ).toEqual([]);
  });

  it('keeps a fill colour out of the guess a name never made', () => {
    for (const name of ['--brand', '--accent-strong', '--danger']) {
      expect(pairsToCheck([{ name: '--bg', value: PAPER }, { name, value: '#b8492c' }])).toEqual([]);
    }
  });

  it('does not reach for lightness once both sides have been named', () => {
    const said = pairsToCheck([
      { name: '--text', value: INK },
      { name: '--bg', value: PAPER },
      { name: '--slate-600', value: '#6b6b68' },
    ]);
    expect(names(said)).toEqual(['--text|--bg']);
  });
});

/* ========================================================================== */
/* P-04 a colour is never read against itself                                  */
/* ========================================================================== */

describe('P-04 a colour is never read against itself', () => {
  it('will not pair one name with itself', () => {
    // A name that says both roles resolves to text, so it cannot be its own back.
    expect(pairsToCheck([{ name: '--text-bg', value: INK }])).toEqual([]);
  });

  it('will not pair two names holding the same colour', () => {
    expect(
      pairsToCheck([
        { name: '--text', value: '#101010' },
        { name: '--bg', value: '#101010' },
      ]),
    ).toEqual([]);
  });

  it('sees through two spellings of one colour', () => {
    expect(
      pairsToCheck([
        { name: '--text', value: '#ffffff' },
        { name: '--bg', value: 'rgb(255 255 255)' },
      ]),
    ).toEqual([]);
  });

  it('reads one set of a file that carries a light one and a dark one', () => {
    // The same names, written again lower down for the dark side. Crossing them
    // finds pale text on pale paper that nobody has ever seen together.
    const said = pairsToCheck([
      { name: '--text', value: INK },
      { name: '--bg', value: PAPER },
      { name: '--text', value: '#f2f2ef' },
      { name: '--bg', value: '#131312' },
    ]);
    expect(said).toHaveLength(1);
    expect(said[0]?.spot.front).toBe(INK);
    expect(said[0]?.spot.back).toBe(PAPER);
  });

  it('counts one colour under two names once on the same side', () => {
    const said = pairsToCheck([
      { name: '--text', value: INK },
      { name: '--ink', value: INK },
      { name: '--bg', value: PAPER },
    ]);
    expect(names(said)).toEqual(['--text|--bg']);
  });
});

/* ========================================================================== */
/* P-05 how many                                                               */
/* ========================================================================== */

describe('P-05 how many', () => {
  const many: Named[] = [
    ...['muted', 'faint', 'subtle', 'soft', 'dim', 'quiet'].map((word, at) => ({
      name: `--text-${word}`,
      value: `#${String(at + 1).repeat(6)}`,
    })),
    ...['card', 'panel', 'sunken', 'raised', 'canvas'].map((word, at) => ({
      name: `--bg-${word}`,
      value: `#f${String(at)}f${String(at)}f${String(at)}`,
    })),
  ];

  it('never asks for more rows than a panel can hold', () => {
    expect(pairsToCheck(many)).toHaveLength(12);
  });

  it('keeps four text colours and three surfaces, in the order the file had them', () => {
    const said = pairsToCheck(many);
    expect([...new Set(said.map((one) => one.front.name))]).toEqual([
      '--text-muted',
      '--text-faint',
      '--text-subtle',
      '--text-soft',
    ]);
    expect([...new Set(said.map((one) => one.back.name))]).toEqual([
      '--bg-card',
      '--bg-panel',
      '--bg-sunken',
    ]);
  });

  it('never says the same thing twice', () => {
    const said = wheres(pairsToCheck(many));
    expect(new Set(said).size).toBe(said.length);
  });

  it('says the hardest to read of the ones it can only say once', () => {
    // Five greys under names that all come out as "the text", and the palest of
    // them is the only one worth a row.
    const said = pairsToCheck([
      ...['#555555', '#666666', '#777777', '#888888'].map((value, at) => ({
        name: `--text-${at}`,
        value,
      })),
      { name: '--bg', value: '#ffffff' },
    ]);
    expect(names(said)).toEqual(['--text-3|--bg']);
  });
});

/* ========================================================================== */
/* P-06 the words that reach the screen                                        */
/* ========================================================================== */

describe('P-06 the words that reach the screen', () => {
  const everything: Named[] = [
    { name: '--text-muted', value: MUTED },
    { name: '--colorTextFaint', value: '#b5b5b2' },
    { name: '--fg-zeta-7', value: '#909090' },
    { name: '--bg-sunken', value: SUNKEN },
    { name: '--surface-card', value: PAPER },
    { name: '--panel', value: '#f7f7f5' },
  ];

  it('carries no part of a token name into the sentence', () => {
    for (const pair of pairsToCheck(everything)) {
      expect(pair.spot.where).not.toMatch(/--|_|\d/);
      for (const token of everything) {
        expect(pair.spot.where.toLowerCase()).not.toContain(token.name.toLowerCase());
      }
    }
  });

  it('carries no selector, no property and no mechanism', () => {
    for (const pair of pairsToCheck(everything)) {
      expect(pair.spot.where).not.toMatch(/[.#{}();:]/);
      expect(pair.spot.where.toLowerCase()).not.toMatch(
        /\b(css|token|variable|property|selector|hex|rgb|contrast|ratio|wcag)\b/,
      );
    }
  });

  it('reads as a sentence a designer would say out loud', () => {
    for (const pair of pairsToCheck(everything)) {
      expect(pair.spot.where).toMatch(/^[A-Z][a-z]* ?[a-z]* on the [a-z ]+$/);
    }
  });

  it('drops a word it has no way of saying rather than reading the name aloud', () => {
    const said = pairsToCheck([
      { name: '--fg-zeta-7', value: '#909090' },
      { name: '--bg', value: PAPER },
    ]);
    expect(wheres(said)).toEqual(['The text on the background']);
  });
});

/* ========================================================================== */
/* P-07 what the check makes of them                                           */
/* ========================================================================== */

describe('P-07 what the check makes of them', () => {
  const tokens: Named[] = [
    { name: '--text', value: INK },
    { name: '--text-muted', value: MUTED },
    { name: '--bg', value: PAPER },
    { name: '--bg-sunken', value: SUNKEN },
  ];

  it('finds the pale one and leaves the readable one alone', () => {
    const found = findTrouble(
      pairsToCheck(tokens).map((one) => one.spot),
      paletteFrom(tokens),
    );

    expect(found.map((one) => one.where)).toEqual([
      'Muted text on the sunken background',
      'Muted text on the background',
    ]);
  });

  it('offers a repair out of the project’s own colours', () => {
    const found = findTrouble(
      pairsToCheck(tokens).map((one) => one.spot),
      paletteFrom(tokens),
    );
    expect(found[0]?.fix?.fromScale).toBe(true);
    expect(found[0]?.fix?.colour).toBe(INK);
  });

  it('names that colour the way somebody would say it', () => {
    expect(paletteFrom(tokens)).toEqual([
      { name: 'text', value: INK },
      { name: 'text muted', value: MUTED },
      { name: 'bg', value: PAPER },
      { name: 'bg sunken', value: SUNKEN },
    ]);
  });

  it('keeps nothing it cannot measure out of the palette', () => {
    expect(paletteFrom([{ name: '--text', value: 'var(--x)' }])).toEqual([]);
  });
});
