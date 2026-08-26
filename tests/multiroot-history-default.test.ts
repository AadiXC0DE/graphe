/** A folder holding several projects has no history of its own.
 *
 * Opening the full-screen history from the sidebar never named a project, so it
 * read the parent folder — which in a polyrepo is not a repository at all — and
 * drew an empty graph over three projects' worth of commits.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const view = readFileSync(
  fileURLToPath(new URL('../src/components/HistoryView.tsx', import.meta.url)),
  'utf8',
);

/** The same rule the panel already used, lifted out so it can be checked. */
function whose(
  inside: readonly { name: string }[],
  picked: string | null,
): string | null {
  if (inside.length === 0) return null;
  return inside.find((one) => one.name === picked)?.name ?? inside[0]?.name ?? null;
}

describe('the full-screen history in a folder of several projects', () => {
  const three = [{ name: 'Charge-App-Prototype' }, { name: 'Charge-App-RN' }, { name: 'Charge-App-SOT' }];

  it('falls to the first project rather than the parent, which has no history', () => {
    expect(whose(three, null)).toBe('Charge-App-Prototype');
  });

  it('keeps whichever project was chosen', () => {
    expect(whose(three, 'Charge-App-RN')).toBe('Charge-App-RN');
  });

  it('falls back to the first when the chosen one is gone', () => {
    expect(whose(three, 'deleted-one')).toBe('Charge-App-Prototype');
  });

  it('still means the folder itself when the folder is one project', () => {
    expect(whose([], null)).toBeNull();
  });

  it('is the value the sheet is actually given, not the raw pick', () => {
    expect(app).toContain('const historyRepo =');
    expect(app).toMatch(/versions=\{historyRepo === null \? desk\.versions/);
    expect(app).not.toMatch(/versions=\{graphRepo === null \? desk\.versions/);
  });

  it('lets somebody switch project from inside the sheet', () => {
    expect(view).toContain('onRepo');
    expect(app).toMatch(/repo=\{historyRepo\}/);
  });
});

describe('the reviews screen in a folder of several projects', () => {
  const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
  const reviews = readFileSync(
    fileURLToPath(new URL('../src/components/ReviewsView.tsx', import.meta.url)),
    'utf8',
  );

  it('reads the project the window named, not the folder holding it', () => {
    expect(main).toContain('readRepo({ path: folderFor(open, where) })');
    expect(main).not.toContain('return done(await readRepo(open));');
  });

  it('posts a comment against that same project', () => {
    const at = main.indexOf('CHANNEL.repoComment');
    const block = main.slice(at, at + 900);
    expect(block).toContain('folderFor(open, whereIn(args))');
    expect(block).not.toContain('githubRepo(open.path)');
  });

  it('lets somebody switch project from the sheet', () => {
    expect(reviews).toContain('onWhich');
    expect(app).toContain('onWhich={(name) => {');
  });

  it('asks the shell for that project rather than the parent', () => {
    expect(app).toMatch(/\.\.\.\(named === null \? \{\} : \{ repo: named \}\)/);
  });
});
