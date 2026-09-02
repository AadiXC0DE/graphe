/** What Graphe says on every model call, and what it cuts to make room.
 *
 * The checklist used to travel with the person's typed message, so a steer
 * carried it and a retry after a rate limit did not — exactly the turns where a
 * long job forgets it had a list. It is in the system prompt now, and the
 * prompt has a budget, because Pi's own text plus forty tools' guidelines plus
 * an add-on's five-kilobyte tool description plus `AGENTS.md` plus skills lands
 * in the same window as the work.
 */

import { describe, expect, it } from 'vitest';

import {
  AGENTS_BUDGET,
  EXTENSION_BUDGET,
  MOST_ROWS,
  PROMPT_BUDGET,
  SKILL_BUDGET,
  saysPromptSize,
  standingBlock,
  standingWords,
  withinBudget,
} from '../src/agent/pi/standing';
import { saysPromptWeight } from '../src/agent/pi/extension-probe';

const list = (done: number, total: number, rows = total) => ({
  markdown: Array.from(
    { length: Math.min(rows, MOST_ROWS) },
    (_, at) => `- ${at < done ? '[x]' : '[ ]'} ${String(at + 1)}. Step ${String(at + 1)}`,
  ).join('\n'),
  done,
  total,
  rows,
});

describe('the block itself', () => {
  it('carries the list, how far along it is, and the rules that hold', () => {
    const said = standingBlock({ list: list(3, 12), goal: null, notes: [] });
    expect(said).not.toBeNull();
    expect(said).toContain(standingWords.open);
    expect(said).toContain(standingWords.close);
    expect(said).toContain('3 of 12 settled');
    expect(said).toContain('- [x] 1. Step 1');
    for (const rule of standingWords.rules) expect(said).toContain(rule);
  });

  it('says a verdict is advice, because that is the sentence a long job needs', () => {
    const said = standingBlock({ list: list(1, 4), goal: null, notes: [] }) ?? '';
    expect(said).toMatch(/advice on the work/);
    expect(said).toMatch(/never permission/);
  });

  it('names the goal when there is one', () => {
    const said = standingBlock({ list: list(0, 3), goal: 'make the tests pass', notes: [] });
    expect(said).toContain('Working toward: make the tests pass');
  });

  /* A fence with nothing in it is prompt a model still has to read past. */
  it('is nothing at all when there is nothing standing', () => {
    expect(standingBlock({ list: null, goal: null, notes: [] })).toBeNull();
    expect(standingBlock({ list: null, goal: '   ', notes: [] })).toBeNull();
    expect(standingBlock({ list: list(0, 0, 0), goal: null, notes: [] })).toBeNull();
  });

  it('says how many more steps there are rather than quietly showing sixty', () => {
    const said = standingBlock({ list: list(0, 80, 80), goal: null, notes: [] }) ?? '';
    expect(said).toContain('and 20 more steps');
  });

  it('carries a bounded couple of notes, and none when there are none', () => {
    const withNotes = standingBlock({
      list: null,
      goal: null,
      notes: ['they prefer tabs', 'the staging database is read-only'],
    });
    expect(withNotes).toContain('they prefer tabs');
    expect(withNotes).toContain('read-only');
    expect(standingBlock({ list: null, goal: null, notes: ['   ', ''] })).toBeNull();
  });

  it('never lets the notes become the prompt', () => {
    const said =
      standingBlock({ list: null, goal: null, notes: [Array.from({ length: 40 }, () => 'a note about the project').join(' ')] }) ??
      '';
    expect(said.length).toBeLessThan(1200);
  });
});

describe('the budget', () => {
  const long = (n: number): string => 'x'.repeat(n);

  /* Held where each piece is read rather than after the prompt is assembled:
     what is cut has to be predictable, or a run behaves differently for a
     reason nobody can name. */
  it('leaves a piece already inside its cap alone', () => {
    const small = long(100);
    expect(withinBudget(small, AGENTS_BUDGET, standingWords.agentsTrimmed)).toBe(small);
  });

  it('holds AGENTS.md to its cap and leaves a pointer rather than a truncation', () => {
    const cut = withinBudget(long(32_000), AGENTS_BUDGET, standingWords.agentsTrimmed);
    expect(cut.length).toBeLessThanOrEqual(AGENTS_BUDGET + standingWords.agentsTrimmed.length + 2);
    expect(cut).toContain(standingWords.agentsTrimmed);
  });

  it('holds one skill to its cap', () => {
    const cut = withinBudget(long(50_000), SKILL_BUDGET, standingWords.skillTrimmed);
    expect(cut.length).toBeLessThanOrEqual(SKILL_BUDGET + standingWords.skillTrimmed.length + 2);
    expect(cut).toContain(standingWords.skillTrimmed);
  });

  it('cuts at the first paragraph where there is one inside the cap', () => {
    const cut = withinBudget(`first line\n\n${long(20_000)}`, AGENTS_BUDGET, standingWords.agentsTrimmed);
    expect(cut).toBe(`first line\n${standingWords.agentsTrimmed}`);
  });

  it('says what an add-on weighs only once it is worth saying', () => {
    expect(saysPromptWeight(EXTENSION_BUDGET)).toBeNull();
    expect(saysPromptWeight(6_400)).toBe('6.4k of every prompt');
  });
});

describe('what the chip says about it', () => {
  it('says the size in characters, because a token count right for one model is wrong for the next', () => {
    expect(saysPromptSize(48_000)).toBe('Prompt 48k');
    expect(saysPromptSize(1_250)).toBe('Prompt 1.3k');
  });

  it('says when it is over budget, which is the only time it matters', () => {
    expect(saysPromptSize(PROMPT_BUDGET + 1)).toContain('over budget');
    expect(saysPromptSize(PROMPT_BUDGET - 1)).not.toContain('over budget');
  });
});
