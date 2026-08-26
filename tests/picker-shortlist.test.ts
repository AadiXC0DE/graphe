/** The first screen shows the recent few, not everything remembered. */

import { describe, expect, it } from 'vitest';
import { MOST_SHOWN } from '../src/components/ProjectPicker';
import { MOST_REMEMBERED } from '../src/projects/recents';

describe('the recents list is a shortlist', () => {
  it('shows fewer than the store keeps, so it never needs a scrollbar', () => {
    expect(MOST_SHOWN).toBeLessThan(MOST_REMEMBERED);
    expect(MOST_SHOWN).toBeLessThanOrEqual(5);
  });

  it('renders the slice rather than every project', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const source = readFileSync(
      fileURLToPath(new URL('../src/components/ProjectPicker.tsx', import.meta.url)),
      'utf8',
    );
    expect(source).toContain('projects.slice(0, MOST_SHOWN)');
    expect(source).not.toContain('{projects.map(');
  });

  it('leaves no bounded scroll box behind on the list', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const css = readFileSync(
      fileURLToPath(new URL('../src/components/ProjectPicker.css', import.meta.url)),
      'utf8',
    );
    expect(css).not.toMatch(/overflow:\s*hidden auto/);
    expect(css).not.toMatch(/max-height:\s*min\(/);
  });
});
