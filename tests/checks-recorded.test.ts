/** The project's checks, actually reaching the project's rules.
 *
 * Two halves were built and never joined. A rule may say `"needs": "tests"`,
 * and it reads the answer out of `World`; the checks runner dispatches a
 * reviewer per check and hands back what each one found. Nothing carried the
 * second into the first, so every `needs` rule held forever — correct by
 * design, useless in practice, and indistinguishable from a feature that was
 * never wired at all.
 *
 * The failure that matters here is the opposite one, and it is why the reading
 * is deliberately mean. A check recorded as failing only holds work up, and
 * somebody can look and see why. A check recorded as passing *unblocks* work
 * against a standard nobody met, which is the whole reason the standard was
 * written down. So a reviewer that never answered, a reviewer that hedged, and
 * a reviewer that wrote an essay all count as not passing.
 */

import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { checkPassed, whatWasChecked, type CheckVerdict, type ProjectCheck } from '../src/agent/pi/checks';
import { checksDesk, createGuardInterceptor } from '../src/agent/pi/adapter';
import { RULE_WORDS, readRules, type Rules } from '../src/agent/hooks';
import { grapheTools, runChecksTool } from '../src/agent/pi/tools';
import { ProjectHistory } from '../src/history/repo';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { ToolCall } from '../src/agent/types';

// The last group makes a real project and runs git against a cold disk.
vi.setConfig({ testTimeout: 30_000 });

const scratch: string[] = [];
afterAll(async () => {
  await Promise.all(scratch.map((folder) => rm(folder, { recursive: true, force: true })));
});

function check(key: string, name = key): ProjectCheck {
  return { key, name, line: 'Whatever this project asked for.' };
}

/** One reviewer's answer, in the shape the runner hands back. */
function answered(key: string, said: string, ok = true): CheckVerdict {
  return { check: check(key), said, ok };
}

/* ========================================================================== */
/* Reading what a reviewer said                                                */
/* ========================================================================== */

describe('what counts as a check passing', () => {
  /* The case CHECK_WORDS.stalled exists for. A reviewer that fell over has
     checked nothing, and "nothing was checked" must never unblock anything. */
  it('never counts a reviewer that did not answer', () => {
    expect(checkPassed(answered('tests', 'the reviewer stopped.', false))).toBe(false);
    expect(checkPassed(answered('tests', '', false))).toBe(false);
  });

  it('says out loud that a reviewer that fell over did not finish', () => {
    const world = whatWasChecked([answered('tests', 'no model available', false)]);
    expect(world['tests']?.passing).toBe(false);
    expect(world['tests']?.said).toMatch(/did not finish/);
  });

  /* A reviewer that ran to the end with nothing to say is a result, not a gap —
     the same reading `gatheredChecks` already gives an empty answer. */
  it('counts a reviewer that finished with nothing to say', () => {
    expect(checkPassed(answered('tests', ''))).toBe(true);
    expect(checkPassed(answered('tests', '   \n  '))).toBe(true);
  });

  it('counts a plain all-clear', () => {
    expect(checkPassed(answered('tests', 'No issues found.'))).toBe(true);
    expect(checkPassed(answered('tests', 'Nothing found.'))).toBe(true);
    expect(checkPassed(answered('tests', 'Looks good — every space comes from a token.'))).toBe(true);
    expect(checkPassed(answered('tests', 'This check passes.'))).toBe(true);
  });

  it('does not count findings, however politely they are put', () => {
    expect(checkPassed(answered('fit', 'hero.css:12 uses a raw 16px instead of a token.'))).toBe(false);
    expect(checkPassed(answered('fit', 'The padding should come from a token.'))).toBe(false);
    expect(checkPassed(answered('fit', 'Two consumers of this component break.'))).toBe(false);
  });

  /* The one that would have got through a naive "does it say no issues" read,
     and the one a reviewer writes most often. */
  it('does not count an all-clear with a hedge behind it', () => {
    expect(
      checkPassed(answered('fit', 'No blocking issues, but the naming in hero.css is inconsistent.')),
    ).toBe(false);
    expect(
      checkPassed(answered('fit', 'Looks good, though I could not read the tokens file.')),
    ).toBe(false);
    expect(checkPassed(answered('fit', 'No issues with the colours. The spacing is wrong.'))).toBe(false);
  });

  /* A reviewer with nothing to report says so in a line. Anything with a body
     of prose behind it is treated as having found something. */
  it('does not count an essay that happens to contain a clear sentence', () => {
    const essay = `No issues found. ${'The change is a straightforward one. '.repeat(20)}`;
    expect(essay.length).toBeGreaterThan(400);
    expect(checkPassed(answered('fit', essay))).toBe(false);
  });
});

