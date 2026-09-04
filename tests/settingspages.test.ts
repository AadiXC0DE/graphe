/** Settings as pages you can search.
 *
 * The point of the model is that nobody has to know which page a preference is
 * on: typing "dark", "api key" or "cookies" finds it wherever it lives. So most
 * of what is checked here is that search actually answers the words a person
 * would use — and that every row is reachable, named once, and lands on a page
 * that draws it.
 */

import { describe, expect, it } from 'vitest';

import { matches } from '../src/lib/commands';
import {
  PAGES,
  ROWS,
  pageFor,
  pageWords,
  rowAt,
  rowsOn,
  search,
  settingsCommands,
  settingsWords,
  type Page,
} from '../src/work/settingspages';

describe('the pages', () => {
  it('are the ten the app is split into', () => {
    expect(PAGES).toEqual([
      'appearance',
      'behaviour',
      'notifications',
      'keys',
      'models',
      'add-ons',
      'storage',
      'computer',
      'privacy',
      'advanced',
    ]);
  });

  it('all have something on them', () => {
    for (const page of PAGES) expect(rowsOn(page).length).toBeGreaterThan(0);
  });

  it('all say what they are for', () => {
    for (const page of PAGES) {
      expect(pageWords[page].name.length).toBeGreaterThan(2);
      expect(pageWords[page].note.length).toBeGreaterThan(20);
    }
  });

  it('account for every row between them', () => {
    const counted = PAGES.reduce((sum, page) => sum + rowsOn(page).length, 0);
    expect(counted).toBe(ROWS.length);
  });
});

describe('the rows', () => {
  it('are each named once', () => {
    expect(new Set(ROWS.map((one) => one.id)).size).toBe(ROWS.length);
    expect(new Set(ROWS.map((one) => one.name)).size).toBe(ROWS.length);
  });

  it('all say what they do, without saying their own name again', () => {
    for (const row of ROWS) {
      expect(row.note.length).toBeGreaterThan(20);
      expect(row.note.toLowerCase().startsWith(row.name.toLowerCase())).toBe(false);
    }
  });

  it('are found by id', () => {
    expect(rowAt('theme')?.page).toBe('appearance');
    expect(rowAt('nothing-like-this')).toBeNull();
  });

  it('keep what the sheet has today', () => {
    for (const id of [
      'theme',
      'show-me',
      'files',
      'hold-back',
      'keep-logins',
      'always',
      'folder',
      'editor',
      'diagnostics',
      'storage',
      'skills',
      'connected',
      'add-more',
      'usage',
      'computer-any-app',
      'computer-browser',
      'computer-excel',
      'computer-locked',
      'computer-allowed',
      'computer-sites',
    ]) {
      expect(rowAt(id), id).not.toBeNull();
    }
  });

  it('files computer use on its own page, found by the words people use', () => {
    for (const id of [
      'computer-any-app',
      'computer-browser',
      'computer-excel',
      'computer-locked',
      'computer-allowed',
      'computer-sites',
    ]) {
      expect(rowAt(id)?.page, id).toBe('computer');
    }
    expect(search('excel')[0]?.id).toBe('computer-excel');
    expect(pageFor('excel')).toBe('computer');
    expect(search('allowlist')[0]?.page).toBe('computer');
  });

  /* There is no such file. Nothing in the app or in the agent it embeds reads
     ~/.pi/agent/settings.json, so a row promising the keys it honours would
     have been a row about nothing. */
  it('offers no settings file, because the app honours none', () => {
    expect(rowAt('settings-file')).toBeNull();
    for (const row of ROWS) expect(row.note).not.toContain('settings.json');
  });

  it('puts the add-ons policy where the add-ons are', () => {
    expect(rowAt('addons')?.page).toBe('add-ons');
  });

  /* Whichever was found first was always the answer, and the row that used to
     be here only opened the project. */
  it('let somebody choose which editor and which terminal', () => {
    for (const id of ['editor', 'terminal']) {
      expect(rowAt(id)?.page, id).toBe('behaviour');
      expect(rowAt(id)?.kind, id).toBe('choice');
    }
    expect(rowAt('editor')?.name).toBe('Editor');
    expect(rowAt('terminal')?.name).toBe('Terminal');
  });

  /* Reached from the Advanced row rather than the sidebar, so it is a page with
     a name but not one the sidebar lists. */
  it('give the always list a page of its own, off the sidebar', () => {
    expect(pageWords.always.name).toBe('Always');
    expect(pageWords.always.note.length).toBeGreaterThan(20);
    expect(PAGES).not.toContain('always');
  });
});

describe('searching', () => {
  it('is every row when nothing is typed', () => {
    expect(search('')).toHaveLength(ROWS.length);
    expect(search('   ')).toHaveLength(ROWS.length);
  });

  it('finds a row by its name', () => {
    expect(search('skills')[0]?.id).toBe('skills');
    expect(search('diagnostics')[0]?.id).toBe('diagnostics');
  });

  it('finds a row by a word nobody put on it', () => {
    expect(search('dark')[0]?.id).toBe('theme');
    expect(search('api key')[0]?.id).toBe('accounts');
    expect(search('cookies')[0]?.id).toBe('keep-logins');
    expect(search('shortcut')[0]?.id).toBe('shortcuts');
    expect(search('mcp')[0]?.id).toBe('connected');
  });

  /* The whole point of one search for the sidebar and the palette: a name match
     has to beat a mention in somebody else's note. */
  it('puts the row it names above the row that merely mentions it', () => {
    const found = search('theme');
    expect(found[0]?.id).toBe('theme');
  });

  it('says nothing rather than everything for a word that is not here', () => {
    expect(search('kubernetes')).toEqual([]);
  });

  it('is the palette’s own ranking', () => {
    const ids = search('cost').map((one) => one.id);
    const same = matches(
      ROWS.map((row) => ({ id: row.id, name: row.name, run: (): void => undefined })),
      'cost',
    ).map((one) => one.id);
    expect(ids[0]).toBe(same[0]);
  });

  it('says which page to open for what was typed', () => {
    expect(pageFor('dark')).toBe('appearance');
    expect(pageFor('api key')).toBe('models');
    expect(pageFor('kubernetes')).toBeNull();
  });

  it('names the page a result came from', () => {
    expect(settingsWords.on('add-ons' as Page)).toBe('on Add-ons');
  });
});

describe('every preference has a keyboard path', () => {
  it('is in the palette, all of it', () => {
    const opened: string[] = [];
    const commands = settingsCommands((row) => opened.push(row.id));
    expect(commands).toHaveLength(ROWS.length);
    for (const command of commands) command.run();
    expect(opened).toEqual(ROWS.map((one) => one.id));
  });

  it('says which page each one is on, so the palette can band them', () => {
    for (const command of settingsCommands(() => undefined)) {
      expect(command.where).toContain(settingsWords.title);
    }
  });

  it('carries the chord where a row already has one', () => {
    const files = settingsCommands(() => undefined).find((one) => one.id === 'settings:files');
    expect(files?.keys).toBe('mod+shift+f');
  });

  it('never takes an id the palette already uses', () => {
    for (const command of settingsCommands(() => undefined)) {
      expect(command.id.startsWith('settings:')).toBe(true);
    }
  });
});
