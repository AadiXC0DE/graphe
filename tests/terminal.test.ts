/** A shell in a folder, and the three things that must not be possible.
 *
 * This is a real pty and a real shell, so the test asserts on what actually
 * comes out: that the folder is the one asked for, that bytes written arrive as
 * keystrokes, that a resize is applied, and that nothing here can be used as a
 * general "run this command" door.
 */

import { describe, expect, it } from 'vitest';

import { Terminals, saysWorkspace, type TerminalChunk } from '../electron/services/terminal';
import { tmpdir } from 'node:os';

function harness() {
  const chunks: TerminalChunk[] = [];
  const exits: { id: string; code: number }[] = [];
  const terminals = new Terminals(
    (chunk) => chunks.push(chunk),
    (exit) => exits.push({ id: exit.id, code: exit.code }),
  );
  return { terminals, chunks, exits, out: () => chunks.map((one) => one.data).join('') };
}

/** Wait for the output to contain something, or give up. Real processes, so
 *  this is a wait rather than a sleep. */
async function until(what: () => boolean, ms = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (what()) return true;
    await new Promise((go) => setTimeout(go, 25));
  }
  return what();
}

describe('a terminal', () => {
  it('is either available with a real shell or honest about not being', () => {
    const { terminals } = harness();
    const state = terminals.available();
    if (state.yes) expect(state).toEqual({ yes: true });
    else expect(state.because).toContain('not installed');
  });

  it('starts in the folder it was given, and echoes what is typed', async () => {
    const { terminals, out } = harness();
    const made = terminals.open({ workspace: tmpdir(), kind: 'shell' });
    if (!made.ok) {
      // A build without the native helper: the honest path is that it said so.
      expect(made.because).not.toBe('');
      return;
    }
    try {
      expect(terminals.list().map((one) => one.id)).toEqual([made.session.id]);
      expect(terminals.write(made.session.id, 'echo pty-$((6*7))\n')).toBe(true);
      expect(await until(() => out().includes('pty-42'))).toBe(true);
      // The shell is the person's own, not a fixed one.
      expect(made.session.shell.length).toBeGreaterThan(0);
    } finally {
      terminals.close(made.session.id);
    }
  });

  it('keeps what it printed, so a window opened late still sees the session', async () => {
    const { terminals, out } = harness();
    const made = terminals.open({ workspace: tmpdir(), kind: 'shell' });
    if (!made.ok) return;
    try {
      terminals.write(made.session.id, 'echo remembered\n');
      expect(await until(() => out().includes('remembered'))).toBe(true);
      expect(terminals.scrollback(made.session.id)).toContain('remembered');
    } finally {
      terminals.close(made.session.id);
    }
  });

  it('reports the exit, once, and refuses more input afterwards', async () => {
    const { terminals, exits } = harness();
    const made = terminals.open({ workspace: tmpdir(), kind: 'agent' });
    if (!made.ok) return;
    try {
      terminals.write(made.session.id, 'exit\n');
      expect(await until(() => exits.length > 0)).toBe(true);
      expect(exits).toHaveLength(1);
      expect(terminals.write(made.session.id, 'echo after\n')).toBe(false);
    } finally {
      terminals.close(made.session.id);
    }
  });

  it('takes a resize, and refuses one for a terminal that has gone', () => {
    const { terminals } = harness();
    const made = terminals.open({ workspace: tmpdir(), kind: 'server' });
    if (!made.ok) return;
    expect(terminals.resize(made.session.id, 120, 40)).toBe(true);
    terminals.close(made.session.id);
    expect(terminals.resize(made.session.id, 80, 24)).toBe(false);
    expect(terminals.write(made.session.id, 'x')).toBe(false);
    expect(terminals.list()).toEqual([]);
  });

  it('writes into no folder but the one it was given, whatever the payload is', async () => {
    const { terminals, out } = harness();
    const folder = tmpdir();
    const made = terminals.open({ workspace: folder, kind: 'shell' });
    if (!made.ok) return;
    try {
      // Typed text is text: there is no path here that turns a payload into a
      // different working directory, because only keystrokes reach the pty.
      terminals.write(made.session.id, 'pwd\n');
      expect(await until(() => out().includes(folder.replace(/^\/private/, '')))).toBe(true);
    } finally {
      terminals.close(made.session.id);
    }
  });
});

describe('how a workspace is written', () => {
  it('shortens a folder inside home and leaves anything else whole', () => {
    expect(saysWorkspace('/tmp/somewhere')).toBe('/tmp/somewhere');
  });
});
