/** The application menu.
 *
 * The one thing this file exists to prevent is ⌘R in a shipped build: it
 * reloads the window in the middle of a run and the conversation comes back
 * showing steps that will never close. So the roles that do that are asserted
 * absent, not merely unlikely.
 */

import { describe, expect, it } from 'vitest';

import { MENU_IDS, menuTemplate, themeId, type MenuItem } from '../electron/menu';
import { THEMES } from '../src/lib/theme';

function everyItem(items: readonly MenuItem[]): MenuItem[] {
  return items.flatMap((one) => [one, ...everyItem(one.submenu ?? [])]);
}

function menuNamed(items: readonly MenuItem[], label: string): MenuItem | undefined {
  return items.find((one) => one.label === label);
}

const shipped = { appName: 'Graphe', version: '0.8.5', debug: false, onMac: true };

describe('a shipped build', () => {
  it('has no reload and no developer tools', () => {
    const roles = everyItem(menuTemplate(shipped)).map((one) => one.role);
    expect(roles).not.toContain('reload');
    expect(roles).not.toContain('forceReload');
    expect(roles).not.toContain('toggleDevTools');
  });

  it('binds no accelerator to ⌘R', () => {
    const keys = everyItem(menuTemplate(shipped)).map((one) => one.accelerator);
    expect(keys).not.toContain('CmdOrCtrl+R');
  });

  it('still offers the theme, zoom and full screen', () => {
    const view = menuNamed(menuTemplate(shipped), 'View');
    const inside = everyItem(view?.submenu ?? []);
    expect(inside.map((one) => one.label)).toContain('Theme');
    expect(inside.map((one) => one.role)).toContain('zoomIn');
    expect(inside.map((one) => one.role)).toContain('togglefullscreen');
  });
});

describe('the theme', () => {
  it('offers every finish the panel does, and following the computer', () => {
    const view = menuNamed(menuTemplate(shipped), 'View');
    const theme = menuNamed(view?.submenu ?? [], 'Theme');
    const ids = everyItem(theme?.submenu ?? []).map((one) => one.id);

    expect(ids).toContain(themeId('system'));
    for (const one of THEMES) expect(ids).toContain(themeId(one.id));
  });
});

describe('with GRAPHE_DEBUG', () => {
  it('puts reload and developer tools back', () => {
    const roles = everyItem(menuTemplate({ ...shipped, debug: true })).map((one) => one.role);
    expect(roles).toContain('reload');
    expect(roles).toContain('forceReload');
    expect(roles).toContain('toggleDevTools');
  });
});

describe('File', () => {
  it('opens a folder and starts a conversation, by id', () => {
    const file = menuNamed(menuTemplate(shipped), 'File');
    const ids = everyItem(file?.submenu ?? []).map((one) => one.id);
    expect(ids).toContain(MENU_IDS.openFolder);
    expect(ids).toContain(MENU_IDS.newConversation);
  });
});

describe('Help', () => {
  it('carries the version and the diagnostics item', () => {
    const help = menuNamed(menuTemplate(shipped), 'Help');
    const inside = everyItem(help?.submenu ?? []);
    expect(inside.some((one) => one.label?.includes('0.8.5') === true)).toBe(true);
    expect(inside.map((one) => one.id)).toContain(MENU_IDS.diagnostics);
    expect(inside.map((one) => one.id)).toContain(MENU_IDS.releaseNotes);
  });

  it('does not offer the version as something to press', () => {
    const help = menuNamed(menuTemplate(shipped), 'Help');
    const version = everyItem(help?.submenu ?? []).find(
      (one) => one.label?.includes('0.8.5') === true,
    );
    expect(version?.enabled).toBe(false);
  });
});

describe('the app menu', () => {
  it('leads the bar on macOS', () => {
    expect(menuTemplate(shipped)[0]?.label).toBe('Graphe');
  });

  it('is absent everywhere else, and File leads instead', () => {
    const elsewhere = menuTemplate({ ...shipped, onMac: false });
    expect(elsewhere[0]?.label).toBe('File');
    expect(menuNamed(elsewhere, 'Graphe')).toBeUndefined();
    // Nothing quits from an app menu that is not there.
    expect(everyItem(elsewhere).map((one) => one.role)).toContain('quit');
  });
});
