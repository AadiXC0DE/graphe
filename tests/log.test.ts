/** The log file: what reaches the disk, and what must never.
 *
 * Two promises are worth a test each. A key pasted into a prompt, an error
 * carrying an Authorization header, a private key in a diff — none of them
 * belong in a file somebody is about to email to a stranger. And a log that
 * throws is worse than no log, so an unwritable folder has to be silent.
 */

import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { LOG_BYTES, LOG_FILES, maskedLine, openLog, rotate } from '../electron/log';

function folder(): string {
  return mkdtempSync(join(tmpdir(), 'graphe-log-'));
}

describe('one line', () => {
  it('carries when, how loud and what', () => {
    const line = maskedLine('warn', 'the helper stopped early', Date.parse('2026-09-02T10:00:00Z'));
    expect(line).toContain('2026-09-02T10:00:00.000Z');
    expect(line).toContain('warn');
    expect(line).toContain('the helper stopped early');
  });

  it('stays one line however many the message had', () => {
    const line = maskedLine('error', 'first\nsecond\nthird', 0);
    expect(line).not.toContain('\n');
    expect(line).toContain('first');
    expect(line).toContain('third');
  });

  it('says the extra details beside the message', () => {
    const line = maskedLine('info', 'run finished', 0, { project: 'graphe', seconds: 12 });
    expect(line).toContain('project=graphe');
    expect(line).toContain('seconds=12');
  });
});

describe('what never reaches the disk', () => {
  const secrets: readonly [string, string][] = [
    ['a sign-in key', 'sk-abcdefghijklmnopqrstuvwxyz012345'],
    ['a code hosting key', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
    ['a storage key', 'AKIAIOSFODNN7EXAMPLE'],
    ['a sign-in ticket', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'],
  ];

  for (const [what, value] of secrets) {
    it(`hides ${what}`, () => {
      const line = maskedLine('error', `the call failed with ${value}`, 0);
      expect(line).not.toContain(value);
      expect(line).toContain('hidden');
    });
  }

  it('hides a value spelled out beside its name, and keeps the name', () => {
    const line = maskedLine('info', 'read OPENAI_API_KEY=hunter2hunter2hunter2 from the file', 0);
    expect(line).not.toContain('hunter2hunter2hunter2');
    expect(line).toContain('API_KEY');
  });

  it('hides a private key even though it runs over several lines', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEow\nkey\n-----END RSA PRIVATE KEY-----';
    const line = maskedLine('error', `could not read ${key}`, 0);
    expect(line).not.toContain('MIIEow');
    expect(line).toContain('private key hidden');
  });

  it('hides a secret hiding in the details as well as the message', () => {
    const line = maskedLine('warn', 'connect failed', 0, {
      header: 'Bearer sk-abcdefghijklmnopqrstuvwxyz012345',
    });
    expect(line).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
  });

  it('leaves an ordinary line alone', () => {
    const line = maskedLine('info', 'opened /Users/someone/Projects/site', 0);
    expect(line).toContain('/Users/someone/Projects/site');
    expect(line).not.toContain('hidden');
  });
});

describe('rotation', () => {
  it('rolls when the file being written is full', () => {
    const { roll } = rotate([{ name: 'graphe.log', bytes: LOG_BYTES }], {
      keep: LOG_FILES,
      bytes: LOG_BYTES,
    });
    expect(roll).toBe(true);
  });

  it('does not roll while there is room', () => {
    const { roll, drop } = rotate([{ name: 'graphe.log', bytes: 10 }], {
      keep: LOG_FILES,
      bytes: LOG_BYTES,
    });
    expect(roll).toBe(false);
    expect(drop).toEqual([]);
  });

  it('drops the oldest so five is still five after the roll', () => {
    const files = ['graphe.log', 'graphe.1.log', 'graphe.2.log', 'graphe.3.log', 'graphe.4.log'].map(
      (name) => ({ name, bytes: LOG_BYTES }),
    );
    const { roll, drop } = rotate(files, { keep: LOG_FILES, bytes: LOG_BYTES });
    expect(roll).toBe(true);
    expect(drop).toEqual(['graphe.4.log']);
  });

  it('never drops the file it is writing to', () => {
    const { drop } = rotate([{ name: 'graphe.log', bytes: LOG_BYTES }], { keep: 1, bytes: LOG_BYTES });
    expect(drop).toEqual([]);
  });
});

describe('writing', () => {
  it('puts the lines in the folder it was given', () => {
    const dir = folder();
    const log = openLog(dir);
    log.line('info', 'started');
    log.line('warn', 'something slowed down');
    const text = readFileSync(join(dir, 'graphe.log'), 'utf8');
    expect(text).toContain('started');
    expect(text).toContain('something slowed down');
    expect(text.trimEnd().split('\n')).toHaveLength(2);
    log.close();
  });

  it('reads back the last lines, newest last', () => {
    const log = openLog(folder());
    for (let n = 0; n < 10; n += 1) log.line('debug', `line ${String(n)}`);
    const last = log.recent(3);
    expect(last).toHaveLength(3);
    expect(last[2]).toContain('line 9');
    expect(last[0]).toContain('line 7');
    log.close();
  });

  it('writes nothing more once it is closed', () => {
    const dir = folder();
    const log = openLog(dir);
    log.line('info', 'before');
    log.close();
    log.line('info', 'after');
    const text = readFileSync(join(dir, 'graphe.log'), 'utf8');
    expect(text).toContain('before');
    expect(text).not.toContain('after');
  });

  it('does not throw when the folder cannot be made', () => {
    const dir = folder();
    const inTheWay = join(dir, 'logs');
    writeFileSync(inTheWay, 'not a folder');
    const log = openLog(inTheWay);
    expect(() => {
      log.line('error', 'and still nothing thrown');
    }).not.toThrow();
    // The line is still readable from this run even though the disk refused it.
    expect(log.recent(1)[0]).toContain('and still nothing thrown');
    log.close();
  });
});
