/** Property tests for path containment — the one question the Guard asks about
 *  every location it is handed, and the answer everything downstream trusts.
 *
 *  guard.test.ts pins the escapes we thought of. This file generates the ones we
 *  did not, out of a seeded generator, so any failure reproduces exactly from the
 *  seed printed beside it.
 *
 *  Nothing here is a snapshot. Every test states a rule that has to hold for
 *  every input, because a rule survives a rewrite of the file and a recorded
 *  answer does not. The bias under test is the one the file was written with:
 *  unsure means outside. A false "outside" costs a question; a false "inside"
 *  costs somebody their work. */

import { describe, expect, it } from 'vitest';
import {
  containsPath,
  isCredentialPath,
  isInsideProject,
  isProjectRoot,
  normalizePosixPath,
  shipsToBrowser,
  toPosix,
} from '../src/agent/guard/paths';

const ROOT = '/Users/mira/Projects/portfolio';

/** Seeded, so a failure is a failure somebody else can reproduce. xorshift32. */
function random(seed: number): () => number {
  let state = seed >>> 0 || 1;
  return () => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 4294967296;
  };
}

function pick<T>(next: () => number, items: readonly T[]): T {
  return items[Math.floor(next() * items.length)] as T;
}

/** Every shape somebody has ever used to walk out of a folder, plus the
 *  ordinary characters they hide between. */
const PIECES: readonly string[] = [
  ...'abcXYZ019',
  ' ',
  '\t',
  '\n',
  '.',
  '..',
  '...',
  '/',
  '//',
  '\\',
  '\\\\',
  '~',
  '$',
  '`',
  '${HOME}',
  '%HOME%',
  '%2e',
  '%2f',
  '%2E%2E',
  '%252e',
  '%25252f',
  '%c0%af',
  '%',
  ':',
  'C:',
  '-',
  '_',
  '.env',
  '.ssh',
  '.git',
  'src',
  'App.tsx',
  '\u0000',
  '\u0007',
  '\u007f',
  '\u00a0',
  '\u200b',
  '\u202e',
  '\ufeff',
  '\u0435',
  '\uff0f',
  '\u{1f600}',
  '\ud800',
];

function junk(next: () => number, maxPieces = 12): string {
  const count = Math.floor(next() * maxPieces);
  let out = '';
  for (let index = 0; index < count; index++) out += pick(next, PIECES);
  return out;
}

/** Folder and file names with nothing clever in them. Used to check the answer
 *  has not simply collapsed to "no". */
const PLAIN: readonly string[] = [
  'src',
  'components',
  'App.tsx',
  'my photo.png',
  'deep',
  'a-b_c',
  '.hidden',
  'assets',
];

function plainPath(next: () => number): string {
  const count = 1 + Math.floor(next() * 4);
  const parts: string[] = [];
  for (let index = 0; index < count; index++) parts.push(pick(next, PLAIN));
  return parts.join('/');
}

/** The root as the file itself would read it, worked out here rather than asked
 *  for, so the containment check is compared against something independent. */
function cleanRoot(root: string): string {
  return normalizePosixPath(toPosix(root.trim()));
}

function insertAt(text: string, at: number, piece: string): string {
  return text.slice(0, at) + piece + text.slice(at);
}

/* ========================================================================== */
/* The floor: it answers, it answers the same way, and it never falls over      */
/* ========================================================================== */

describe('the containment check holds up under anything', () => {
  const ROOTS = [
    ROOT,
    `${ROOT}/`,
    '/',
    '',
    'relative/root',
    '/Users/mira/Projects/Portfolio',
    '/Users/mira/My Projects/portfolio',
    '/Users/mira/100%25/portfolio',
    '$HOME/portfolio',
    `${ROOT} `,
  ];

  it('never throws, whatever it is handed', () => {
    const next = random(20240817);
    for (let round = 0; round < 8000; round++) {
      const root = pick(next, ROOTS);
      const candidate = junk(next);
      expect(() => containsPath(root, candidate)).not.toThrow();
      expect(() => isCredentialPath(candidate)).not.toThrow();
      expect(() => shipsToBrowser(candidate)).not.toThrow();
      expect(() => isProjectRoot(root, candidate)).not.toThrow();
    }
  });

  it('gives the same answer to the same question every time', () => {
    const next = random(11);
    for (let round = 0; round < 20000; round++) {
      const root = pick(next, ROOTS);
      const candidate = junk(next);
      const first = containsPath(root, candidate);
      const second = containsPath(root, candidate);
      expect(JSON.stringify(second), JSON.stringify({ root, candidate })).toBe(JSON.stringify(first));
      expect(isInsideProject(root, candidate)).toBe(first.inside);
    }
  });

  it('only ever says "inside" about somewhere under the project folder', () => {
    const next = random(524287);
    for (let round = 0; round < 20000; round++) {
      const root = pick(next, ROOTS);
      const candidate = junk(next);
      const check = containsPath(root, candidate);
      if (!check.inside) continue;
      const where = check.resolved;
      const base = cleanRoot(root);
      expect(where, JSON.stringify({ root, candidate })).not.toBeNull();
      const under = where === base || (where ?? '').startsWith(base === '/' ? '/' : `${base}/`);
      expect(under, JSON.stringify({ root, candidate, where, base })).toBe(true);
      // Nothing left to resolve: a `..` still in the answer is a `..` nobody checked.
      expect(normalizePosixPath(where ?? ''), JSON.stringify({ root, candidate })).toBe(where);
    }
  });

  it('always explains itself when the answer is no', () => {
    const next = random(97);
    for (let round = 0; round < 5000; round++) {
      const check = containsPath(ROOT, junk(next));
      if (check.inside) continue;
      expect(check.reason ?? '', 'a refusal with nothing to read').not.toBe('');
    }
  });

  it('is still willing to say yes, so the answer has not collapsed to "no"', () => {
    const next = random(3);
    let allowed = 0;
    for (let round = 0; round < 2000; round++) {
      const candidate = plainPath(next);
      expect(isInsideProject(ROOT, candidate), candidate).toBe(true);
      expect(isInsideProject(ROOT, `${ROOT}/${candidate}`), candidate).toBe(true);
      expect(isInsideProject(ROOT, `./${candidate}`), candidate).toBe(true);
      allowed += 1;
    }
    expect(allowed).toBe(2000);
  });
});

