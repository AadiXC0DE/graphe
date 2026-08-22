/** The other half of a sitting's memory.
 *
 * A sitting already begins by carrying its notes in. Nothing ever wrote any
 * out, so the memory only ever held what somebody thought to ask for — and the
 * sittings that learn the most are the unattended ones, where nobody is there
 * to ask.
 *
 * A method nobody calls is a passing test suite and a feature that does not
 * exist, so most of this is about the join: that the sitting is asked before
 * the session goes, and before the copy it learned from is taken away.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const adapter = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

describe('the sitting is asked before it goes', () => {
  it('offers it at all', () => {
    expect(adapter).toContain('settleUp(): Promise<boolean>');
    expect(adapter).toContain('async settleUp()');
  });

  it('is asked by background work, before the copy is taken away', () => {
    // The unattended run is the one whose notes are otherwise lost entirely.
    expect(shell).toContain('await session.settleUp()');
    const at = shell.indexOf('await session.settleUp()');
    const disposed = shell.indexOf('session?.dispose()', at);
    expect(at).toBeGreaterThan(-1);
    expect(disposed).toBeGreaterThan(at);
  });

  it('is asked when somebody closes a conversation themselves', () => {
    expect(shell).toContain('found.held.settleUp()');
  });

  it('never lets a failed note-writing take the close down with it', () => {
    expect(shell).toContain('settleUp().catch(() => false)');
  });
});

describe('what it does and does not cost', () => {
  it('happens at most once, and only after a sitting that did something', () => {
    expect(adapter).toContain('if (closed || settledUp || memory === null || !didSomething) return false;');
  });

  it('says nothing to a window whose person has already left', () => {
    expect(adapter).toContain('unwatched = true');
    expect(adapter).toMatch(/if \(unwatched\) \{[\s\S]{0,200}?return;/);
  });

  it('never hides what it spent, whoever asked for the turn', () => {
    const at = adapter.indexOf('if (unwatched) {');
    expect(adapter.slice(at, at + 240)).toContain("event.type === 'spend'");
  });
});

describe('what it asks for', () => {
  /** A memory full of "the work went well" is worse than an empty one. */
  it('asks for facts that save time, not for impressions', () => {
    const at = adapter.indexOf('const WORTH_KEEPING');
    const asked = adapter.slice(at, at + 1200).toLowerCase();
    expect(asked).toContain('retain');
    expect(asked).toContain('one fact per note');
    expect(asked).toContain('nothing about how this sitting went');
    // None is a real answer, and saying so is what keeps the store worth reading.
    expect(asked).toMatch(/none|nothing/);
  });
});

describe('how often the conversation has been shortened', () => {
  it('is counted from the same event the window is told about', () => {
    expect(adapter).toContain("if (event.type === 'tidied' && event.ok) shortened += 1;");
  });

  it('travels with the rest of the reading', () => {
    expect(adapter).toContain('shortened,');
    expect(adapter).toContain('shortened: number;');
  });
});
