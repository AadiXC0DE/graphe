import { describe, expect, it } from 'vitest';

import { selectCorrect, type CandidateSignals } from '../src/agent/pi/correctness';

function candidate(id: string, over: Partial<CandidateSignals> = {}): CandidateSignals {
  return {
    id,
    checks: [
      { check: { key: 'tests', name: 'tests', line: '' }, ok: true, said: 'All clear.' },
    ],
    lintErrors: 0,
    typeErrors: 0,
    diffLines: 20,
    ...over,
  };
}

describe('objective selection among N candidates', () => {
  it('lets completed checks outrank a smaller failing diff', () => {
    const selected = selectCorrect([
      candidate('correct', { diffLines: 100 }),
      candidate('small-but-red', {
        checks: [
          { check: { key: 'tests', name: 'tests', line: '' }, ok: true, said: 'One failure remains.' },
        ],
        diffLines: 1,
      }),
    ]);
    expect(selected.winner).toBe('correct');
  });

  it('uses complete lint/type evidence then smaller diff after checks', () => {
    expect(
      selectCorrect([
        candidate('complete', { lintErrors: 0, typeErrors: 0 }),
        candidate('lint-only', { lintErrors: 0, typeErrors: null }),
      ]).winner,
    ).toBe('complete');
    expect(
      selectCorrect([candidate('clean', { lintErrors: 0 }), candidate('lint-red', { lintErrors: 2 })]).winner,
    ).toBe('clean');
    expect(
      selectCorrect([candidate('small', { diffLines: 5 }), candidate('large', { diffLines: 50 })]).winner,
    ).toBe('small');
  });

  it('never treats unfinished or unknown evidence as passing', () => {
    expect(selectCorrect([candidate('unfinished', { ready: false })]).winner).toBeNull();
    expect(selectCorrect([{ id: 'unknown', checks: [] }]).winner).toBeNull();
    expect(
      selectCorrect([
        candidate('stalled', {
          checks: [{ check: { key: 'tests', name: 'tests', line: '' }, ok: false, said: 'timed out' }],
        }),
      ]).winner,
    ).toBeNull();
  });

  it('does not invent a winner on a complete tie', () => {
    const selected = selectCorrect([candidate('a'), candidate('b')]);
    expect(selected.winner).toBeNull();
    expect(selected.tie).toBe(true);
  });

  it('explains every ranking signal', () => {
    const selected = selectCorrect([candidate('one', { diffLines: 9 })]);
    expect(selected.ranking[0]?.reasons.join(' ')).toMatch(/checks passed/i);
    expect(selected.ranking[0]?.reasons.join(' ')).toMatch(/lint\/type/i);
    expect(selected.ranking[0]?.reasons.join(' ')).toMatch(/changed lines/i);
  });
});
