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

/** Every transition call as a [from, to) span of the source. The window's own
 *  `startScreen` is `useTransition`'s, so it can also say when it is still
 *  waiting; `startTransition` is the same thing without that. */
function transitionSpans(source: string): [number, number][] {
  const spans: [number, number][] = [];
  const opener = /start(?:Transition|Screen)\(/g;
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

  /* Not a transition any more, and the reason is the bug that took three goes.
     React holds a transition until it is ready and then commits them in the
     order they were made, so pressing Design and then Skills before Design has
     arrived put Design up for a moment on the way to Skills, and nothing can
     call a transition off. The wait is held by the window instead: the code is
     fetched, and only then is the screen changed, by the newest press alone. */
  it('holds the wait itself rather than handing it to a transition', () => {
    expect(app).not.toMatch(/\buseTransition\b/);
    expect(app).toContain('const startScreen = useCallback((run: () => void, closing = false) => {');
    expect(app).toContain('const token = (pressAt.current += 1);');
    expect(app).toContain('if (pressAt.current !== token) return;');
  });

  /* And the open before the close, a frame apart. Run together they are one
     commit, which sounds right and is not: for the frame between the old screen
     coming down and the new one being painted, what shows is whatever was
     behind them both, which is the conversation. That is why the flash appeared
     leaving the canvas and not arriving at it. */
  it('opens the new screen before it closes the old one', () => {
    expect(app).toContain('(closing ? pressCloses : pressOpens).current.push(run);');
    expect(app).toContain('for (const one of opens) one();');
    expect(app).toContain('requestAnimationFrame(() => {');
    expect(app).toContain('for (const one of closes) one();');
    // The closing half of a press is marked as such where it is made.
    expect(app).toContain("if (screen !== 'canvas' && screen !== 'helpers') setCanvasAt(null);\n      }, true);");
  });

  it('covers the ground at once while the code is still arriving', () => {
    const at = app.indexOf('const startScreen = useCallback(');
    const body = app.slice(at, at + 900);
    expect(body).toContain('if (viewsWarm) {\n        swap();\n        return;\n      }');
    expect(body).toContain('setCovering(true);\n      void warmViews().then(() => {');
    expect(app).toContain('{covering ? COVER : null}');
    expect(app).toContain('const COVER = <div className="sheet sheet--arriving sheet--cover"');
    expect(sheet).toMatch(/\.sheet--cover \{[^}]*animation: none;/);
  });

  it('draws nothing at all once every screen is here', () => {
    /* Warm, the swap is a frame; a cover would be the only thing anybody saw. */
    const at = app.indexOf('const startScreen = useCallback(');
    const warm = app.slice(at, app.indexOf('setCovering(true)', at));
    expect(warm).toContain('if (viewsWarm) {');
    expect(warm).not.toContain('setTimeout');
  });

  it('closes the canvas like any other screen', () => {
    expect(app).toContain("if (screen !== 'canvas' && screen !== 'helpers') setCanvasAt(null);");
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
    expect(app).toContain('void warmViews();');
    expect(app).toContain('warming ??= Promise.all(VIEWS.map((load) => load())).then(() => {');
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
