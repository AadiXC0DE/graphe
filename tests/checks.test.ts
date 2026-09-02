/** Checks a project writes down for itself.
 *
 * The failure this guards against is a review that quietly holds work up
 * against the wrong standards — either ignoring what the team wrote down, or
 * inventing checks when they wrote nothing.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterAll, describe, expect, it, vi } from 'vitest';

import {
  CHECK_WORDS,
  CHECKS_AT_A_TIME,
  checkFromFile,
  checksBrief,
  gatheredChecks,
  projectChecks,
  runEachCheck,
  usualChecks,
  type ProjectCheck,
} from '../src/agent/pi/checks';
import { capsNow } from '../src/work/capacity';
import { ProjectHistory } from '../src/history/repo';
import { REVIEW_ANGLES, parseReview } from '../src/agent/pi/review';
import { grapheTools, readDiffTool, reviewerBriefs, runChecksTool } from '../src/agent/pi/tools';

// Every case in CH-08 makes a real project and runs git against a cold disk.
vi.setConfig({ testTimeout: 30_000 });

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((folder) => rm(folder, { recursive: true, force: true })));
});

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

/* ========================================================================== */
/* CH-05 running them                                                          */
/* ========================================================================== */

/** A check with just enough on it to be dispatched. */
function check(key: string): ProjectCheck {
  return { key, name: key, line: `Look at ${key}.` };
}

/** A promise somebody else settles, so a test can hold reviewers open and look
 *  at how many are in the air at once. */
function held(): { promise: Promise<string>; settle: (text: string) => void } {
  let settle: (text: string) => void = () => {};
  const promise = new Promise<string>((resolve) => {
    settle = resolve;
  });
  return { promise, settle };
}

describe('CH-05 the checks actually run', () => {
  /* The defect this whole thing exists for: the guidance said the change went
     to one reviewer per check, and nothing anywhere sent one. */
  it('puts a reviewer on every check the project wrote', async () => {
    const sent: string[] = [];
    const verdicts = await runEachCheck([check('a'), check('b'), check('c')], async (one) => {
      sent.push(one.key);
      return `P1 x.ts:1 — something in ${one.key} — it breaks — 80`;
    });
    expect(sent.sort()).toEqual(['a', 'b', 'c']);
    expect(verdicts.map((one) => one.check.key)).toEqual(['a', 'b', 'c']);
    expect(verdicts.every((one) => one.ok)).toBe(true);
  });

  /* Twenty check files must not be twenty processes on somebody's laptop at
     once. Every one of them still runs — what is capped is how many are in the
     air together. */
  it('never has more than the cap in the air, however many checks there are', async () => {
    const gates = new Map<string, ReturnType<typeof held>>();
    let going = 0;
    let most = 0;
    const checks = Array.from({ length: 20 }, (_, at) => check(`c${String(at)}`));

    const running = runEachCheck(
      checks,
      async (one) => {
        going += 1;
        most = Math.max(most, going);
        const gate = held();
        gates.set(one.key, gate);
        const said = await gate.promise;
        going -= 1;
        return said;
      },
      CHECKS_AT_A_TIME,
    );

    // Let every reviewer that can start, start; then release one at a time.
    for (let round = 0; round < checks.length; round += 1) {
      await new Promise((wake) => setImmediate(wake));
      const next = [...gates.entries()].find(([, gate]) => gate !== undefined);
      if (next === undefined) break;
      gates.delete(next[0]);
      next[1].settle('Nothing found.');
    }
    await new Promise((wake) => setImmediate(wake));
    for (const [key, gate] of gates) {
      gates.delete(key);
      gate.settle('Nothing found.');
    }

    const verdicts = await running;
    expect(verdicts).toHaveLength(20);
    expect(most).toBeLessThanOrEqual(CHECKS_AT_A_TIME);
    expect(most).toBe(CHECKS_AT_A_TIME);
  });

  it('takes its number of lanes from the one place the caps are worked out', () => {
    expect(CHECKS_AT_A_TIME).toBe(capsNow().checks);
  });

  it('lets one reviewer fall over without losing the answers of the others', async () => {
    const verdicts = await runEachCheck([check('a'), check('b'), check('c')], async (one) => {
      if (one.key === 'b') throw new Error('the helper stopped before it finished.');
      return 'Nothing found.';
    });
    expect(verdicts.map((one) => one.ok)).toEqual([true, false, true]);
    expect(verdicts[1]?.said).toContain('stopped before it finished');
  });

  /* The common case. Nobody has written a check, so nobody is sent anywhere and
     nothing is paid for. */
  it('sends nobody when a project has written nothing', async () => {
    let sent = 0;
    const verdicts = await runEachCheck([], async () => {
      sent += 1;
      return '';
    });
    expect(sent).toBe(0);
    expect(verdicts).toEqual([]);
  });
});

/* ========================================================================== */
/* CH-06 what comes back                                                       */
/* ========================================================================== */

