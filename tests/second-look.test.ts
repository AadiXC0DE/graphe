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