describe('the names an answer is filed under', () => {
  /* A rule is written by one person on one day and a check file by another on
     another. Which of the two names they had in mind is not knowable. */
  it('files an answer under the file’s name and the person’s name alike', () => {
    const world = whatWasChecked([
      { check: { key: 'unit-tests', name: 'Unit Tests', line: '' }, said: 'No issues found.', ok: true },
    ]);
    expect(world['unit-tests']?.passing).toBe(true);
    expect(world['Unit Tests']?.passing).toBe(true);
  });

  /* Two checks can want the same name. The name must not quietly come to mean
     whichever of the two was easier to satisfy. */
  it('gives a name two checks want to the one that did not pass', () => {
    const world = whatWasChecked([
      { check: { key: 'tests', name: 'Tests', line: '' }, said: 'Nothing found.', ok: true },
      { check: { key: 'other', name: 'tests', line: '' }, said: 'Two of them fail.', ok: true },
    ]);
    expect(world['tests']?.passing).toBe(false);
  });
});

/* ========================================================================== */
/* The desk the answers are kept on                                            */
/* ========================================================================== */

describe('keeping an answer only while it is still true', () => {
  it('starts out knowing nothing', () => {
    expect(checksDesk().world().checks ?? {}).toEqual({});
  });

  it('keeps what the reviewers came back with', () => {
    const desk = checksDesk();
    desk.noting()([answered('tests', 'No issues found.')]);
    expect(desk.world().checks?.['tests']?.passing).toBe(true);
  });

  /* The narrow case `forgetChecks` alone cannot cover: reviewers take minutes,
     and a change landing while they read makes every answer they are about to
     give a description of a project that no longer exists. */
  it('drops an answer about files that moved while the reviewers were reading', () => {
    const desk = checksDesk();
    const keep = desk.noting();
    desk.forget();
    keep([answered('tests', 'No issues found.')]);
    expect(desk.world().checks?.['tests']).toBeUndefined();
  });

  it('forgets everything once the files have moved', () => {
    const desk = checksDesk();
    desk.noting()([answered('tests', 'No issues found.')]);
    desk.forget();
    expect(desk.world().checks ?? {}).toEqual({});
  });
});

/* ========================================================================== */
/* The join: an answer reaching a rule, at the moment a call is judged          */
/* ========================================================================== */

const ROOT = '/Users/mira/Projects/portfolio';

/** A rule of the shape the whole `needs` vocabulary exists for. */
const HOUSE: Rules = readRules(
  JSON.stringify({
    rules: [
      {
        name: 'Nothing is written while the tests are red',
        when: 'before',
        it: 'changes files',
        needs: 'tests',
        then: 'refuse',
        because: 'A red run is not finished work.',
      },
    ],
  }),
);

function interceptor(rules: Rules, world: () => { checks?: Record<string, { passing: boolean; said?: string }> }) {
  return createGuardInterceptor({
    facts: { projectRoot: ROOT } as GuardFacts,
    relay: {
      started: () => undefined,
      blocked: () => undefined,
      asking: () => undefined,
      finished: () => undefined,
    } as never,
    confirmations: { ask: () => Promise.resolve('yes') } as never,
    rules: () => rules,
    world,
  });
}

const writing: ToolCall = {
  id: 'call-1',
  name: 'write',
  input: { path: `${ROOT}/src/hero.css`, content: '.hero {}' },
};

describe('a check answering, and a rule reading it', () => {
  it('holds the call while nobody has run the check', async () => {
    const desk = checksDesk();
    const said = await interceptor(HOUSE, desk.world)(writing);
    expect(said?.block).toBe(true);
    expect(said?.reason).toContain(RULE_WORDS.notCheckedYet('tests'));
  });

  /* The whole job in one case: the same call, the same rule, the same guard —
     the only thing that changed is that a reviewer answered. */
  it('lets the call through once the check has come back clear', async () => {
    const desk = checksDesk();
    const held = await interceptor(HOUSE, desk.world)(writing);
    expect(held?.block).toBe(true);

    desk.noting()([answered('tests', 'No issues found.')]);

    expect(await interceptor(HOUSE, desk.world)(writing)).toBeUndefined();
  });

  /* And back again, with no reviewer involved: the answer stops describing the
     project the moment the project changes under it. */
  it('holds it again once a file has moved since', async () => {
    const desk = checksDesk();
    desk.noting()([answered('tests', 'No issues found.')]);
    desk.forget();
    expect((await interceptor(HOUSE, desk.world)(writing))?.block).toBe(true);
  });

  it('says which of the two it is when the check ran and did not pass', async () => {
    const desk = checksDesk();
    desk.noting()([answered('tests', 'Two of them fail in hero.test.ts.')]);
    const said = await interceptor(HOUSE, desk.world)(writing);
    expect(said?.block).toBe(true);
    expect(said?.reason).toContain(RULE_WORDS.notPassing('tests'));
    expect(said?.reason).not.toContain('I do not know yet');
  });

  /* A rule and a check file are written by different hands. "tests" has to find
     a check filed as `unit-tests.md` under the heading "Unit Tests". */
  it('finds the check however the rule spelt its name', async () => {
    const rules = readRules(
      JSON.stringify({
        rules: [
          {
            name: 'Nothing is written while the tests are red',
            when: 'before',
            it: 'changes files',
            needs: 'unit tests',
            then: 'refuse',
            because: 'A red run is not finished work.',
          },
        ],
      }),
    );
    const desk = checksDesk();
    desk.noting()([
      { check: { key: 'unit-tests', name: 'Unit Tests', line: '' }, said: 'No issues found.', ok: true },
    ]);
    expect(await interceptor(rules, desk.world)(writing)).toBeUndefined();
  });

  /* And is not so forgiving that it answers the wrong question. */
  it('does not let one check stand in for another', async () => {
    const desk = checksDesk();
    desk.noting()([answered('typecheck', 'No issues found.')]);
    expect((await interceptor(HOUSE, desk.world)(writing))?.block).toBe(true);
  });
});

