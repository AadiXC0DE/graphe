// @vitest-environment jsdom
/** The things a second pass through the built app turned up.
 *
 * Every one of these was visible in a screenshot and invisible to types: a band
 * that read as a stray "0", a count cut to "3 d…", a drawer drawn over the
 * control it was hiding, a new conversation that opened behind the canvas, a
 * finish somebody could switch to that the app is not drawn for. They are
 * guarded on the source, the way the rest of the composition is.
 *
 *  Source text, not behaviour: stylesheet rules jsdom cannot compute and App/main wiring no render reaches; the drawable components are drawn.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import AppearanceBand from '../src/components/AppearanceBand';
import ColourPicker from '../src/components/ColourPicker';
import HelpersView from '../src/components/HelpersView';
import { PRESETS, appearanceWords, defaultAppearance, tokensFor } from '../src/design/appearance';
import { OPEN_TO, ROWS as rows, asOpenTo } from '../src/work/settingspages';
import { withElapsed } from '../src/work/goal';
import { tallyOf, titleOf } from '../src/components/HelpersView';

/* jsdom has no file: URL of its own, so the sources are read from the repo root
   the run starts in. */
const read = (path: string): string => readFileSync(join(process.cwd(), path), 'utf8');

const overview = read('src/components/Overview.tsx');
const overviewCss = read('src/components/Overview.css');
const sidebarCss = read('src/components/Sidebar.css');
const welcome = read('src/components/Welcome.tsx');
const welcomeCss = read('src/components/Welcome.css');
const settings = read('src/components/Settings.tsx');
const app = read('src/App.tsx');
const diffCss = read('src/components/DiffView.css');
const tokensCss = read('src/styles/tokens.css');
const connect = read('src/hooks/useConnect.ts');
const main = read('electron/main.ts');
const helpersCss = read('src/components/HelpersView.css');
const appCss = read('src/App.css');
const settingsCss = read('src/components/Settings.css');

