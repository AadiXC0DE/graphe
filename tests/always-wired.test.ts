/** Things a project always does, wired end to end.
 *
 *  The pure half is tested next door. This is the tripwire: the three moments
 *  really are hung on, only what the Guard allows outright ever runs, and the
 *  file being unreadable is said out loud rather than silently running none.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const ADAPTER = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
const COMPOSER = readFileSync(new URL('../src/components/Composer.tsx', import.meta.url), 'utf8');
const SETTINGS = readFileSync(new URL('../src/components/Settings.tsx', import.meta.url), 'utf8');

describe('what runs without being asked', () => {
  it('is read once when the sitting opens, beside the project’s rules', () => {
    expect(ADAPTER).toContain('alwaysFrom(');
    expect(ADAPTER).toContain('alwaysFile(options.projectRoot');
  });

  it('runs at each of the three moments', () => {
    expect(ADAPTER).toContain("runAlways('afterEachChange', touched)");
    expect(ADAPTER).toContain("runAlways('whenItFinishes', [])");
    expect(ADAPTER).toContain("runAlways('whenItOpens', [])");
  });

  /** Nobody is there to be asked, so only what would not have been asked
   *  about may run. */
  it('runs only what the Guard allows outright', () => {
    const at = ADAPTER.indexOf('async function runAlways');
    expect(at).toBeGreaterThan(-1);
    const block = ADAPTER.slice(at, at + 1600);
    expect(block).toContain("name: 'bash'");
    expect(block).toContain("allowed.kind !== 'allow'");
    expect(block).toContain('ALWAYS_WORDS.refused(one.name)');
  });

  it('says once when the file itself will not read', () => {
    expect(ADAPTER).toContain('always.trouble === null ? [] : [always.trouble]');
  });

  it('lets the window read them, fresh each time', () => {
    const at = MAIN.indexOf('handle<AlwaysDoes>(CHANNEL.alwaysDoes');
    expect(at).toBeGreaterThan(-1);
    const block = MAIN.slice(at, at + 900);
    expect(block).toContain('alwaysFrom(await readFile(file');
    expect(SETTINGS).toContain("onGo('always')");
  });
});

describe('a way of working, offered as it is typed', () => {
  it('offers them on a slash at the start of a message, and only there', () => {
    expect(COMPOSER).toContain("before.match(/^\\/([a-z0-9-]*)$/i)");
    expect(COMPOSER).toContain('chooseCommand');
    expect(COMPOSER).toContain('aria-label="Ways of working"');
  });
});