/* ========================================================================== */
/* The hop the pure pieces cannot prove: the tool telling the desk              */
/* ========================================================================== */

async function projectWithAChange(files: Record<string, string>): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'graphe-recorded-'));
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

describe('run_checks handing its answers on', () => {
  /* Nothing is built next door under a test, so every reviewer comes back
     unable to start. That is the evidence: the desk hears about the checks at
     all, and hears about them as unrun rather than as clear. */
  it('tells the desk what every reviewer came back with', async () => {
    const root = await projectWithAChange({
      '.agents/checks/fit.md': '# Design fit\n\nEvery space comes from a token.',
      '.agents/checks/consumers.md': '# Consumers\n\nNothing that uses it breaks.',
    });
    const desk = checksDesk();
    await ran(runChecksTool(root, '', null, undefined, desk.noting), { target: 'working' });

    const checks = desk.world().checks ?? {};
    expect(Object.keys(checks)).toContain('fit');
    expect(Object.keys(checks)).toContain('Design fit');
    expect(checks['fit']?.passing).toBe(false);
    expect(checks['consumers']?.passing).toBe(false);
  });

  /* The tool is not built by hand anywhere but here — the session builds it
     through grapheTools, so that is the call that has to carry the desk. */
  it('carries the desk through the set of tools the session is given', async () => {
    const root = await projectWithAChange({
      '.agents/checks/fit.md': '# Design fit\n\nEvery space comes from a token.',
    });
    const desk = checksDesk();
    const tool = grapheTools('', null, null, undefined, root, undefined, desk.noting).find(
      (one) => one.name === 'run_checks',
    );
    expect(tool).toBeDefined();
    await ran(tool as ToolDefinition, { target: 'working' });
    expect(desk.world().checks?.['fit']).toBeDefined();
  });

  /* A project that wrote none sends nobody, so there is nothing to record and
     nothing that could be mistaken for a check having passed. */
  it('records nothing when the project has written no checks', async () => {
    const root = await projectWithAChange({});
    const desk = checksDesk();
    await ran(runChecksTool(root, '', null, undefined, desk.noting), { target: 'working' });
    expect(desk.world().checks ?? {}).toEqual({});
  });
});

/* ========================================================================== */
/* The one hop nothing can be rendered for: the session's own wiring           */
/* ========================================================================== */

/** `createSession` needs Pi, a model and a credential file, so it cannot be run
 *  here. What it must do is hand the *same* desk to both ends — the rules read
 *  one side of it and run_checks writes the other — and two desks, or one desk
 *  and a fresh `{}`, would pass every test above while joining nothing. */
describe('the session wiring the two ends to one desk', () => {
  const SOURCE = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');

  it('makes exactly one desk for a sitting', () => {
    expect(SOURCE.match(/=\s*checksDesk\(\)/g)).toHaveLength(1);
  });

  it('gives the rules that desk to read', () => {
    expect(SOURCE).toContain('world: desk.world');
  });

  it('gives the checks that same desk to write to', () => {
    expect(SOURCE).toMatch(/grapheTools\([^)]*desk\.noting/s);
  });

  it('empties it whenever a call is about to change the files', () => {
    // The same moment now also closes the asking, so the two live together in
    // one guard rather than on one line.
    expect(SOURCE).toMatch(/if \(!changesAnything\(call, facts\)\) return;\s*desk\.forget\(\)/);
  });
});
