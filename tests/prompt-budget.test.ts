/** The budget is applied to the prompt, not merely measured.
 *
 * `withinBudget` and `PROMPT_BUDGET` were exported and nothing outside the
 * tests called them on the assembled system prompt, so a window big enough to
 * report was still a window nothing was held to.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROMPT_BUDGET, saysPromptSize, standingBlock, standingWords, withinBudget } from '../src/agent/pi/standing';

const adapter = readFileSync(
  fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
  'utf8',
);

/** The factory that appends the standing block, which is where the whole
 *  prompt is assembled and so the only place it can be held to anything. */
const factory = adapter.slice(
  adapter.indexOf("name: 'graphe-standing',"),
  adapter.indexOf('await loader.reload('),
);

describe('where it is applied', () => {
  it('holds everything else to what is left after our own block', () => {
    expect(factory).toContain('const room = PROMPT_BUDGET - (block?.length ?? 0);');
    expect(factory).toContain('withinBudget(was, room, standingWords.promptTrimmed)');
  });

  /* Our block is the thing holding the job together; cutting it to fit an
     add-on's five kilobytes is cutting the wrong half. */
  it('never cuts our own block to make room', () => {
    expect(factory).toContain('return { systemPrompt: `${before}\\n\\n${block}` };');
    expect(factory).not.toContain('withinBudget(block');
  });

  it('still says how heavy the prompt was, whether or not it was cut', () => {
    expect(factory).toContain("options.onEvent({ type: 'prompt-size', characters });");
  });

  it('says it out loud once a sitting rather than once a turn', () => {
    expect(factory).toContain("sayOnce('prompt-over-budget', saysPromptSize(");
    expect(factory).toContain('if (already.has(id)) return;');
  });
});

describe('what the trim does', () => {
  it('leaves a prompt inside the budget exactly as it was', () => {
    const small = 'x'.repeat(100);
    expect(withinBudget(small, PROMPT_BUDGET, standingWords.promptTrimmed)).toBe(small);
  });

  it('cuts an oversized one to the room left, with a pointer', () => {
    const cut = withinBudget('x'.repeat(PROMPT_BUDGET * 2), 1_000, standingWords.promptTrimmed);
    expect(cut.length).toBeLessThanOrEqual(1_000 + standingWords.promptTrimmed.length + 2);
    expect(cut).toContain(standingWords.promptTrimmed);
  });

  it('names the size the way the diagnostics already do', () => {
    expect(saysPromptSize(PROMPT_BUDGET + 5_000)).toContain('over budget');
  });

  it('leaves room for our block to still fit', () => {
    const ours = standingBlock({ list: null, goal: 'ship it', notes: [] }) ?? '';
    expect(ours.length).toBeLessThan(PROMPT_BUDGET);
  });
});