beforeAll(() => {
  // React only batches inside act() once a test harness says it is driving.
  const runtime = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; ResizeObserver?: unknown };
  runtime.IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom measures nothing, so the sheet's clipped half only needs something
  // that can be observed.
  runtime.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

/* One component at a time: a menu in a portal lands on the body, where a second
   one would be a second answer to the same query. */
const drawn: { host: HTMLElement; root: Root }[] = [];

function undraw(): void {
  for (const one of drawn.splice(0)) {
    act(() => {
      one.root.unmount();
    });
    one.host.remove();
  }
}

afterEach(undraw);

function draw(element: ReactElement): HTMLElement {
  undraw();
  const host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  const root = createRoot(host);
  act(() => {
    root.render(element);
  });
  drawn.push({ host, root });
  return host;
}

/** A press the way React hears it. */
function press(control: Element | null | undefined): void {
  if (control == null) throw new Error('nothing was there to press');
  act(() => {
    control.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  });
}

describe('a band that folds', () => {
  /* Closed, with nothing in it, the band drew the word LOOKED UP and a "0" on
     the line under it. Two faults at once: an unstyled press, and a band that
     had nothing to say and said it anyway. */
  it('is not drawn at all until something has been looked up', () => {
    expect(overview).toContain('{research.length === 0 ? null : (');
  });

  it('is one line closed: the name, how many, and the mark', () => {
    expect(overviewCss).toMatch(/\.overview__fold \{[^}]*display: flex;/);
    expect(overviewCss).toMatch(/\.overview__fold \{[^}]*align-items: center;/);
    expect(overviewCss).toMatch(/\.overview__fold \.overview__title \{[^}]*flex: 1 1 auto;/);
    expect(overviewCss).toMatch(/\.overview__foldcount \{[^}]*flex: none;/);
  });
});

describe('a new conversation from anywhere', () => {
  /* Pressing + from another screen opened a tab and left you on that screen, so
     the thing that was asked for happened somewhere nobody could see. */
  it('leaves whatever screen is over the conversation', () => {
    const at = app.indexOf('const swapConversation = useCallback(');
    expect(at).toBeGreaterThan(0);
    const body = app.slice(at, at + 1400);
    expect(body).toContain("goToScreen('chat');");
  });
});

describe('the folded shelf', () => {
  /* The window's own buttons sit at 18,20 and the strip is 54 wide, so the band
     above the toggle is theirs and cannot hold anything of ours. What it can do
     is be the least room that clears them, and be the drag handle that corner
     already is. */
  it('reserves the least room that clears the window buttons', () => {
    expect(sidebarCss).toMatch(/\[data-shell='desktop'\] \.shelf--closed \{\s*padding-top: 34px;/);
    expect(sidebarCss).toMatch(/\[data-shell='desktop'\] \.shelf--closed::before \{[^}]*-webkit-app-region: drag;/);
  });

  it('gives it back in full screen, where those buttons are gone', () => {
    expect(sidebarCss).toMatch(/\[data-full='yes'\] \.shelf--closed \{\s*padding-top: var\(--space-2\);/);
  });
});

describe('a finish the app is not drawn for', () => {
  /* The tokens and the window flag work. Every surface in the app being drawn
     for a translucent ground does not, and a person who switches to it gets the
     half that does not. Kept, not offered. */
  it('is not one of the starting points', () => {
    expect(PRESETS.some((one) => one.is.finish === 'glass')).toBe(false);
    expect(PRESETS.map((one) => one.id)).toEqual(['graphe', 'super', 'pink', 'slate']);
  });

  it('is not a control on the appearance panel', () => {
    const host = draw(
      createElement(AppearanceBand, {
        appearance: defaultAppearance,
        onChange: () => undefined,
        on: 'dark',
      }),
    );
    const named = [...host.querySelectorAll('.appearance__name')].map((one) => one.textContent);
    // The rows it does draw, so that an empty panel cannot pass this either.
    expect(named).toEqual([
      appearanceWords.tone.name,
      appearanceWords.contrast.name,
      appearanceWords.radius.name,
      appearanceWords.density.name,
      appearanceWords.motion.name,
      appearanceWords.uiFont.name,
      appearanceWords.codeFont.name,
      appearanceWords.ligatures.name,
    ]);
    expect(host.textContent).not.toContain(appearanceWords.finish.glass);
  });

  it('still works, so putting it back is a press', () => {
    const glass = tokensFor({ ...defaultAppearance, finish: 'glass' }, 'dark');
    expect(glass['--bg']).toContain('color-mix');
    expect(glass['--glass-blur']).toBe('22px');
    expect(appearanceWords.finish.glass).toBe('Glass');
  });
});

describe('choosing a colour', () => {
  type PickerProps = Parameters<typeof ColourPicker>[0];

  /* Three `<input type="color">` in a row is a form, not a palette: nothing to
     recognise, nothing to compare, and the operating system's wheel behind each
     one. */
  /** The picker open, the way a press opens it. The menu is in a portal, so it
   *  is read off the body rather than out of the component's own place. */
  function opened(over: Partial<PickerProps> = {}): HTMLElement {
    const host = draw(
      createElement(ColourPicker, {
        name: 'Accent',
        value: '#b8492c',
        chosen: '#b8492c',
        onChange: () => undefined,
        ...over,
      }),
    );
    press(host.querySelector('.colour__chip'));
    return host;
  }

  function menu(): HTMLElement {
    const found = document.querySelector('.colour__menu');
    if (found === null) throw new Error('the picker drew no menu');
    return found as HTMLElement;
  }

  it('is a swatch, what it is set to, and colours worth one press', () => {
    const taken: string[] = [];
    const host = opened({ onChange: (hex) => taken.push(hex) });

    const chip = host.querySelector('.colour__chip');
    expect(chip?.querySelector('.colour__swatch')).not.toBeNull();
    expect(chip?.textContent).toContain('#B8492C');

    const ready = [...menu().querySelectorAll('.colour__grid button')];
    expect(ready).toHaveLength(12);
    expect(ready[0]?.getAttribute('aria-label')).toBe('Ember');
    press(ready[0]);
    expect(taken).toEqual(['#b8492c']);

    // And where the colour is worked out rather than set, the chip says so.
    const workedOut = opened({ chosen: null });
    expect(workedOut.querySelector('.colour__chip')?.textContent).toContain('Auto');
  });

  it('keeps the hex field and the wheel for whoever wants them', () => {
    opened();
    expect(menu().querySelector('input[aria-label="Hex"]')).not.toBeNull();
    expect(menu().querySelector('input[type="color"]')).not.toBeNull();
  });

  it('is drawn from the swatch rather than whatever ancestor is positioned', () => {
    const host = opened();
    const sheet = menu();
    expect(host.contains(sheet)).toBe(false);
    expect(sheet.parentElement).toBe(document.body);
    expect(sheet.style.position).toBe('fixed');
  });

  it('offers Auto only where there is something to work it out from', () => {
    opened({ onAuto: () => undefined });
    expect(menu().querySelector('.colour__auto')).not.toBeNull();

    opened();
    expect(menu().querySelector('.colour__auto')).toBeNull();
  });
});

describe('the first screen of a project', () => {
  /* It is the screen every sitting begins on, so it is allowed to be more than
     a heading on an empty page. Painted once, moving never. */
  it('has a ground of its own, under everything real', () => {
    expect(welcome).toContain('className="welcome__ground"');
    expect(welcomeCss).toMatch(/\.welcome > \*:not\(\.welcome__ground\) \{[^}]*z-index: 1;/);
    expect(welcomeCss).toMatch(/\.welcome__ground \{[^}]*pointer-events: none;/);
  });

  it('says which folder in the folder’s own colour', () => {
    expect(welcome).toContain('className="welcome__where"');
    expect(welcomeCss).toMatch(/\.welcome__where \{\s*color: var\(--accent-ink\);/);
  });
});

describe('what is on this computer', () => {
  /* The shell has answered with a row per folder and a way to empty the two
     that never hold work since the storage page existed. The screen drew one
     sentence naming six folders, which is a sentence nobody reads. */
  it('is a row per folder, biggest first', () => {
    expect(settings).toContain("case 'folders':");
    expect(settings).toContain('[...storage.rows]');
    expect(settings).toContain('.sort((a, b) => b.bytes - a.bytes)');
    expect(settings).toContain('{saysBytes(one.bytes)}');
  });

  it('offers a Clear only where clearing can lose nothing', () => {
    expect(settings).toContain('one.clearable && onClearFolder !== undefined ?');
    expect(rows.some((one) => one.id === 'folders' && one.page === 'storage')).toBe(true);
  });

  it('keeps the answer whole rather than three fields of it', () => {
    expect(app).toContain('useState<StorageNow | null>(null)');
    expect(app).toContain('void bridge.clearFolder(name).then((answer) => {');
  });
});

describe('where a launch lands', () => {
  /* Opening straight into whichever folder was last in front skips the one
     screen where a person chooses, and it went past too fast to read. Nothing
     chosen means the list; the folder is still one press, and still a
     preference for anybody who wants it back. */
  it('is the list until somebody says otherwise', () => {
    expect(asOpenTo(null)).toBe('list');
    expect(asOpenTo(undefined)).toBe('list');
    expect(asOpenTo('nonsense')).toBe('list');
    expect(asOpenTo('last')).toBe('last');
    expect(asOpenTo('list')).toBe('list');
  });

  it('is still both, on the row that chooses', () => {
    expect(OPEN_TO.map((one) => one.id)).toEqual(['last', 'list']);
  });
});

describe('the goal band', () => {
  /* Six minutes of work read as forty and kept counting: elapsed was measured
     from the moment the goal started, every time it was drawn, whatever the
     goal was doing. */
  it('stops counting once the goal is not running', () => {
    const started = Date.now() - 60_000;
    const base = { id: 'g', objective: 'x', iterations: 1, elapsed: 12, howFar: 'doing' as const, startedAt: started };
    expect(withElapsed({ ...base, status: 'active' }).elapsed).toBeGreaterThan(50);
    expect(withElapsed({ ...base, status: 'paused' }).elapsed).toBe(12);
    expect(withElapsed({ ...base, status: 'done' }).elapsed).toBe(12);
  });

  it('is put to rest when its job is', () => {
    expect(main).toContain('if (one.resting) void restGoal(one.project, one.address);');
    expect(main).toContain("status: finished ? 'done' : 'paused'");
  });
});

describe('reading a change', () => {
  /* The colour stopped at the edge of the box the moment anybody scrolled
     sideways, because the row was as wide as the box rather than as wide as the
     longest line in the file. */
  it('paints a row to the end of its longest line', () => {
    expect(diffCss).toMatch(/\.diffview__row \{[^}]*width: max-content;/);
    expect(diffCss).toMatch(/\.diffview__row \{[^}]*min-width: 100%;/);
  });

  /* Green and red are what a diff means. The accent was on both grounds, which
     is the app's own colour on the one surface where the colours are the
     information. */
  it('is green and red, with the accent behind a switch', () => {
    expect(diffCss).toContain('--line-in: color-mix(in srgb, var(--good) 12%, var(--bg-raised));');
    expect(diffCss).toContain('--line-out: color-mix(in srgb, var(--bad) 10%, var(--bg-raised));');
    expect(diffCss).toContain("[data-diff='accent']");
    expect(tokensCss).toContain('--good:');
    expect(tokensCss).toContain('--bad:');
  });
});

describe('the model list', () => {
  /* The catalogue on disk is the one the installed runtime shipped with, so a
     model added upstream since, a free one among them, was invisible until
     somebody pressed Refresh. Nobody presses Refresh. */
  it('is asked of the catalogue itself once the window is idle', () => {
    expect(connect).toContain('void refresh(true);');
    expect(connect).toContain('window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 2500))');
  });
});

describe('the helpers screen', () => {
  /* A raw prompt cut mid-sentence, four times in a column, over a pane with a
     horizontal scrollbar under it. A helper is recognised by the line somebody
     wrote it as, and what it came back with is prose, not a paragraph in a box. */
  it('names a helper by its first line rather than its whole ask', () => {
    expect(titleOf('Review PR 316 API + permission. Repo at /Users/x/y. Diff is a vs b.')).toBe(
      'Review PR 316 API + permission',
    );
    expect(titleOf('  \n  Check the build\nand then some more')).toBe('Check the build');
    expect(titleOf('x'.repeat(200)).length).toBeLessThanOrEqual(90);
  });

  it('says how they are all getting on, under the heading', () => {
    const at = 1;
    const some = [
      { id: 'a', task: 'a', saying: null, state: 'running' as const, startedAt: at },
      { id: 'b', task: 'b', saying: 'x', state: 'done' as const, startedAt: at },
      { id: 'c', task: 'c', saying: 'x', state: 'done' as const, startedAt: at },
    ];
    expect(tallyOf(some)).toBe('3 helpers · 1 working, 2 finished');
    expect(tallyOf([])).toBe('0 helpers');
  });

  it('scrolls each half on its own, and wraps a path rather than pushing sideways', () => {
    expect(helpersCss).toMatch(/\.helpersview \{[^}]*overflow: hidden;/);
    expect(helpersCss).toMatch(/\.helpersview__list \{[^}]*overflow-y: auto;/);
    expect(helpersCss).toMatch(/\.helpersview__one \{[^}]*overflow-y: auto;/);
    expect(helpersCss).toMatch(/\.helpersview__asked \{[^}]*overflow-wrap: anywhere;/);
  });

  it('draws what it said as prose', () => {
    const host = draw(
      createElement(HelpersView, {
        helpers: [
          {
            id: 'h1',
            task: 'Check the header',
            saying: 'It is **bold** and [linked](https://example.test).',
            state: 'done' as const,
            startedAt: Date.now(),
          },
        ],
        at: 'h1',
        onClose: () => undefined,
      }),
    );
    const said = host.querySelector('.helpersview__said');
    expect(said).not.toBeNull();
    expect(said?.querySelector('strong')?.textContent).toBe('bold');
    expect(said?.querySelector('a')?.getAttribute('href')).toBe('https://example.test');
    // Not the paragraph in a box that escaped markup would have drawn.
    expect(said?.textContent).not.toContain('**');
  });
});

describe('the strip along the top', () => {
  /* The first tab sat against the shelf's own edge, two surfaces touching with
     nothing between them. */
  it('starts a little after the shelf ends', () => {
    expect(appCss).toMatch(/\.app--shelved \.topbar \{[^}]*padding-left: var\(--space-3\);/);
  });
});

describe('the strip beside the project files', () => {
  it('starts a little after that panel ends too', () => {
    expect(appCss).toMatch(/\.app--files \.topbar \{[^}]*padding-left: var\(--space-3\);/);
  });
});

describe('settings scrolls its page', () => {
  /* Taking the list of pages out of the scroll took the scroll with it: a grid
     item aligned to the start is as tall as its content, so the page under it
     had no height to scroll inside and everything past the fold was clipped. */
  it('gives the page a height to scroll inside', () => {
    const at = settingsCss.indexOf('@container (min-width: 780px)');
    const wide = settingsCss.slice(at, settingsCss.indexOf('/* ---', at));
    expect(wide).toContain('align-items: stretch;');
    expect(wide).toContain('overflow-y: auto;');
  });
});
