/** A goal is one conversation's, and the two halves have to agree which one.
 *
 * The window saved and loaded it with no address; the authority read it with
 * one. Both worked, both were tested, and they were never the same file, so
 * Goal Mode ran one round and rested. These are the joins.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { GoalFile } from '../src/projects/goals';
import { createGoal, goalStorageKey } from '../src/work/goal';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const chip = readFileSync(
  fileURLToPath(new URL('../src/hooks/useGoalChip.ts', import.meta.url)),
  'utf8',
);

/** The block a named handler is, so a claim is about that handler and not about
 *  the file having the words somewhere. */
function handler(channel: string): string {
  const at = main.indexOf(`handle<`);
  const start = main.indexOf(`CHANNEL.${channel},`, at);
  expect(start).toBeGreaterThan(-1);
  return main.slice(start, main.indexOf('\n  });', start));
}

describe('the goal file is addressed by conversation', () => {
  let base = '';

  beforeEach(async () => {
    base = await mkdtemp(join(tmpdir(), 'graphe-goal-'));
  });

  afterEach(async () => {
    await rm(base, { recursive: true, force: true });
  });

  it('gives two conversations in one project two files', () => {
    const one = GoalFile.pathFor('/work/site', base, '/sessions/a.jsonl');
    const other = GoalFile.pathFor('/work/site', base, '/sessions/b.jsonl');
    expect(one).not.toBe(other);
  });

  it('reads back what was written at the same address, and nothing at another', async () => {
    const goal = createGoal('ship the release', 'doing');
    await GoalFile.write('/work/site', base, goal, '/sessions/a.jsonl');
    expect(await GoalFile.read('/work/site', base, '/sessions/a.jsonl')).toMatchObject({
      objective: 'ship the release',
    });
    expect(await GoalFile.read('/work/site', base, '/sessions/b.jsonl')).toBeNull();
  });

  it('clears one conversation without clearing the other', async () => {
    await GoalFile.write('/work/site', base, createGoal('one', 'doing'), '/a');
    await GoalFile.write('/work/site', base, createGoal('other', 'doing'), '/b');
    await GoalFile.clear('/work/site', base, '/a');
    expect(await GoalFile.read('/work/site', base, '/a')).toBeNull();
    expect(await GoalFile.read('/work/site', base, '/b')).toMatchObject({ objective: 'other' });
  });
});

describe('the shell reads and writes the goal at the conversation it was asked about', () => {
  it('loads at the address, and refuses when there is no conversation', () => {
    const block = handler('goalLoad');
    expect(block).toContain('const address = listAddress(open, where)');
    expect(block).toContain('GoalFile.read(open.path, userData, address)');
  });

  it('moves a goal written before goals were per conversation, once', () => {
    const block = handler('goalLoad');
    expect(block).toContain('const older = await GoalFile.read(open.path, userData);');
    expect(block).toContain('await GoalFile.write(open.path, userData, older, address);');
    expect(block).toContain('await GoalFile.clear(open.path, userData);');
  });

  it('saves at the address rather than at the project', () => {
    const block = handler('goalSave');
    expect(block).toContain('const address = listAddress(open, where)');
    expect(block).toContain("GoalFile.write(open.path, app.getPath('userData'), goal, address)");
  });

  it('clears at the address rather than at the project', () => {
    const block = handler('goalClear');
    expect(block).toContain('const address = listAddress(open, where)');
    expect(block).toContain("GoalFile.clear(open.path, app.getPath('userData'), address)");
  });

  it('reads the same file the authority reads', () => {
    // The owner's `goal` hook, which is the half that was never reached.
    expect(main).toContain("GoalFile.read(project, app.getPath('userData'), address)");
  });
});

describe('the window names the conversation on every goal call', () => {
  it('loads, saves and clears with one', () => {
    expect(chip).toContain('bridge.goalLoad({ project, conversation })');
    expect(chip).toContain('bridge.goalSave(next, { project: forProject, conversation })');
    expect(chip).toContain('bridge.goalClear({ project: forProject, conversation })');
  });

  it('takes the address off the desk the goal is for, not off whichever is in front', () => {
    expect(chip).toContain(
      "desksNow.current.byPath[forProject]?.address ?? undefined",
    );
  });

  it('re-reads when the conversation in front changes', () => {
    expect(chip).toContain('}, [project, address, addressIn, desksNow, setPlans]);');
  });
});

describe('the fallback store is addressed the same way', () => {
  it('keys by conversation where there is one', () => {
    expect(goalStorageKey('/work/site')).not.toBe(goalStorageKey('/work/site', '/a'));
    expect(goalStorageKey('/work/site', '/a')).not.toBe(goalStorageKey('/work/site', '/b'));
  });

  it('leaves a project with no conversation on the key it always had', () => {
    expect(goalStorageKey('/work/site')).toBe('graphe:goal:/work/site');
  });
});

describe('a round toward the goal is counted where it is sent', () => {
  it('is not counted on a settle that sent nothing', () => {
    const at = main.indexOf('  goal: async (project, address) => {');
    const block = main.slice(at, main.indexOf('\n});', at));
    // Met is a change worth writing; not met is the same goal it was.
    expect(block).toContain("status: 'done'");
    expect(block).not.toContain('iterations');
  });

  it('is counted on the send, and only for a goal round', () => {
    expect(main).toContain("if (why === 'goal') void countGoalRound(project, address);");
    expect(main).toContain('async function countGoalRound(');
  });
});
