/** Graphe's own application menu.
 *
 * Electron's default menu ships View → Reload (⌘R) and Toggle Developer Tools.
 * ⌘R reloads the window in the middle of a run: the work carries on in the main
 * process while the window comes back from history showing steps that will
 * never close. It is one keystroke away from every text field in the app, and
 * nothing in a shipped build has any use for it.
 *
 * So the menu is written here instead, as a plain template with no Electron in
 * it, and the ids the window needs to answer are named rather than matched on
 * their labels.
 */

import { THEME_WORDS, THEMES, type Theme } from '../src/lib/theme';

export type MenuItem = {
  label?: string;
  role?: string;
  accelerator?: string;
  id?: string;
  type?: string;
  /** A version line reads, it does not press. */
  enabled?: boolean;
  submenu?: MenuItem[];
};

export const MENU_IDS = {
  openFolder: 'open-folder',
  newConversation: 'new-conversation',
  diagnostics: 'copy-diagnostics',
  releaseNotes: 'release-notes',
} as const;

/** The theme is in the menu because it is the one View setting people go
 *  looking for in a menu bar. The panel keeps its own control, and both offer
 *  the same finishes because the list comes from the same place. */
export function themeId(theme: Theme): string {
  return `theme-${theme}`;
}

const separator: MenuItem = { type: 'separator' };

function appMenu(appName: string): MenuItem {
  return {
    label: appName,
    submenu: [
      { role: 'about', label: `About ${appName}` },
      separator,
      { role: 'services' },
      separator,
      { role: 'hide' },
      { role: 'hideOthers' },
      { role: 'unhide' },
      separator,
      { role: 'quit' },
    ],
  };
}

function fileMenu(onMac: boolean): MenuItem {
  return {
    label: 'File',
    submenu: [
      { id: MENU_IDS.openFolder, label: 'Open folder…', accelerator: 'CmdOrCtrl+O' },
      { id: MENU_IDS.newConversation, label: 'New conversation', accelerator: 'CmdOrCtrl+N' },
      separator,
      onMac ? { role: 'close' } : { role: 'quit' },
    ],
  };
}

function editMenu(onMac: boolean): MenuItem {
  return {
    label: 'Edit',
    submenu: [
      { role: 'undo' },
      { role: 'redo' },
      separator,
      { role: 'cut' },
      { role: 'copy' },
      { role: 'paste' },
      ...(onMac ? [{ role: 'pasteAndMatchStyle' }] : []),
      { role: 'delete' },
      separator,
      { role: 'selectAll' },
    ],
  };
}

function viewMenu(debug: boolean): MenuItem {
  const items: MenuItem[] = [
    {
      label: THEME_WORDS.name,
      submenu: [
        { id: themeId('system'), label: THEME_WORDS.system, type: 'radio' },
        separator,
        ...THEMES.map((theme) => ({ id: themeId(theme.id), label: theme.label, type: 'radio' })),
      ],
    },
    separator,
    { role: 'resetZoom' },
    { role: 'zoomIn' },
    { role: 'zoomOut' },
    separator,
    { role: 'togglefullscreen' },
  ];
  if (debug) {
    items.push(separator, {
      label: 'Developer',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }],
    });
  }
  return { label: 'View', submenu: items };
}

function windowMenu(onMac: boolean): MenuItem {
  return {
    label: 'Window',
    submenu: onMac
      ? [{ role: 'minimize' }, { role: 'zoom' }, separator, { role: 'front' }]
      : [{ role: 'minimize' }, { role: 'close' }],
  };
}

function helpMenu(appName: string, version: string): MenuItem {
  return {
    label: 'Help',
    submenu: [
      { label: `${appName} ${version}`, enabled: false },
      separator,
      { id: MENU_IDS.diagnostics, label: 'Copy diagnostics' },
      { id: MENU_IDS.releaseNotes, label: 'Release notes' },
    ],
  };
}

/** The whole menu. `debug` is `GRAPHE_DEBUG=1`, and it is the only thing that
 *  puts reloading and developer tools within reach. */
export function menuTemplate(opts: {
  appName: string;
  version: string;
  debug: boolean;
  onMac: boolean;
}): MenuItem[] {
  const { appName, version, debug, onMac } = opts;
  return [
    ...(onMac ? [appMenu(appName)] : []),
    fileMenu(onMac),
    editMenu(onMac),
    viewMenu(debug),
    windowMenu(onMac),
    helpMenu(appName, version),
  ];
}
