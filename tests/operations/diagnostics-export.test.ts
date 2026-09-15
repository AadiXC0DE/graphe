/** The bundle somebody pastes into a message, and what it must never carry.
 *
 * 9.5 asks that a diagnostics export redacts secrets, bounds its output and
 * describes its contents accurately. `tests/diagnostics.test.ts` already proves
 * the sections, the line count it asks the log for, the `sk-…` case and the
 * closing sentence; what is here is the claim that sentence rests on — that the
 * disk section counts files rather than reading them — plus the two ways a
 * secret gets into a bundle: a private key block in the why-stopped sentence,
 * and a line that is longer than a bound that only counts lines.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { folderSizes, gather, LOG_LINES, saysDiagnostics, type Gathering } from '../../electron/diagnostics';

const folders: string[] = [];

afterAll(() => {
  for (const folder of folders) rmSync(folder, { recursive: true, force: true });
});

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-ops-diagnostics-'));
  folders.push(dir);
  return dir;
}

function asked(over: Partial<Gathering> = {}): Gathering {
  return {
    version: '0.9.0',
    userData: scratch(),
    versions: { electron: '43.4.1', node: '22.20.2', chromium: '140.0.0.0' },
    extensions: [],
    whyStopped: '',
    recent: () => [],
    now: 1,
    ...over,
  };
}

const PRIVATE_KEY = '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmU\n-----END OPENSSH PRIVATE KEY-----';

/* ========================================================================== */

describe('what the disk section is', () => {
  it('counts what is in a folder without reading any of it', async () => {
    const userData = scratch();
    mkdirSync(join(userData, 'logs'), { recursive: true });
    writeFileSync(join(userData, 'logs', 'main.log'), 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345', 'utf8');
    writeFileSync(join(userData, 'recents.json'), '{"token":"ghp_abcdefghijklmnopqrst"}', 'utf8');

    const said = saysDiagnostics(await gather(asked({ userData })));

    expect(said).toContain('logs: 50 B');
    expect(said).toContain('recents.json: 36 B');
    // The names of the folders and how much they hold. Nothing here opened a
    // file, so nothing in one can reach the bundle.
    expect(said).not.toContain('sk-abcdefghijklmnopqrstuvwxyz012345');
    expect(said).not.toContain('ghp_abcdefghijklmnopqrst');
  });

  it('is an empty list, rather than an error, when the folder is not there', async () => {
    expect(await folderSizes(join(scratch(), 'never-existed'))).toEqual([]);
  });
});

describe('a secret on its way into the bundle', () => {
  it('takes a whole private key out of the why-stopped sentence', async () => {
    const said = saysDiagnostics(await gather(asked({ whyStopped: `It stopped here:\n${PRIVATE_KEY}` })));

    expect(said).not.toContain('BEGIN OPENSSH PRIVATE KEY');
    expect(said).not.toContain('b3BlbnNzaC1rZXktdjEAAAAABG5vbmU');
    expect(said).toContain('private key hidden');
  });

  it('leaves the sentence itself readable, so it is worth pasting', async () => {
    const said = saysDiagnostics(await gather(asked({ whyStopped: 'The server closed the door.' })));
    expect(said).toContain('The server closed the door.');
  });

  /* The bound is a count of lines (LOG_LINES); a line's own length is whatever
     the sink wrote, and the sink's cap is the size of the file (electron/log.ts,
     2 MiB). One enormous line is cut at the export's own per-line bound, and the
     cut says so rather than passing the line off as whole. */
  it('bounds what one log line can carry', async () => {
    const enormous = `a line that got away: ${'x'.repeat(200_000)}`;
    const said = saysDiagnostics(await gather(asked({ recent: () => [enormous] })));

    expect(said.length).toBeLessThan(50_000);
    // The beginning is still there, and the bundle says a line was cut rather
    // than passing it off as whole.
    expect(said).toContain('a line that got away:');
    expect(said).toContain('(cut at');
  });

  it('asks for no more than the log it is willing to carry', async () => {
    let asked_for = -1;
    await gather(
      asked({
        recent: (n) => {
          asked_for = n;
          return [];
        },
      }),
    );
    expect(asked_for).toBe(LOG_LINES);
  });
});
