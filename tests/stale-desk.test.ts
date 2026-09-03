/** The bug that made a control look like it had never been built.
 *
 * Which folder is in front lives in `desks`, held in state, and is read as
 * `openProject`. A `useCallback` that reads it but does not list it closes over
 * the value from the render that made it — and the first of those renders
 * happens before any folder is open, so the value is null forever. Every such
 * callback returns early, silently, for the life of the window.
 *
 * That is what happened to moving between lines of work: the name was clickable
 * and clicking it did nothing, with no error and nothing in the log. It is
 * invisible to types, to the tests, and to a reviewer reading the body of the
 * function, because the body is correct. Only the dependency list is wrong.
 *
 * So it is checked here mechanically, on the source, the way the language sweep
 * is. `react-hooks/exhaustive-deps` reports this class as a warning among
 * thirty-odd others of a shape that is fine; it was ignored for that reason.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const SOURCE = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

/** Every `useCallback`/`useEffect`/`useMemo` call, as its own text. */
function hooksIn(source: string): { line: number; body: string }[] {
  const found: { line: number; body: string }[] = [];
  const opener = /use(?:Callback|Effect|Memo)\(/g;
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    let depth = 0;
    let at = match.index + match[0].length - 1;
    for (; at < source.length; at += 1) {
      if (source[at] === '(') depth += 1;
      else if (source[at] === ')') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push({
      line: source.slice(0, match.index).split('\n').length,
      body: source.slice(match.index, at + 1),
    });
  }
  return found;
}

/** The dependency list is whatever follows the last closing brace of the body. */
function depsOf(body: string): string {
  const shut = body.lastIndexOf('}');
  return shut < 0 ? body : body.slice(shut);
}

describe('reading which folder is in front', () => {
  it('finds the hooks at all, so a silent pass means something', () => {
    const hooks = hooksIn(SOURCE);
    expect(hooks.length).toBeGreaterThan(40);
    expect(hooks.some((one) => one.body.includes('openProject'))).toBe(true);
  });

  it('never reads it without listing it', () => {
    const guilty = hooksIn(SOURCE)
      .filter((one) => one.body.includes('openProject'))
      .filter((one) => !depsOf(one.body).includes('openProject'))
      .map((one) => `src/App.tsx:${String(one.line)}`);

    expect(guilty, `these close over the folder from first render: ${guilty.join(', ')}`).toEqual(
      [],
    );
  });
});
