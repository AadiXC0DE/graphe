/** The window went black for a frame the first time any view opened.
 *
 * Twenty views are `lazy`, and the only Suspense boundaries were the two around
 * the whole conversation with `fallback={null}`. Pressing Design suspended that
 * root boundary, React unmounted the entire tree, and the body background was
 * all that painted until the chunk landed.
 *
 * Three things keep it away, and all three are invisible to types and to a
 * reviewer reading one hunk: the press happens in a transition, so what is on
 * screen stays there; each view has a boundary of its own, so a slow chunk never
 * reaches the root again; and the chunks are fetched at idle, so the press
 * usually finds them already there. Checked on the source, the way the stale
 * dependency sweep is.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const sheet = readFileSync(
  fileURLToPath(new URL('../src/components/Sheet.css', import.meta.url)),
  'utf8',
);

/** Every `startTransition(...)` call as a [from, to) span of the source. */
function transitionSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  const opener = /startTransition\(/g;
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
    spans.push([match.index, at + 1]);
  }
  return spans;
}

const SPANS = transitionSpans(app);
const inTransition = (at: number): boolean => SPANS.some(([from, to]) => at >= from && at < to);

const lineAt = (at: number): string => `src/App.tsx:${String(app.slice(0, at).split('\n').length)}`;

/** The setters that put a screen on top of the conversation, opening calls only:
 *  passing `null` or an updater takes one away, which suspends nothing. */
const OPENS =
  /set(?:SettingsOpen|GraphOpen|ReviewsOpen|ReviewQueueOpen|SkillsOpen|UsageOpen|AddMore)\(true\)|set(?:DesignAt|HelpersAt|CanvasAt)\((?!null\)|\(was\))/g;

/** The views that are only fetched when something asks for them. */
function lazyViews(source: string): string[] {
  const found: string[] = [];
  const declared = /const (\w+) = lazy\(/g;
  let match: RegExpExecArray | null;
  while ((match = declared.exec(source)) !== null) found.push(match[1] as string);
  return found;
}

describe('opening a view', () => {
  it('finds the presses at all, so a silent pass means something', () => {
    expect((app.match(OPENS) ?? []).length).toBeGreaterThan(18);
    expect(SPANS.length).toBeGreaterThan(15);
  });

  it('happens in a transition, so what is on screen stays there', () => {
    const guilty: string[] = [];
    let match: RegExpExecArray | null;
    OPENS.lastIndex = 0;
    while ((match = OPENS.exec(app)) !== null) {
      if (!inTransition(match.index)) guilty.push(lineAt(match.index));
    }
    expect(guilty, `these open a screen outside a transition: ${guilty.join(', ')}`).toEqual([]);
  });

  it('closes the other screens in one transition too', () => {
    const at = app.indexOf("if (screen !== 'chat') setDesignAt(null);");
    expect(at).toBeGreaterThan(0);
    expect(inTransition(at)).toBe(true);
  });

  it('imports the transition it uses', () => {
    expect(app).toMatch(/import \{[^}]*\bstartTransition\b[^}]*\} from "react";/);
  });
});

describe('waiting for a view', () => {
  it('gives every lazy view a boundary of its own', () => {
    const views = lazyViews(app);
    expect(views.length).toBeGreaterThan(15);

    const unguarded = views.filter((name) => {
      const mount = new RegExp(`<${name}[\\s/>]`).exec(app);
      if (mount === null) return true;
      const before = app.slice(0, mount.index).trimEnd();
      return !before.endsWith('>') || !/<Suspense fallback=[^\n]*>$/.test(before);
    });

    expect(unguarded, `these still fall back to the root: ${unguarded.join(', ')}`).toEqual([]);
  });

  it('draws a sheet-coloured rectangle where the sheet will be', () => {
    expect(app).toContain('<div className="sheet sheet--arriving" aria-busy="true" />');
    expect(sheet).toMatch(/\.sheet--arriving \{\s*background: var\(--bg\);/);
  });

  it('says nothing at all where a screen is closed, so nothing paints at launch', () => {
    expect(app).toContain('fallback={settingsOpen ? ARRIVING : null}');
    expect(app).toContain('fallback={clashPath === null ? null : ARRIVING}');
  });
});

describe('warming the views', () => {
  it('fetches them once the first paint is over', () => {
    expect(app).toMatch(/const VIEWS = \[/);
    expect(app.slice(app.indexOf('const VIEWS = ['), app.indexOf('const VIEWS = [') + 700)).toContain(
      './components/Settings',
    );
    expect(app).toContain('window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500))');
    expect(app).toContain('for (const load of VIEWS) void load();');
    expect(app).toContain('(window.cancelIdleCallback ?? clearTimeout)(handle as never)');
  });

  it('warms the screens a press reaches, and only ones that are lazy', () => {
    const block = app.slice(app.indexOf('const VIEWS = ['), app.indexOf('];', app.indexOf('const VIEWS = [')));
    const warmed = [...block.matchAll(/\.\/components\/(\w+)/g)].map((one) => one[1] as string);
    expect(warmed.length).toBeGreaterThan(7);
    const views = lazyViews(app);
    expect(warmed.filter((one) => !views.includes(one))).toEqual([]);
  });
});
