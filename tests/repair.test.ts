import { describe, expect, it } from 'vitest';

import {
  REPAIR_LIMITS,
  RepairCoordinator,
  repairIncidentKey,
  repairPrompt,
} from '../src/agent/pi/repair';

describe('bounded after-call repair', () => {
  it('normalizes the check and touched file into one incident', () => {
    expect(repairIncidentKey({ check: 'Tests.md', file: './SRC//a.test.ts' })).toBe(
      repairIncidentKey({ check: 'tests md', file: 'src/a.test.ts' }),
    );
  });

  it('allows exactly two attempts for one check and file, then stops', () => {
    const budget = new RepairCoordinator();
    const incident = { check: 'tests', file: 'src/a.ts' };
    expect(budget.try(incident)).toMatchObject({ allow: true, attempt: 1 });
    expect(budget.try(incident)).toMatchObject({ allow: true, attempt: 2 });
    expect(budget.try(incident)).toEqual({
      allow: false,
      key: 'tests:src/a.ts',
      reason: 'incident',
    });
  });

  it('keeps different files separate and applies the session backstop', () => {
    const budget = new RepairCoordinator();
    for (let turn = 0; turn < 3; turn += 1) {
      budget.beginTurn();
      expect(budget.try({ check: 'tests', file: `src/${String(turn)}a.ts` }).allow).toBe(true);
      expect(budget.try({ check: 'tests', file: `src/${String(turn)}b.ts` }).allow).toBe(true);
    }
    budget.beginTurn();
    expect(budget.try({ check: 'tests', file: 'src/last.ts' })).toMatchObject({
      allow: false,
      reason: 'session',
    });
    expect(REPAIR_LIMITS.perSession).toBe(6);
  });

  it('allows only two verification nudges in one model turn', () => {
    const budget = new RepairCoordinator();
    expect(budget.try({ check: 'a', file: 'a.ts' }).allow).toBe(true);
    expect(budget.try({ check: 'b', file: 'b.ts' }).allow).toBe(true);
    expect(budget.try({ check: 'c', file: 'c.ts' })).toMatchObject({ allow: false, reason: 'turn' });
    budget.beginTurn();
    expect(budget.try({ check: 'c', file: 'c.ts' }).allow).toBe(true);
  });

  it('gives the model the cap and the scoped file in plain words', () => {
    const said = repairPrompt('tests', './src/a.test.ts', 2);
    expect(said).toContain('2/2');
    expect(said).toContain('src/a.test.ts');
    expect(said).toMatch(/stop and say exactly what remains failing/i);
  });
});
