/** The yes has to be recorded and dropped in the right places, or the Guard's
 *  new allowance is either never spent or never cleared. */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const adapter = readFileSync(
  fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
  'utf8',
);

describe('where the yes is written and where it is forgotten', () => {
  it('is not recorded from the house-rule question, which asks something else', () => {
    const first = adapter.indexOf('const decision = await confirmations.ask(call)');
    const second = adapter.lastIndexOf('const decision = await confirmations.ask(call)');
    expect(first).toBeLessThan(second);
    expect(adapter.slice(first, second)).not.toContain('facts.screenSaidYes = true');
  });

  it('is set only after the person actually said yes', () => {
    // The later of the two: the earlier one is a project's own house rule
    // asking at the top rung, which is a different question entirely.
    const at = adapter.lastIndexOf("const decision = await confirmations.ask(call)");
    expect(at).toBeGreaterThan(-1);
    const block = adapter.slice(at, at + 420);
    expect(block).toContain('if (asksAboutTheScreen(call)) facts.screenSaidYes = true;');
    // after the refusal branch, so a no never records a yes
    expect(block.indexOf("decision !== 'yes'")).toBeLessThan(
      block.indexOf('facts.screenSaidYes = true'),
    );
  });

  it('is dropped when a new request starts, not carried between them', () => {
    expect(adapter).toContain('if (activePrompts === 0) facts.screenSaidYes = false;');
  });

  it('is not cleared by a follow-up landing mid-run', () => {
    const at = adapter.indexOf('facts.screenSaidYes = false');
    const line = adapter.slice(adapter.lastIndexOf('\n', at) + 1, at + 60);
    expect(line).toContain('activePrompts === 0');
  });
});
