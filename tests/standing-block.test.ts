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
  trimToBudget,
  type Piece,
} from '../src/agent/pi/standing';

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

  function pieces(): Piece[] {
    return [
      { kind: 'pi', from: 'pi', text: long(10_000) },
      { kind: 'extension', from: 'an add-on', text: `${long(6_000)}\n\nand more` },
      { kind: 'skill', from: 'a skill', text: long(50_000) },
      { kind: 'agents', from: 'AGENTS.md', text: long(32_000) },
      { kind: 'graphe', from: 'graphe', text: long(2_000) },
    ];
  }

  it('leaves a prompt already inside the budget alone', () => {
    const small: Piece[] = [{ kind: 'pi', from: 'pi', text: long(100) }];
    const trimmed = trimToBudget(small);
    expect(trimmed.pieces).toEqual(small);
    expect(trimmed.cut).toEqual([]);
    expect(trimmed.now).toBe(trimmed.was);
  });

  /* Fixed rather than "cut the biggest": what is cut has to be predictable, or
     a run behaves differently for a reason nobody can name. */
  it('cuts add-on text first, then skills, then AGENTS.md', () => {
    const trimmed = trimToBudget(pieces());
    expect(trimmed.cut.map((one) => one.from)).toEqual(['an add-on', 'a skill', 'AGENTS.md']);
  });

  it('never cuts Graphe’s own block, because it is what holds the job together', () => {
    const trimmed = trimToBudget(pieces());
    const ours = trimmed.pieces.find((one) => one.kind === 'graphe');
    expect(ours?.text).toHaveLength(2_000);
    expect(trimmed.cut.some((one) => one.from === 'graphe')).toBe(false);
  });

  it('never cuts Pi’s own text either — that is not ours to trim', () => {
    const trimmed = trimToBudget(pieces());
    expect(trimmed.pieces.find((one) => one.kind === 'pi')?.text).toHaveLength(10_000);
  });

  it('holds each kind to its own budget and says so where it cut', () => {
    const trimmed = trimToBudget(pieces());
    const of = (kind: Piece['kind']): number =>
      trimmed.pieces.find((one) => one.kind === kind)?.text.length ?? 0;
    expect(of('extension')).toBeLessThanOrEqual(EXTENSION_BUDGET + standingWords.extensionTrimmed.length + 2);
    expect(of('skill')).toBeLessThanOrEqual(SKILL_BUDGET + standingWords.skillTrimmed.length + 2);
    expect(of('agents')).toBeLessThanOrEqual(AGENTS_BUDGET + standingWords.agentsTrimmed.length + 2);
    expect(trimmed.now).toBeLessThan(trimmed.was);
  });

  it('leaves a pointer rather than a truncation nobody can act on', () => {
    const trimmed = trimToBudget(pieces());
    expect(trimmed.pieces.find((one) => one.kind === 'agents')?.text).toContain(
      standingWords.agentsTrimmed,
    );
  });

  it('reports how much each cut saved', () => {
    const trimmed = trimToBudget(pieces());
    for (const one of trimmed.cut) expect(one.saved).toBeGreaterThan(0);
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
