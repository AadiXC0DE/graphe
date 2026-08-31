/** Everything that must name a project in a folder that holds several.
 *
 * The parent of a polyrepo is not a repository. Anything git-shaped that reads
 * it instead of a child answers about nothing: an empty diff, a blank design
 * view, a changelog with no entries, "not a github repository".
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const MAIN = read('../electron/main.ts');
const APP = read('../src/App.tsx');
const OVERVIEW = read('../src/components/Overview.tsx');

describe('the shell reads the project, not the folder holding it', () => {
  /** Each entry: the channel, and the parent-shaped expression it must not use. */
  const mustResolve: readonly [string, RegExp][] = [
    ['CHANNEL.changesLook', /new ProjectHistory\(open\.path\)\.diffFor/],
    ['CHANNEL.changesDrop', /new ProjectHistory\(open\.path\)\.dropChanges/],
    ['CHANNEL.landing', /landingNow\(open\.path/],
    ['CHANNEL.checkWidths', /makeAndServe\(\{ folder: open\.path/],
    ['CHANNEL.pages', /filesUnder\(open\.path\)/],
    ['CHANNEL.shareReview', /versionsOf\(open\.held\.timeline\)/],
    ['CHANNEL.repoLook', /readRepo\(open\)/],
    ['CHANNEL.alwaysDoes', /alwaysFile\(open\.path\)/],
  ];

  for (const [channel, parent] of mustResolve) {
    it(`${channel} resolves the folder rather than assuming the parent`, () => {
      expect(MAIN).not.toMatch(parent);
    });
  }

  it('discarding a hunk snapshots the project it is discarding from', () => {
    const at = MAIN.indexOf('CHANNEL.changesDrop');
    const block = MAIN.slice(at, at + 1400);
    expect(block).toContain('await timelineFor(open, where)');
    expect(block).not.toContain('open.held.timeline');
  });
});

describe('the window names the project it is acting on', () => {
  it('the design view reads that project’s stylesheet, not the parent’s', () => {
    expect(APP).toContain('desk?.repoStyles[named]');
  });

  it('saving the design says so when it is refused, rather than looking dead', () => {
    const at = APP.indexOf('bridge\n      .designCommit');
    const block = APP.slice(at === -1 ? APP.indexOf('.designCommit(') : at, APP.indexOf('.designCommit(') + 600);
    expect(block).toContain('troubleHere(answer.trouble)');
  });

  it('the omnibar can find a commit in any of the projects', () => {
    expect(APP).toContain('const barVersions');
    expect(APP).toContain('fromRepo.current[found.version.id]');
    expect(APP).not.toContain('versions: desk?.versions ?? [],');
  });

  it('the preview in the project menu behaves like the pill beside it', () => {
    expect(APP).not.toContain('onPreview={() => void seeIt()}');
    // Both start one for whichever project the panel is showing, and both only
    // reveal a page that is already served. The row's own press is gone, so
    // these two are the whole of the way in.
    expect(
      APP.match(/if \(pane === 'off'\) void seeIt\(undefined, undefined, panelRepoNow\.current \?\? undefined\);/g)
        ?.length,
    ).toBe(2);
    expect(APP.match(/else movePane\('split'\);/g)?.length).toBe(2);
  });

  it('the panel tells the window which project it is showing', () => {
    // Through a ref, and only when the name changes — see tests/render-loop.
    expect(OVERVIEW).toContain('tellWhose.current?.(whose?.name ?? null)');
    expect(APP).toContain('onWhose={(name) => {');
  });

  it('the band at the foot acts on the project the panel is showing', () => {
    expect(OVERVIEW).toContain('onUndo={(versionId) => onPutBack(versionId, whose?.name)}');
    expect(OVERVIEW).toContain('onHandOver={() => onHandOver(whose?.name)}');
    expect(OVERVIEW).toContain('onShare={() => onShare(whose?.name)}');
  });

  it('the panel is drawn at all for a folder that only holds projects', () => {
    expect(APP).toContain("(desk.overview?.repos?.length ?? 0) > 0 ||");
  });
});
