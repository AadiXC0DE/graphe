/** Checks a project writes down for itself.
 *
 * The failure this guards against is a review that quietly holds work up
 * against the wrong standards — either ignoring what the team wrote down, or
 * inventing checks when they wrote nothing.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { CHECK_WORDS, checkFromFile, checksBrief, projectChecks, usualChecks } from '../src/agent/pi/checks';
import { REVIEW_ANGLES, parseReview } from '../src/agent/pi/review';
import { reviewerBriefs } from '../src/agent/pi/tools';

function project(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'graphe-checks-'));
  for (const [path, text] of Object.entries(files)) {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text, 'utf8');
  }
  return root;
}

/* ========================================================================== */
/* CH-01 reading one check                                                     */
/* ========================================================================== */

describe('CH-01 one check, one file', () => {
  it('takes the name and the words from the front of the file', () => {
    const check = checkFromFile(
      '---\nname: Design system fit\ndescription: Every colour and space comes from a token.\n---\n\nMore words.',
      'design.md',
    );
    expect(check).toEqual({
      key: 'design',
      name: 'Design system fit',
      line: 'Every colour and space comes from a token.',
    });
  });

  /* Somebody should be able to write a check as an ordinary note. */
  it('reads a plain note with no front matter at all', () => {
    const check = checkFromFile('# Consumers\n\nNothing that uses this component breaks.', 'consumers.md');
    expect(check?.name).toBe('Consumers');
    expect(check?.line).toBe('Nothing that uses this component breaks.');
  });

  it('falls back to the file name when there is nothing else to call it', () => {
    expect(checkFromFile('Just some words.', 'no-dead-links.md')?.name).toBe('no dead links');
  });

  it('is not a check when there is nothing to look for', () => {
    expect(checkFromFile('# Only a heading', 'empty.md')).toBeNull();
    expect(checkFromFile('---\nname: Nothing\n---\n', 'nothing.md')).toBeNull();
  });
});

/* ========================================================================== */
/* CH-02 reading a project's folder                                            */
/* ========================================================================== */

describe('CH-02 what a project asks for', () => {
  it('finds them, in a settled order, so two reviews ask the same things', async () => {
    const root = project({
      '.agents/checks/b-tests.md': '# Tests\n\nSomething would catch this if it broke.',
      '.agents/checks/a-design.md': '# Design\n\nEvery space comes from a token.',
    });
    const found = await projectChecks(root);
    expect(found.map((one) => one.key)).toEqual(['a-design', 'b-tests']);
    expect(await projectChecks(root)).toEqual(found);
  });

  it('reads the other conventional folder too, and the nearer one wins', async () => {
    const root = project({
      '.agents/checks/fit.md': '# Fit\n\nThe project version.',
      '.pi/checks/fit.md': '# Fit\n\nThe inherited version.',
      '.pi/checks/other.md': '# Other\n\nStill read.',
    });
    const found = await projectChecks(root);
    expect(found.map((one) => one.line)).toEqual(['The project version.', 'Still read.']);
  });

  it('says nothing rather than guessing when a project has written none', async () => {
    expect(await projectChecks(project({}))).toEqual([]);
    expect(await projectChecks('/nowhere-at-all')).toEqual([]);
  });

  it('ignores what is not a check', async () => {
    const root = project({
      '.agents/checks/README.txt': 'not markdown',
      '.agents/checks/.hidden.md': '# Hidden\n\nnope',
      '.agents/checks/blank.md': '   ',
      '.agents/checks/real.md': '# Real\n\nyes',
    });
    expect((await projectChecks(root)).map((one) => one.key)).toEqual(['real']);
  });
});

/* ========================================================================== */
/* CH-03 what the reviewers are told                                           */
/* ========================================================================== */

describe('CH-03 the brief', () => {
  it('numbers them and asks for their names back', () => {
    const said = checksBrief([{ key: 'fit', name: 'Design fit', line: 'Tokens only.' }], true);
    expect(said).toContain(CHECK_WORDS.itsOwn);
    expect(said).toContain('1. Design fit — Tokens only.');
    expect(said).toContain('checks');
  });

  it('says plainly when nobody wrote any, so the usual three are not passed off as the project’s', () => {
    const said = checksBrief(usualChecks(), false);
    expect(said).toContain(CHECK_WORDS.usual);
    expect(said).not.toContain(CHECK_WORDS.itsOwn);
  });

  it('the usual three are still three, looking in three directions', () => {
    expect(usualChecks()).toHaveLength(3);
    expect(usualChecks().map((one) => one.key)).toEqual(REVIEW_ANGLES.map((one) => one.key));
  });

  it('gives every check its own reviewer, each carrying the same change', () => {
    const briefs = reviewerBriefs('diff --git a/x b/x', [
      { key: 'fit', line: 'Tokens only.' },
      { key: 'consumers', line: 'Nothing that uses it breaks.' },
    ]);
    expect(briefs.map((one) => one.key)).toEqual(['fit', 'consumers']);
    for (const brief of briefs) expect(brief.task).toContain('diff --git a/x b/x');
    expect(briefs[0]?.task).not.toBe(briefs[1]?.task);
  });
});

/* ========================================================================== */
/* CH-04 saying what was checked                                               */
/* ========================================================================== */

describe('CH-04 the verdict names what it was held up against', () => {
  const block = (body: string) => `Looks fine.\n\n\`\`\`review\n${body}\n\`\`\``;
  const one = '{"priority":1,"file":"a.ts","line":2,"issue":"A real problem","confidence":80}';

  it('carries the names through', () => {
    const verdict = parseReview(block(`{"verdict":"needs-work","checks":["Design fit","Tests"],"findings":[${one}]}`));
    expect(verdict?.checks).toEqual(['Design fit', 'Tests']);
  });

  it('says nothing rather than an empty line when the reviewer named none', () => {
    expect(parseReview(block(`{"verdict":"needs-work","findings":[${one}]}`))?.checks).toBeUndefined();
    expect(parseReview(block(`{"verdict":"needs-work","checks":["", 7],"findings":[${one}]}`))?.checks).toBeUndefined();
  });
});