/* ========================================================================== */
/* Walking out of the folder, in every spelling                                */
/* ========================================================================== */

describe('nothing spelled cleverly gets back in', () => {
  const ESCAPES: readonly string[] = [
    '../x',
    '../../etc/passwd',
    '/etc/hosts',
    '~/notes.txt',
    '~mira/notes.txt',
    '$HOME/notes.txt',
    '${HOME}/notes.txt',
    '%USERPROFILE%/notes.txt',
    'C:\\Windows\\System32',
    '..\\..\\x',
    'src/../../y',
    `${ROOT}-evil/steal.txt`,
    `${ROOT}/../portfolio-evil/steal.txt`,
    '//server/share/file.txt',
    '\u0000/x',
  ];

  it('percent-encoding any part of a way out does not open it', () => {
    const next = random(424242);
    for (let round = 0; round < 20000; round++) {
      const base = pick(next, ESCAPES);
      let written = '';
      for (const character of base) {
        const code = character.codePointAt(0) ?? 0;
        if (code >= 0x80 || next() > 0.4) {
          written += character;
          continue;
        }
        const single = `%${code.toString(16).padStart(2, '0')}`;
        written += next() < 0.5 ? single : single.replace('%', '%25');
      }
      expect(isInsideProject(ROOT, written), `${base} written as ${JSON.stringify(written)}`).toBe(false);
    }
  });

  it('swapping separators for the Windows ones does not open it either', () => {
    const next = random(8);
    for (let round = 0; round < 5000; round++) {
      const base = pick(next, ESCAPES);
      let written = '';
      for (const character of base) {
        if (character === '/' && next() < 0.6) written += next() < 0.5 ? '\\' : '\\\\';
        else written += character;
      }
      expect(isInsideProject(ROOT, written), written).toBe(false);
    }
  });

  it('enough steps up leaves the folder from anywhere inside it', () => {
    const next = random(6700417);
    for (let round = 0; round < 5000; round++) {
      const candidate = plainPath(next);
      const where = containsPath(ROOT, candidate).resolved ?? '';
      const depth = where.split('/').length;
      expect(isInsideProject(ROOT, `${candidate}${'/..'.repeat(depth + 1)}`), candidate).toBe(false);
    }
  });

  it('a folder standing next to the project is not the project', () => {
    const next = random(13);
    const tail = 'abcXYZ019-._';
    for (let round = 0; round < 5000; round++) {
      let suffix = '';
      const count = 1 + Math.floor(next() * 6);
      for (let index = 0; index < count; index++) {
        suffix += tail[Math.floor(next() * tail.length)] as string;
      }
      expect(isInsideProject(ROOT, `${ROOT}${suffix}`), `${ROOT}${suffix}`).toBe(false);
    }
  });

  it('a shortcut, a home folder or a hidden character anywhere makes it outside', () => {
    const next = random(271828);
    for (let round = 0; round < 5000; round++) {
      const candidate = plainPath(next);
      expect(isInsideProject(ROOT, `~/${candidate}`)).toBe(false);
      expect(isInsideProject(ROOT, `~${candidate}`)).toBe(false);
      const at = Math.floor(next() * (candidate.length + 1));
      for (const piece of ['$', '`', '${HOME}', '%TEMP%', '\u0000', '\u0007', '\u007f']) {
        const spoiled = insertAt(candidate, at, piece);
        expect(isInsideProject(ROOT, spoiled), JSON.stringify(spoiled)).toBe(false);
      }
    }
  });

  it('refuses everything when it cannot tell where the project is', () => {
    const next = random(5);
    for (const root of ['', '   ', 'relative/root', './root', '$HOME/project', '`pwd`', '/root/\u0000']) {
      for (let round = 0; round < 500; round++) {
        expect(isInsideProject(root, plainPath(next)), root).toBe(false);
        expect(isInsideProject(root, junk(next)), root).toBe(false);
      }
    }
  });

  it('the project folder itself is only ever recognised from inside the folder', () => {
    const next = random(17);
    for (let round = 0; round < 5000; round++) {
      const candidate = junk(next);
      if (!isProjectRoot(ROOT, candidate)) continue;
      expect(isInsideProject(ROOT, candidate), candidate).toBe(true);
      expect(containsPath(ROOT, candidate).resolved, candidate).toBe(cleanRoot(ROOT));
    }
  });
});

/* ========================================================================== */
/* Promptness                                                                  */
/* ========================================================================== */

describe('an answer arrives promptly', () => {
  it('does not stall on long or pathological text', () => {
    const long = 20000;
    const shapes = [
      '%'.repeat(long),
      '%25'.repeat(long / 3),
      '%2e'.repeat(long / 3),
      'a'.repeat(long),
      '../'.repeat(long / 3),
      `${'a/'.repeat(long / 2)}..`,
      '\\'.repeat(long),
      `\${${':'.repeat(long - 3)}`,
      `${ROOT}/${'x'.repeat(long)}`,
    ];
    const started = performance.now();
    for (const shape of shapes) {
      expect(() => containsPath(ROOT, shape)).not.toThrow();
      expect(() => containsPath(shape, 'src/App.tsx')).not.toThrow();
    }
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
