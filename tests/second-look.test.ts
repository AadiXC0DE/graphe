/** The things a second pass through the built app turned up.
 *
 * Every one of these was visible in a screenshot and invisible to types: a band
 * that read as a stray "0", a count cut to "3 d…", a drawer drawn over the
 * control it was hiding, a new conversation that opened behind the canvas, a
 * finish somebody could switch to that the app is not drawn for. They are
 * guarded on the source, the way the rest of the composition is.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PRESETS, appearanceWords, defaultAppearance, tokensFor } from '../src/design/appearance';
import { OPEN_TO, ROWS as rows, asOpenTo } from '../src/work/settingspages';
import { withElapsed } from '../src/work/goal';

const read = (path: string): string =>
  readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), 'utf8');

const overview = read('src/components/Overview.tsx');
const overviewCss = read('src/components/Overview.css');
const canvasCss = read('src/components/CanvasView.css');
const sidebarCss = read('src/components/Sidebar.css');
const band = read('src/components/AppearanceBand.tsx');
const picker = read('src/components/ColourPicker.tsx');
const app = read('src/App.tsx');
const welcome = read('src/components/Welcome.tsx');
const welcomeCss = read('src/components/Welcome.css');
const settings = read('src/components/Settings.tsx');
const sheetCss = read('src/components/Sheet.css');
const diffCss = read('src/components/DiffView.css');
const tokensCss = read('src/styles/tokens.css');
const connect = read('src/hooks/useConnect.ts');
const main = read('electron/main.ts');

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

describe('the canvas under a drawer', () => {
  /* The drawer is fixed to the bottom of the window, and the canvas was too, so
     opening one covered the zoom control and the card that says a run stopped. */
  it('gives the drawer its room rather than being drawn over', () => {
    expect(canvasCss).toMatch(/\.canvas \{[^}]*bottom: var\(--commands-take, 0px\);/);
  });

  /* "8 blocks · 3 d…" is not a shorter sentence, it is a broken one. */
  it('drops the count rather than cutting a word in half', () => {
    expect(canvasCss).toMatch(/\.canvas__count \{[^}]*flex: none;/);
    expect(canvasCss).not.toMatch(/\.canvas__count \{[^}]*text-overflow: ellipsis;/);
    expect(canvasCss).toMatch(/@media \(max-width: 1180px\) \{\s*\.canvas__count \{\s*display: none;/);
  });
});

describe('a new conversation from anywhere', () => {
  /* Pressing + on the canvas opened a tab and left you on the canvas, so the
     thing that was asked for happened somewhere nobody could see. */
  it('leaves whatever screen is over the conversation', () => {
    const at = app.indexOf('const swapConversation = useCallback(');
    expect(at).toBeGreaterThan(0);
    const body = app.slice(at, at + 1400);
    expect(body).toContain('setCanvasAt(null);');
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
    expect(sidebarCss).not.toMatch(/\.shelf--closed::before \{[^}]*border-bottom/);
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
    expect(band).not.toContain("choice('finish'");
    expect(band).not.toContain('appearanceWords.finish');
  });

  it('still works, so putting it back is a press', () => {
    const glass = tokensFor({ ...defaultAppearance, finish: 'glass' }, 'dark');
    expect(glass['--bg']).toContain('color-mix');
    expect(glass['--glass-blur']).toBe('22px');
    expect(appearanceWords.finish.glass).toBe('Glass');
  });
});

describe('choosing a colour', () => {
  /* Three `<input type="color">` in a row is a form, not a palette: nothing to
     recognise, nothing to compare, and the operating system's wheel behind each
     one. */
  it('is a swatch, what it is set to, and colours worth one press', () => {
    expect(picker).toContain('className="colour__swatch"');
    expect(picker).toContain('{chosen === null ? WORDS.auto : value.toUpperCase()}');
    expect(picker).toContain('className="colour__grid"');
    expect(picker).toContain('const READY');
  });

  it('keeps the hex field and the wheel for whoever wants them', () => {
    expect(picker).toContain("aria-label={WORDS.hex}");
    expect(picker).toContain('type="color"');
  });

  it('is drawn from the swatch rather than whatever ancestor is positioned', () => {
    expect(picker).toContain("useAnchored(chip, open, 'below-right')");
    expect(picker).toContain('createPortal(');
  });

  it('offers Auto only where there is something to work it out from', () => {
    expect(picker).toContain('onAuto === undefined ? null : (');
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

describe('a screen that arrives', () => {
  /* The flicker that survived two fixes. A sheet faded in from nothing over
     280ms, and what shows through a half-transparent sheet is the screen you
     just left: canvas to history flashed the conversation, history to canvas
     did not, because the canvas is opaque and does not fade. Screens are opened
     dozens of times an hour, the frequency the motion rule bans animating at. */
  it('does not fade in over whatever is behind it', () => {
    expect(sheetCss).not.toContain('animation: sheet-arrives');
    expect(sheetCss).not.toContain('@keyframes sheet-arrives');
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
