/** Somewhere of its own to write.
 *
 * Nothing gave a run a place for anything temporary, so the model picked `/tmp`
 * and named folders after itself, and nothing ever removed them: twenty-two
 * gigabytes in a day. A conversation has a folder now, the standing block says
 * where it is, and every child of that conversation writes into it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import {
  forgetScratch,
  optionsWithScratch,
  scratchIn,
  scratchUnder,
} from '../src/agent/pi/childenv';
import { standingBlock, standingWords } from '../src/agent/pi/standing';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');

afterEach(() => {
  for (const one of ['/work/site', '/work/site/copy', '/elsewhere']) forgetScratch(one);
});

describe('which folder a child writes its temporary files in', () => {
  it('is the one claimed for the folder it runs in', () => {
    scratchUnder('/work/site', '/data/scratch/site/one');
    expect(scratchIn('/work/site')).toBe('/data/scratch/site/one');
    expect(scratchIn('/work/site/src/deep')).toBe('/data/scratch/site/one');
  });

  /* A checkout sits inside the project, so the nearer claim has to win or every
     conversation shares one folder. */
  it('is the nearest claim, not the first', () => {
    scratchUnder('/work/site', '/data/scratch/site/one');
    scratchUnder('/work/site/copy', '/data/scratch/site/two');
    expect(scratchIn('/work/site/copy/src')).toBe('/data/scratch/site/two');
  });

  it('is nothing at all for a folder nobody claimed', () => {
    expect(scratchIn('/elsewhere/thing')).toBeNull();
    expect(scratchIn(undefined)).toBeNull();
  });
});

describe('what a child is spawned with', () => {
  it('gets the three names a build tool actually reads', () => {
    scratchUnder('/work/site', '/data/scratch/site/one');
    const fixed = optionsWithScratch({ cwd: '/work/site', env: {} }, {});
    expect(fixed?.env).toMatchObject({
      TMPDIR: '/data/scratch/site/one',
      TMP: '/data/scratch/site/one',
      TEMP: '/data/scratch/site/one',
    });
  });

  it('keeps everything else about the spawn', () => {
    scratchUnder('/work/site', '/data/scratch/site/one');
    const fixed = optionsWithScratch({ cwd: '/work/site', env: { PATH: '/usr/bin' } }, {});
    expect(fixed?.env?.['PATH']).toBe('/usr/bin');
  });

  /* Whoever spawned it may have meant somewhere in particular. */
  it('leaves a spawn that already said where alone', () => {
    scratchUnder('/work/site', '/data/scratch/site/one');
    const asked = { cwd: '/work/site', env: { TMPDIR: '/data/scratch/site/one/sub' } };
    expect(optionsWithScratch(asked, {})).toBe(asked);
  });

  it('leaves a spawn outside any project exactly as it was', () => {
    const asked = { cwd: '/elsewhere' };
    expect(optionsWithScratch(asked, {})).toBe(asked);
  });
});

describe('what the model is told', () => {
  it('is the real path, so it can change into it', () => {
    const said = standingBlock({ list: null, goal: 'ship it', notes: [], scratch: '/data/scratch/site/one' });
    expect(said).toContain('/data/scratch/site/one');
    expect(said).toContain(standingWords.scratch('/data/scratch/site/one'));
  });

  it('says nothing about it when there is none', () => {
    expect(standingBlock({ list: null, goal: 'ship it', notes: [] })).not.toContain('Scratch folder');
  });
});

describe('the shell', () => {
  it('claims the conversation’s own folder every turn, so the two agree', () => {
    const at = main.indexOf('async function standingBlockFor(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('const scratch = scratchFor(project, address);');
    expect(block).toContain('scratchUnder(folderFor(open,');
  });

  it('keeps it under the app’s own folder, never in the project', () => {
    expect(main).toContain("join(app.getPath('userData'), 'scratch', leaf(project), leaf(address || 'shared'))");
  });

  it('lets go of one nothing has touched in a week', () => {
    expect(main).toContain('const SCRATCH_DAYS = 7;');
    expect(main).toContain('void sweepScratch();');
  });
});
