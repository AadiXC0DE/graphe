/** The window went black for a frame the first time any view opened.
 *
 * Twenty views are `lazy`, and the only Suspense boundaries were the two around
 * the whole conversation with `fallback={null}`. Pressing Canvas suspended that
 * root boundary, React unmounted the entire tree, and the body background was
 * all that painted until the chunk landed.
 *
 * Three things keep it away, and all three are invisible to types and to a
 * reviewer reading one hunk: the press happens in a transition, so what is on
 * screen stays there; each view has a boundary of its own, so a slow chunk never
 * reaches the root again; and the chunks are fetched at idle, so the press
 * usually finds them already there. Checked on the source, the way the stale
 * dependency sweep is.
 *
 *  Source text, not behaviour: the window's render and effect wiring around twenty lazy views, and one sheet rule; no behavioural test can reach it — nothing in this suite renders the window.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const app = readFileSync(fileURLToPath(new URL('../src/App.tsx', import.meta.url)), 'utf8');
const sheet = readFileSync(
  fileURLToPath(new URL('../src/components/Sheet.css', import.meta.url)),
  'utf8',
);

/** Every `startScreen` / `startTransition` call as a [from, to) span of the
 *  source, so a press can be asked whether it happens inside one. */
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
  /set(?:SettingsOpen|GraphOpen|ReviewsOpen|ReviewQueueOpen|SkillsOpen|UsageOpen|AddMore)\(true\)|setHelpersAt\((?!null\)|\(was\))/g;

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
    expect((app.match(OPENS) ?? []).length).toBeGreaterThan(12);
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

  it('closes the other screens through the same door', () => {
    const at = app.indexOf("if (screen !== 'graph') setGraphOpen(false);");
    expect(at).toBeGreaterThan(0);
    expect(inTransition(at)).toBe(true);
  });

  /* Not a transition any more, and the reason is the bug that took three goes.
     React holds a transition until it is ready and then commits them in the
     order they were made, so pressing Canvas and then Skills before Canvas has
     arrived put Canvas up for a moment on the way to Skills, and nothing can
     call a transition off. The wait is held by the window instead: the code is
     fetched, and only then is the screen changed, by the newest press alone. */
  it('holds the wait itself rather than handing it to a transition', () => {
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
  });

  it('covers the ground at once while the code is still arriving', () => {
    const at = app.indexOf('const startScreen = useCallback(');
    // Up to the end of that callback: the block carries a few lines of comment,
    // and a fixed character count made the assertion about the comments.
    const body = app.slice(at, app.indexOf('\n  }, []);', at));
    expect(body).toContain('if (viewsWarm) {\n        swap();\n        return;\n      }');
    expect(body).toContain('setCovering(true);');
    expect(body).toContain('void fetchAllViews().then(() => {');
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
    expect(app).toContain(
      '<div className="sheet sheet--arriving" role="status" aria-busy="true" aria-label={holding} />',
    );
    expect(sheet).toMatch(/\.sheet--arriving \{\s*background: var\(--bg\);/);
  });

  it('says nothing at all where a screen is closed, so nothing paints at launch', () => {
    expect(app).toContain('fallback={settingsOpen ? arriving(settingsWords.title) : null}');
    expect(app).toContain("fallback={clashPath === null ? null : arriving('Both sides changed the same lines')}");
  });

  /* The rectangle is what a screen reader lands on when a press has to wait, so
     an unnamed one is announced as a blank region rather than as a sheet on its
     way. Which sheet it names is a fact about the render, not the source — the
     loading row in the visual matrix reads the label off the real window. */
  it('names the sheet it is holding', () => {
    expect(app).toMatch(
      /function arriving\(holding: string\) \{[\s\S]*role="status"[\s\S]*aria-label=\{holding\}/,
    );
    const held = [...app.matchAll(/fallback=\{[^\n]*?arriving\(([^)]*)\)/g)].map((one) =>
      String(one[1] ?? '').trim(),
    );
    expect(held.length).toBe(11);
    expect(held.filter((one) => one === '' || one === "''")).toEqual([]);
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
    // The idle fetch is the screens a sitting reaches first; everything else
    // waits for a press that needs it. Fetching all of them spent idle time on
    // panels nobody had opened.
    expect(app).toContain('warming ??= Promise.all(VIEWS.slice(0, WARM_FIRST).map((load) => load()))');
    expect(app).toContain('fetchingAll ??= Promise.all(VIEWS.map((load) => load()))');
    expect(app).toContain('void fetchAllViews()');
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

describe('a screen closes only the others', () => {
  /* Each line names its own screen. Naming the chat's was invisible while the
     close and the open ran in one breath and the open came second; a frame
     apart, it closed the screen it had just opened and the press did nothing at
     all. */
  it('never closes the screen being opened', () => {
    const at = app.indexOf("const goToScreen = useCallback(");
    const body = app.slice(at, at + 2200);
    const closes = [...body.matchAll(/if \(screen !== '([a-z-]+)'(?: && screen !== '[a-z-]+')?\) set(\w+)\(/g)];
    const owns: Record<string, string> = {
      graph: 'GraphOpen',
      reviews: 'ReviewsOpen',
      review: 'ReviewQueueOpen',
      skills: 'SkillsOpen',
      settings: 'SettingsOpen',
      usage: 'UsageOpen',
      'add-more': 'AddMore',
      helpers: 'HelpersAt',
    };
    // One close line per screen named below: a screen the press does not close
    // leaves the surface behind it up.
    expect(closes.length).toBe(Object.keys(owns).length);
    for (const [, screen, setter] of closes) {
      expect(owns[screen as string], `${String(screen)} closes ${String(setter)}`).toBe(setter);
    }
  });
});
