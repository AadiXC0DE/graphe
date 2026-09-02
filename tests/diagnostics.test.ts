/** The bundle behind Help → Copy diagnostics.
 *
 * It exists to be pasted into a message to a stranger, so the two things worth
 * testing are that everything needed to read a failure is in it — version,
 * machine, add-ons, disk, why the last run stopped, the last lines — and that
 * nothing private is.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import type { CapabilityCard } from '../src/agent/pi/extension-probe';
import { folderSizes, gather, LOG_LINES, saysDiagnostics, type Gathering } from '../electron/diagnostics';

const folders: string[] = [];
function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), 'graphe-diagnostics-'));
  folders.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of folders) rmSync(dir, { recursive: true, force: true });
});

const CARD: CapabilityCard = {
  id: 'pi-subagents',
  hooks: ['agent_end'],
  tools: ['subagent'],
  commands: [],
  startsTurns: true,
  rewritesSystemPrompt: false,
  runsBackgroundWork: true,
  toolPromptBytes: 4096,
  orchestrating: true,
};

function asked(over: Partial<Gathering> = {}): Gathering {
  return {
    version: '0.9.0',
    userData: scratch(),
    versions: { electron: '43.4.1', node: '22.21.1', chromium: '130.0.0' },
    extensions: [CARD],
    whyStopped: 'The run ended because the model stopped answering.',
    recent: () => ['first line', 'second line'],
    now: Date.UTC(2026, 8, 2, 10, 0, 0),
    ...over,
  };
}

describe('what is on disk', () => {
  it('adds up each folder and puts the biggest first', async () => {
    const userData = scratch();
    mkdirSync(join(userData, 'sessions', 'one'), { recursive: true });
    mkdirSync(join(userData, 'worktrees'), { recursive: true });
    writeFileSync(join(userData, 'sessions', 'one', 'a.json'), 'x'.repeat(500));
    writeFileSync(join(userData, 'sessions', 'b.json'), 'x'.repeat(400));
    writeFileSync(join(userData, 'worktrees', 'c.json'), 'x'.repeat(100));
    writeFileSync(join(userData, 'preferences.json'), 'x'.repeat(50));

    const sizes = await folderSizes(userData);
    expect(sizes[0]).toEqual({ name: 'sessions', bytes: 900 });
    expect(sizes.find((one) => one.name === 'worktrees')?.bytes).toBe(100);
    expect(sizes.find((one) => one.name === 'preferences.json')?.bytes).toBe(50);
  });

  it('answers nothing rather than failing on a folder that is not there', async () => {
    await expect(folderSizes(join(scratch(), 'never-made'))).resolves.toEqual([]);
  });
});

describe('gathering', () => {
  it('keeps what it was handed', async () => {
    const d = await gather(asked());
    expect(d.version).toBe('0.9.0');
    expect(d.versions.electron).toBe('43.4.1');
    expect(d.extensions).toEqual([CARD]);
    expect(d.log).toEqual(['first line', 'second line']);
    expect(d.at).toBe(Date.UTC(2026, 8, 2, 10, 0, 0));
  });

  it('names the machine and works out the caps', async () => {
    const d = await gather(asked());
    expect(d.os).toContain(process.platform);
    expect(d.caps.helpers).toBeGreaterThanOrEqual(2);
    expect(d.caps.board).toBe(4);
  });

  it('asks the log for two hundred lines and no more', async () => {
    let wanted = 0;
    await gather(
      asked({
        recent: (n) => {
          wanted = n;
          return [];
        },
      }),
    );
    expect(wanted).toBe(LOG_LINES);
    expect(LOG_LINES).toBe(200);
  });
});

describe('the text somebody pastes', () => {
  it('carries everything needed to read a failure', async () => {
    const userData = scratch();
    mkdirSync(join(userData, 'sessions'), { recursive: true });
    writeFileSync(join(userData, 'sessions', 'a.json'), 'x'.repeat(2048));

    const said = saysDiagnostics(await gather(asked({ userData })));

    expect(said).toContain('Graphe 0.9.0');
    expect(said).toContain('Electron 43.4.1');
    expect(said).toContain('Node 22.21.1');
    expect(said).toContain('Chromium 130.0.0');
    expect(said).toContain('helpers');
    expect(said).toContain('pi-subagents');
    expect(said).toContain('starts turns on its own');
    expect(said).toContain('sessions');
    expect(said).toContain('2.0 KB');
    expect(said).toContain('The run ended because the model stopped answering.');
    expect(said).toContain('first line');
  });

  it('says so where there is nothing to say', async () => {
    const said = saysDiagnostics(
      await gather(asked({ extensions: [], whyStopped: '', recent: () => [] })),
    );
    expect(said).toContain('none installed');
    expect(said).toContain('not recorded');
    expect(said).toContain('nothing written yet');
  });

  it('never carries a key, even one that came in a sentence', async () => {
    const said = saysDiagnostics(
      await gather(
        asked({ whyStopped: 'The provider refused sk-abcdefghijklmnopqrstuvwxyz012345.' }),
      ),
    );
    expect(said).not.toContain('sk-abcdefghijklmnopqrstuvwxyz');
    expect(said).toContain('hidden');
  });

  it('promises what it does not contain', async () => {
    const said = saysDiagnostics(await gather(asked()));
    expect(said).toContain('No conversations, files or keys are in this.');
  });
});
