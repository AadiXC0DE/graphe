/** The reader the agent gets for a project's own values.
 *
 * What matters here is that the list is the same list the band draws, that it
 * says where each value is written so the model can open the sheet instead of
 * guessing, and that a project with no design system answers with a sentence
 * rather than an empty page. Everything runs against a real folder, because the
 * thing being read is a real stylesheet off a disk.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import { describeCall } from '../src/lib/describe';
import { evaluate } from '../src/agent/guard/policy';
import { readOnlyTools } from '../src/agent/plan';
import { grapheTools, readTokensTool, saysTokens, TOKEN_WORDS } from '../src/agent/pi/tools';

const ROOT = '/tmp/agent';

let dir: string;

function write(relative: string, content: string): void {
  const full = join(dir, relative);
  mkdirSync(join(full, '..'), { recursive: true });
  writeFileSync(full, content);
}

async function run(tool: ToolDefinition): Promise<string> {
  const result = await tool.execute('call-1', {} as never, undefined, undefined, undefined as never);
  return result.content.find((entry) => entry.type === 'text')?.text ?? '';
}

const reader = (): ToolDefinition => readTokensTool(dir);

const SHEET = `:root {
  --accent: #b8492c;
  --space-4: 16px;
  --radius-md: 10px;
  --text-base: 0.9375rem;
}

.card {
  color: var(--accent);
  padding: var(--space-4) var(--space-4);
}
`;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graphe-tokens-'));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/* ========================================================================== */
/* What the model is handed                                                    */
/* ========================================================================== */

describe('the tool in the toolbox', () => {
  it('is on the list in every project, whether or not anything else is', () => {
    for (const names of [
      grapheTools(ROOT).map((one) => one.name),
      grapheTools(ROOT, 'a-figma-token').map((one) => one.name),
      grapheTools(ROOT, null, null, undefined, '/work/site').map((one) => one.name),
    ]) {
      expect(names).toContain('read_tokens');
    }
  });

  /* Registered always, and read-only in every place that cares: the Guard, the
     planning pass, and the helper brief. */
  it('is read by the Guard rather than questioned', () => {
    const verdict = evaluate({ id: 'x', name: 'read_tokens', input: {} }, { projectRoot: ROOT });
    expect(verdict.kind).toBe('allow');
    expect(readOnlyTools(['read_tokens', 'bash'])).toEqual(['read_tokens']);
  });

  it('has words of its own for the feed', () => {
    expect(describeCall({ id: 'x', name: 'read_tokens', input: {} }).label).not.toBe(
      'Working on your project',
    );
  });

  it('runs beside other reads, since it holds nothing up', () => {
    expect(reader().executionMode).toBe('parallel');
  });
});

/* ========================================================================== */
/* Reading a project                                                           */
/* ========================================================================== */

describe('reading a project with a design system', () => {
  it('groups the values the way the band does, and says what each is', async () => {
    write('src/styles/tokens.css', SHEET);
    const said = await run(reader());

    expect(said).toContain('Colour:');
    expect(said).toContain('Spacing:');
    expect(said).toContain('Corners:');
    expect(said).toContain('Type:');
    expect(said).toContain('--accent: #b8492c');
    expect(said).toContain('--space-4: 16px');
  });

  it('says where each value is written, so the sheet can be opened', async () => {
    write('src/styles/tokens.css', SHEET);
    const said = await run(reader());
    expect(said).toMatch(/--accent: #b8492c \(used once, src\/styles\/tokens\.css:\d+\)/);
  });

  it('says which values nothing has reached for yet', async () => {
    write('src/styles/tokens.css', SHEET);
    const said = await run(reader());
    expect(said).toContain('--radius-md: 10px (used nowhere');
    expect(said).toContain('--space-4: 16px (used 2 times');
  });

  it('reads a Tailwind theme block as well as a :root one', async () => {
    write('src/app/globals.css', '@theme {\n  --color-ink: #111111;\n}\n');
    const said = await run(reader());
    expect(said).toContain('Colour:');
    expect(said).toContain('--color-ink: #111111');
  });

  it('says how wide the reading was, so a missing value is not a mystery', async () => {
    write('src/styles/tokens.css', SHEET);
    write('src/styles/extra.css', ':root { --note: 1px; }\n');
    expect(await run(reader())).toContain(`read from 2 stylesheets`);
  });

  it('keeps a long value short enough to read in a line', async () => {
    write(
      'src/styles/tokens.css',
      `:root {
  --font-ui: ${'ui-sans-serif, '.repeat(12)}sans-serif;
}
`,
    );
    const said = await run(reader());
    for (const line of said.split('\n')) expect(line.length).toBeLessThan(200);
    expect(said).toContain('…');
  });
});

describe('reading a project with none', () => {
  it('says so in words rather than answering with nothing at all', async () => {
    const said = await run(reader());
    expect(said).toBe(TOKEN_WORDS.nothing);
  });

  it('says the same when the stylesheets declare nothing on a root', async () => {
    write('src/styles/tokens.css', '.card { --local: 3px; }\n');
    expect(await run(reader())).toBe(TOKEN_WORDS.nothing);
  });

  it('has an answer for a reading that came back empty, said once', () => {
    expect(saysTokens(null)).toBe(TOKEN_WORDS.nothing);
  });
});
