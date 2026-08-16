/** Checking a change: the verdict read back out of a reply, and the briefs the
 *  reviewers are handed. Pure — no disk, no agents, no network — except the
 *  diff targets, which are exercised against a real git folder the way every
 *  history test is. */


import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { parseReview, reviewRequestFor, REVIEW_ANGLES, trimDiff } from '../src/agent/pi/review';
import { ProjectHistory, type ReviewTarget } from '../src/history/repo';
import type { ReviewVerdict } from '../src/agent/types';

const madeFolders: string[] = [];
afterAll(async () => {
  await Promise.all(madeFolders.map((folder) => rm(folder, { recursive: true, force: true })));
});

async function newFolder(): Promise<string> {
  const folder = await realpath(await mkdtemp(path.join(tmpdir(), 'graphe-review-')));
  madeFolders.push(folder);
  return folder;
}

/* ========================================================================== */
/* Reading a verdict out of a reply                                           */
/* ========================================================================== */

describe('the verdict in a reply', () => {
  it('reads a fenced review block into a card-shaped verdict', () => {
    const text = `I checked the change. Two genuine problems.

\`\`\`review
{"verdict": "needs-work", "summary": "Two things to fix before this ships.", "findings": [
  {"priority": 0, "file": "src/checkout.ts", "line": 41, "issue": "The total is read before it is saved.", "impact": "A refund can match the wrong amount.", "confidence": 92},
  {"priority": 2, "file": "src/checkout.ts", "line": 12, "issue": "The name is misleading.", "confidence": 55}
]}
\`\`\``;
    const verdict = parseReview(text);
    expect(verdict).not.toBeNull();
    expect(verdict?.kind).toBe('needs-work');
    expect(verdict?.summary).toBe('Two things to fix before this ships.');
    expect(verdict?.findings.length).toBe(2);
    const blocking = verdict?.findings[0];
    expect(blocking?.priority).toBe(0);
    expect(blocking?.file).toBe('src/checkout.ts');
    expect(blocking?.line).toBe(41);
    expect(blocking?.confidence).toBe(92);
  });

  it('recognises a clean verdict too', () => {
    const verdict = parseReview(
      'Looks good.\n```review\n{"verdict": "ships", "summary": "Nothing blocking.", "findings": [{"priority": 3, "issue": "A future idea.", "confidence": 40}]}\n```',
    );
    expect(verdict?.kind).toBe('ships');
  });

  it('ignores an ordinary reply with no review block', () => {
    expect(parseReview('I changed the header and checked the layout.')).toBeNull();
  });

  it('ignores a malformed block rather than inventing a card', () => {
    expect(parseReview('```review\nnot json at all\n```')).toBeNull();
    expect(parseReview('```review\n{"verdict": "maybe"}\n```')).toBeNull();
    expect(parseReview('```review\n{"verdict": "ships", "findings": []}\n```')).toBeNull();
  });

  it('clamps numbers instead of trusting them', () => {
    const text =
      '```review\n{"verdict": "ships", "findings": [{"priority": 9, "confidence": 400, "issue": "x"}]}\n```';
    const verdict = parseReview(text) as ReviewVerdict;
    expect(verdict.findings[0]?.priority).toBe(3);
    expect(verdict.findings[0]?.confidence).toBe(100);
  });
});

describe('the reviewer briefs', () => {
  it('gives every reviewer the same diff and one distinct angle', () => {
    const diff = '--- a/a\n+++ b/a\n@@ -1 +1 @@\n-old\n+new';
    const briefs = REVIEW_ANGLES.map((angle) => reviewRequestFor(diff, angle.line));
    expect(briefs.length).toBe(3);
    for (const brief of briefs) {
      expect(brief).toContain(diff);
      expect(brief).toContain('P<priority>');
    }
    expect(new Set(REVIEW_ANGLES.map((angle) => angle.key)).size).toBe(3);
  });

  it('cuts a diff too long for one review, and says it did', () => {
    const long = 'x'.repeat(70_000);
    const cut = trimDiff(long);
    expect(cut.length).toBeLessThan(long.length);
    expect(cut).toContain('longer than one review can hold');
  });
});

/* ========================================================================== */
/* The three ways to point at a change, on a real disk                        */
/* ========================================================================== */

async function madeHistory(): Promise<{ root: string; history: ProjectHistory }> {
  const root = await newFolder();
  const history = new ProjectHistory(root);
  await history.prepare();
  return { root, history };
}

describe('the diff targets', () => {
  it('reads the work not yet saved, new files included', async () => {
    const { root, history } = await madeHistory();
    await put(root, 'one.txt', 'one\n');
    await history.snapshot('First');
    await put(root, 'one.txt', 'one\nchanged\n');
    await put(root, 'fresh.txt', 'brand new\n');

    const diff = await history.diffFor({ kind: 'working' } satisfies ReviewTarget);
    expect(diff).toContain('changed');
    expect(diff).toContain('fresh.txt');
  });

  it('reads what one saved version changed, from the version before it', async () => {
    const { root, history } = await madeHistory();
    await put(root, 'one.txt', 'one\n');
    await history.snapshot('First');
    await put(root, 'one.txt', 'two\n');
    const second = await history.snapshot('Second');
    const version = (await history.versions({ limit: 1 }))[0];
    expect(version).toBeDefined();

    const diff = await history.diffFor({ kind: 'version', id: version?.id ?? '' });
    expect(diff).toContain('two');
    expect(second).toBeTruthy();
  });

  it('reads everything a named piece of work adds on top of now', async () => {
    const { root, history } = await madeHistory();
    await put(root, 'one.txt', 'one\n');
    await history.snapshot('Base');
    await put(root, 'one.txt', 'two\n');
    await history.snapshot('On another line');
    await history.nameLine('the-experiment', (await history.versions({ limit: 1 }))[0]?.id ?? '');
    // Back on the main line, the experiment is invisible.
    await put(root, 'one.txt', 'three\n');
    await history.snapshot('Back');

    const diff = await history.diffFor({ kind: 'line', name: 'the-experiment' });
    expect(diff).toContain('two');
  });
});

async function put(root: string, file: string, contents: string): Promise<void> {
  const target = path.join(root, file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, contents, 'utf8');
}