describe('CH-06 the answers, gathered', () => {
  it('keeps every finding under the name of the check it came from', () => {
    const said = gatheredChecks([
      { check: { key: 'fit', name: 'Design fit', line: '' }, said: 'P1 a.tsx:3 — a raw hex', ok: true },
      { check: { key: 'tests', name: 'Tests', line: '' }, said: 'P2 b.ts:9 — not covered', ok: true },
    ]);
    expect(said.indexOf('Design fit')).toBeLessThan(said.indexOf('a.tsx:3'));
    expect(said.indexOf('a.tsx:3')).toBeLessThan(said.indexOf('Tests'));
    expect(said).toContain(CHECK_WORDS.name);
  });

  /* The dangerous one: a check that never ran, read as a check that passed. */
  it('says a check did not finish rather than letting it read as clear', () => {
    const said = gatheredChecks([
      { check: { key: 'fit', name: 'Design fit', line: '' }, said: 'the helper stopped.', ok: false },
    ]);
    expect(said).toContain(CHECK_WORDS.stalled('the helper stopped.'));
    expect(said).not.toContain(CHECK_WORDS.quiet);
  });

  it('says a reviewer found nothing rather than leaving a blank', () => {
    const said = gatheredChecks([
      { check: { key: 'fit', name: 'Design fit', line: '' }, said: '   ', ok: true },
    ]);
    expect(said).toContain(CHECK_WORDS.quiet);
  });
});

/* ========================================================================== */
/* CH-07 there is something to call                                            */
/* ========================================================================== */

describe('CH-07 the fan-out is reachable', () => {
  it('is a tool the agent actually holds when there is a project', () => {
    const named = grapheTools('', null, null, undefined, '/tmp/somewhere').map((tool) => tool.name);
    expect(named).toContain('run_checks');
  });

  it('is not there with no project to read checks out of', () => {
    expect(grapheTools('', null).map((tool) => tool.name)).not.toContain('run_checks');
  });

  it('tells the agent to run them, rather than describing a fan-out nothing does', () => {
    const guidance = (readDiffTool('/tmp/somewhere').promptGuidelines ?? []).join(' ');
    expect(guidance).toContain('run_checks');
  });
});

/* ========================================================================== */
/* CH-08 a real project, on a real disk                                        */
/* ========================================================================== */

/** A real folder, kept, with one unsaved change in it — so there is genuinely
 *  something for a review to be about. */
async function projectWithAChange(files: Record<string, string>): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'graphe-runchecks-')));
  scratch.push(root);
  const write = (path: string, text: string): void => {
    const full = join(root, path);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, text, 'utf8');
  };
  write('hero.css', '.hero { padding: 16px; }\n');
  for (const [path, text] of Object.entries(files)) write(path, text);

  const history = new ProjectHistory(root);
  await history.prepare();
  await history.snapshot('Where it started');
  write('hero.css', '.hero { padding: 24px; }\n');
  return root;
}

/** Whatever a tool said, as the text the model would read. */
async function ran(tool: ToolDefinition, params: Record<string, unknown>): Promise<string> {
  const answer = await (tool.execute as (
    id: string,
    input: unknown,
    signal?: AbortSignal,
    update?: unknown,
    rest?: unknown,
  ) => Promise<{ content: { type: string; text?: string }[] }>)('check-1', params, undefined, undefined, undefined);
  return answer.content.map((part) => part.text ?? '').join('\n');
}

describe('CH-08 a change, held up against what the project asked for', () => {
  /* The common case, and the one that must stay free: nobody has written a
     check, so no reviewer is sent, nothing is spent, and the words the agent
     reads are the words it always read. */
  it('sends nobody and says nothing extra when the project wrote none', async () => {
    const root = await projectWithAChange({});
    expect(await ran(runChecksTool(root, ''), { target: 'working' })).toContain(CHECK_WORDS.nothingWritten);
    expect(await ran(readDiffTool(root), { target: 'working' })).not.toContain(CHECK_WORDS.runThem);
  });

  it('points at running them once the project has written some', async () => {
    const root = await projectWithAChange({
      '.agents/checks/fit.md': '# Design fit\n\nEvery space comes from a token.',
    });
    const said = await ran(readDiffTool(root), { target: 'working' });
    expect(said).toContain(CHECK_WORDS.runThem);
    expect(said).toContain('Design fit');
  });

  /* The whole point of the job: one reviewer per check, dispatched by the app
     rather than hoped for from the model. Nothing is built next door under a
     test, so every reviewer comes back unable to start — which is exactly the
     evidence that one was sent for each check, and that a check which could not
     run is reported as unrun rather than clear. */
  it('sets one reviewer going for every check the project wrote', async () => {
    const root = await projectWithAChange({
      '.agents/checks/fit.md': '# Design fit\n\nEvery space comes from a token.',
      '.agents/checks/consumers.md': '# Consumers\n\nNothing that uses it breaks.',
    });
    const said = await ran(runChecksTool(root, ''), { target: 'working' });
    expect(said).toContain(CHECK_WORDS.gathered(2));
    expect(said).toContain('Design fit');
    expect(said).toContain('Consumers');
    expect(said).not.toContain(CHECK_WORDS.quiet);
    expect(said.match(/did not finish/g)).toHaveLength(2);
  });
});
