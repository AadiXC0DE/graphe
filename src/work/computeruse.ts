/** Computer use: how Graphe may work the programs on this computer.
 *
 * Codex ships this as Settings > Computer use: a master Any-App switch, a
 * browser row with an extension plus a website allowlist, an Excel row backed
 * by an add-in, a macOS-only Locked-use switch, and an Always-allowed apps
 * list. Graphe had the capability (desktop_*, browser_*) but no such screen,
 * so there was nowhere to see it, enable it, or take an app back off it.
 *
 * This file is the model behind that screen. Pure: nothing here reads or
 * writes a preference, opens Settings, or judges a tool call. It says what the
 * preferences are, what they mean, and how an app name is matched — so the
 * Guard (`src/agent/guard/policy.ts`), the settings page
 * (`src/work/settingspages.ts`), and the tests all read the same words.
 *
 * Deliberate differences from Codex, all in the direction of safety:
 *
 * - No silent persistent bypass. An always-allowed app skips the
 *   *question*, never a *refusal*: secrets, disk tools, elevation, and
 *   outside-project writes still deny on every rung.
 * - No auto-unlock. Locked use records consent for background work while the
 *   person steps away with the display on; Graphe never unlocks a Mac by
 *   itself and says so on the screen.
 * - Excel needs no add-in. Ranges are read from the file itself
 *   (`read_document`) and the app is driven with the same named presses as
 *   anything else, so there is nothing extra to install.
 */

export type ComputerUse = {
  /** Master switch. Off, desktop control asks to be enabled first rather than
   *  asking per press. Mirrors Codex "Any App". */
  anyApp: boolean;
  /** The browser Graphe drives. On, the built-in browser works from the first
   *  turn. Mirrors the Chrome row, without needing an extension. */
  browser: boolean;
  /** Let Graphe work in Microsoft Excel (and other spreadsheets) via named
   *  presses plus file reads. Mirrors the Excel add-in row, with no add-in. */
  excel: boolean;
  /** Consent for background work while stepped away. Graphe still never
   *  unlocks a locked Mac; the screen says so. Mirrors Codex Locked use. */
  lockedUse: boolean;
  /** Apps that skip the per-turn question. Never passwords, never refusals.
   *  Mirrors Always-allowed apps, with the refusals kept. */
  allowedApps: readonly string[];
  /** Sites the driven browser may reach at all. Empty is the open web.
   *  Mirrors the Chrome extension Manage list, for the built-in browser. */
  browserSites: readonly string[];
};

export const defaultComputerUse: ComputerUse = {
  anyApp: false,
  browser: true,
  excel: false,
  lockedUse: false,
  allowedApps: [],
  browserSites: [],
};

/** Most names worth keeping on a list. Past this the list is a scroll, and a
 *  scroll of trusted apps is a list nobody reviews. */
export const MOST_ALLOWED_APPS = 20;

/** Most sites worth holding a browser to. Same reasoning as above. */
export const MOST_BROWSER_SITES = 30;

function cleanName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/\s+/g, ' ').trim().slice(0, 80);
  return name === '' ? null : name;
}

