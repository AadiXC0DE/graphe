/** The command is shown beside the description, never inside it.
 *
 * The fallback used to read "/tidy — a way of working…" and the list stripped
 * that prefix back off by matching the exact separator, so changing the
 * separator in one file put the prefix on screen from the other.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (rel: string): string =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('a workflow with no description of its own', () => {
  it('does not put the command inside the sentence', () => {
    const source = read('../src/work/workflows.ts');
    expect(source).toContain("seen.description ?? 'A way of working this project added.'");
    expect(source).not.toMatch(/description: seen\.description \?\? `\$\{command\}/);
  });

  it('is shown as written, with nothing stripped off the front', () => {
    const composer = read('../src/components/Composer.tsx');
    expect(composer).toContain('<small>{one.description}</small>');
    expect(composer).not.toContain('one.description.replace');
  });
});
