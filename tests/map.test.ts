/** How a project is put together.
 *
 * The map exists so a big request can be broken into pieces that touch
 * different areas instead of colliding. What is checked here is that the shape
 * it reports is the shape of the files it was given — and that it says what it
 * does not know rather than leaving a folder out quietly.
 */

import { describe, expect, it } from 'vitest';

import { MAP_WORDS, areaOf, bringsIn, landsAt, mapFrom, saysMap } from '../src/files/map';

const file = (path: string, text = '') => ({ path, text });

/* ========================================================================== */
/* MP-01 reading one file                                                      */
/* ========================================================================== */

describe('MP-01 what one file says about itself', () => {
  it('belongs to its own folder, and a file at the top belongs to the project', () => {
    expect(areaOf('src/components/Board.tsx')).toBe('src/components');
    expect(areaOf('src/App.tsx')).toBe('src');
    expect(areaOf('vite.config.ts')).toBe('the project root');
  });

  it('finds every way a file brings another one in', () => {
    const text = [
      "import Board from './Board';",
      "import { one } from '../work/board';",
      "export { two } from './two';",
      "import './styles.css';",
      "const three = require('./three');",
      "import type { Four } from './four';",
    ].join('\n');
    const found = bringsIn(text);
    for (const one of ['./Board', '../work/board', './two', './styles.css', './three', './four']) {
      expect(found).toContain(one);
    }
  });

  /* Found by mapping this project: a doc comment with the word "from" and a
     quote in it swallowed several lines of prose, and the prose arrived as the
     name of a folder. */
  it('does not read prose in a comment as a file it brings in', () => {
    const text = [
      "import Board from './Board';",
      '/** Estimates match on this first and fall back to `size` when it is',
      " *  unfamiliar. Taken from 'the older reading' and kept.",
      ' */',
    ].join('\n');
    expect(bringsIn(text)).toEqual(['./Board']);
  });

  it('works out where a relative address lands, and ignores packages', () => {
    expect(landsAt('src/components/Board.tsx', './Card')).toBe('src/components/Card');
    expect(landsAt('src/components/Board.tsx', '../work/board')).toBe('src/work/board');
    expect(landsAt('src/App.tsx', './lib/thread')).toBe('src/lib/thread');
    // A package belongs to nobody in this project.
    expect(landsAt('src/App.tsx', 'react')).toBeNull();
    expect(landsAt('src/App.tsx', '@earendil-works/pi-coding-agent')).toBeNull();
  });

  /* A sibling package in a monorepo is not this project's own folder of the
     same name. Clamping at the top turned one into the other, and then the real
     one was reported as reached by nobody. */
  it('says nothing about an address that leaves the project', () => {
    expect(landsAt('src/a.ts', '../../lib/x')).toBeNull();
    expect(landsAt('a.ts', '../../../etc/passwd')).toBeNull();
    expect(landsAt('src/deep/a.ts', '../../lib/x')).toBe('lib/x');
  });
});

/* ========================================================================== */
/* MP-02 the shape                                                             */
/* ========================================================================== */

describe('MP-02 the map itself', () => {
  const project = [
    file('src/App.tsx', "import Board from './components/Board';\nimport { orderWork } from './work/board';"),
    file('src/components/Board.tsx', "import { saysBoard } from '../work/board';\nimport './Board.css';"),
    file('src/components/Card.tsx', "import Board from './Board';"),
    file('src/work/board.ts', 'export const AT_A_TIME = 4;'),
    file('src/components/Board.css', '.board { display: grid; }'),
    file('node_modules/left/index.js', "import './out';"),
    file('src/components/Board.test.tsx', "import Board from './Board';"),
  ];

  it('counts the files in each folder, biggest first', () => {
    const map = mapFrom(project);
    expect(map.areas.map((one) => one.name)).toEqual(['src/components', 'src', 'src/work']);
    expect(map.areas[0]?.files).toBe(2);
  });

  it('says which folder reaches into which, and never into itself', () => {
    const map = mapFrom(project);
    const components = map.areas.find((one) => one.name === 'src/components');
    expect(components?.uses).toEqual(['src/work']);
    const work = map.areas.find((one) => one.name === 'src/work');
    expect(work?.uses).toEqual([]);
  });

  /* The one a piece of work gets pointed at: a file nothing else brings in is
     where a change starts from. */
  it('names the files nothing else brings in', () => {
    const map = mapFrom(project);
    expect(map.areas.find((one) => one.name === 'src')?.waysIn).toEqual(['src/App.tsx']);
    // Board is brought in by two others, so it is not a way in.
    expect(map.areas.find((one) => one.name === 'src/components')?.waysIn).toEqual([
      'src/components/Card.tsx',
    ]);
  });

  it('leaves out what is not the shape of the project', () => {
    const map = mapFrom(project);
    expect(map.areas.map((one) => one.name)).not.toContain('node_modules/left');
    // A test is what checks the project, not what it is made of.
    expect(map.read).toBe(4);
  });

  it('finds where how it looks is kept', () => {
    expect(mapFrom(project).styles).toEqual(['src/components/Board.css']);
  });

  it('has an answer for a folder with nothing readable in it', () => {
    const empty = mapFrom([]);
    expect(empty.areas).toEqual([]);
    expect(saysMap(empty)).toBe(MAP_WORDS.nothing);
  });
});

/* ========================================================================== */
/* MP-03 what it hands over                                                    */
/* ========================================================================== */

describe('MP-03 the words', () => {
  it('reads as a map rather than a listing', () => {
    const said = saysMap(
      mapFrom([
        file('src/App.tsx', "import x from './work/board';"),
        file('src/work/board.ts', 'export const one = 1;'),
      ]),
    );
    expect(said).toContain(MAP_WORDS.heading);
    expect(said).toContain('src: 1 file, reaches into src/work');
    expect(said).toContain('src/work: 1 file, reaches nothing else');
  });

  it('says when there was more than one reading holds', () => {
    const many = Array.from({ length: 4100 }, (_, at) => file(`src/a${String(at)}.ts`, ''));
    const map = mapFrom(many);
    expect(map.moreToRead).toBe(true);
    expect(saysMap(map)).toContain(MAP_WORDS.more);
  });
});