function cleanSite(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  let site = raw.trim().toLowerCase();
  if (site === '') return null;
  site = site.replace(/^https?:\/\//, '').replace(/^www\./, '');
  site = site.split('/')[0] ?? '';
  site = site.trim();
  if (site === '' || site.includes(' ') || !site.includes('.')) return null;
  return site.slice(0, 120);
}

/** Read back defensively: a file edited by hand must not become a switch that
 *  turns itself on. Everything unreadable is off or empty. */
export function asComputerUse(raw: unknown): ComputerUse {
  if (typeof raw !== 'object' || raw === null) return { ...defaultComputerUse };
  const one = raw as Record<string, unknown>;
  const allowed: string[] = [];
  if (Array.isArray(one['allowedApps'])) {
    for (const entry of one['allowedApps']) {
      const name = cleanName(entry);
      if (name !== null && !allowed.some((had) => had.toLowerCase() === name.toLowerCase())) {
        allowed.push(name);
      }
      if (allowed.length >= MOST_ALLOWED_APPS) break;
    }
  }
  const sites: string[] = [];
  if (Array.isArray(one['browserSites'])) {
    for (const entry of one['browserSites']) {
      const site = cleanSite(entry);
      if (site !== null && !sites.includes(site)) sites.push(site);
      if (sites.length >= MOST_BROWSER_SITES) break;
    }
  }
  return {
    anyApp: one['anyApp'] === true,
    browser: one['browser'] !== false,
    excel: one['excel'] === true,
    lockedUse: one['lockedUse'] === true,
    allowedApps: allowed,
    browserSites: sites,
  };
}

export function sameComputerUse(one: ComputerUse, other: ComputerUse): boolean {
  return (
    one.anyApp === other.anyApp &&
    one.browser === other.browser &&
    one.excel === other.excel &&
    one.lockedUse === other.lockedUse &&
    one.allowedApps.length === other.allowedApps.length &&
    one.allowedApps.every((name, at) => other.allowedApps[at] === name) &&
    one.browserSites.length === other.browserSites.length &&
    one.browserSites.every((site, at) => other.browserSites[at] === site)
  );
}

/** With an app added. No-op when it is already there or the list is full. */
export function allowApp(use: ComputerUse, app: string): ComputerUse {
  const name = cleanName(app);
  if (name === null) return use;
  if (use.allowedApps.some((had) => had.toLowerCase() === name.toLowerCase())) return use;
  if (use.allowedApps.length >= MOST_ALLOWED_APPS) return use;
  return { ...use, allowedApps: [...use.allowedApps, name] };
}

/** With an app taken back off. */
export function forgetApp(use: ComputerUse, app: string): ComputerUse {
  const name = cleanName(app);
  if (name === null) return use;
  const kept = use.allowedApps.filter((had) => had.toLowerCase() !== name.toLowerCase());
  if (kept.length === use.allowedApps.length) return use;
  return { ...use, allowedApps: kept };
}

/** With a site held. No-op when already there or the list is full. */
export function holdSite(use: ComputerUse, site: string): ComputerUse {
  const cleaned = cleanSite(site);
  if (cleaned === null) return use;
  if (use.browserSites.includes(cleaned)) return use;
  if (use.browserSites.length >= MOST_BROWSER_SITES) return use;
  return { ...use, browserSites: [...use.browserSites, cleaned] };
}

/** With a site released back to the open web. */
export function releaseSite(use: ComputerUse, site: string): ComputerUse {
  const cleaned = cleanSite(site);
  if (cleaned === null) return use;
  const kept = use.browserSites.filter((had) => had !== cleaned);
  if (kept.length === use.browserSites.length) return use;
  return { ...use, browserSites: kept };
}

/** Whether a tool input names this app: the `app`/`name`/`program` field, or a
 *  handle whose program is carried alongside. Case-insensitive, exact. */
export function namesApp(input: Record<string, unknown>, app: string): boolean {
  const wanted = app.trim().toLowerCase();
  if (wanted === '') return false;
  for (const key of ['app', 'name', 'program']) {
    const raw = input[key];
    if (typeof raw === 'string' && raw.trim().toLowerCase() === wanted) return true;
  }
  return false;
}

/** Whether the call is aimed at any allowed app. A picture of the whole screen
 *  belongs to nobody, so it never matches. */
export function isAppAllowed(input: Record<string, unknown>, use: Pick<ComputerUse, 'allowedApps'>): boolean {
  for (const app of use.allowedApps) {
    if (namesApp(input, app)) return true;
  }
  return false;
}

/** Whether the call is aimed at Excel (or a sibling spreadsheet). Matches the
 *  app field only — never cell text — so a budget sheet never opts itself in. */
export function isExcelTarget(input: Record<string, unknown>): boolean {
  for (const key of ['app', 'name', 'program']) {
    const raw = input[key];
    if (typeof raw !== 'string') continue;
    const name = raw.trim().toLowerCase();
    if (
      name === 'microsoft excel' ||
      name === 'excel' ||
      name === 'numbers' ||
      name === 'libreoffice calc' ||
      name === 'google sheets'
    ) {
      return true;
    }
  }
  return false;
}

/** Whether a site is reachable under the held list. Empty list is the open
 *  web; otherwise the host itself or a parent of it must be held. */
export function siteReachable(host: string, use: Pick<ComputerUse, 'browserSites'>): boolean {
  if (use.browserSites.length === 0) return true;
  const cleaned = cleanSite(host);
  if (cleaned === null) return false;
  return use.browserSites.some(
    (held) => cleaned === held || cleaned.endsWith(`.${held}`),
  );
}

export const computerWords = {
  title: 'Computer use',
  note: 'Manage how Graphe uses other applications on your computer.',
  control: 'Control',
  lockedTitle: 'Locked use',
  lockedNote:
    'Let Graphe keep working while you step away. It never unlocks your Mac by itself: a locked Mac still needs you.',
  lockedLearn: 'Graphe works in the background where it can, pressing a named button without taking your mouse, and waits where it cannot. Nothing here installs an unlock plug-in, and locking the Mac pauses anything that needs the screen.',
  alwaysTitle: 'Always-allowed apps',
  alwaysEmpty: 'None yet',
  alwaysNote:
    'These skip the per-turn question. Passwords, keys, and anything the Guard refuses still refuses. This never switches a refusal off.',
  sitesTitle: 'Browser sites',
  sitesEmpty: 'The open web',
  sitesNote: 'Hold the driven browser to a few named sites. Empty means anywhere.',
  anyAppName: 'Any App',
  anyAppNote: 'Let Graphe control apps on your computer',
  anyAppOff: 'To work the computer, turn Any App on first.',
  browserName: 'Browser',
  browserNote: 'Let Graphe use its built-in browser for additional control',
  browserManage: 'Manage',
  excelName: 'Microsoft Excel',
  excelNote: 'Let Graphe work in Excel, with no add-in to install',
  excelOff: 'To work in Excel, turn the Excel row on first.',
  install: 'Install',
  enable: 'Enable',
  remove: 'Remove',
  add: 'Add',
  appHint: 'App name, as it appears on this Mac',
  siteHint: 'Site, such as figma.com',
} as const;
