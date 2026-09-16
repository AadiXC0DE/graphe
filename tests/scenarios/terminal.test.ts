/** T42, T43: a shell in a folder — what goes in and out, and what closing one
 *  does.
 *
 * T42's subjects are the shapes of input that a terminal handles badly if it
 * treats bytes as text or text as commands: characters outside ASCII, a
 * multi-line paste, a resize, and an escape sequence somebody printed. T43 is
 * the other end: closing one, and the retention that makes a window opened late
 * still see the session.
 *
 * A real pty and the person's own login shell, exactly as
 * `tests/terminal.test.ts` runs it. The helper is a native module that is not
 * installed in every build; where it is missing these tests step aside and the
 * availability itself is asserted, once, in `tests/terminal.test.ts`
 * (`is either available with a real shell or honest about not being`).
 */

import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { Terminals, saysWorkspace, type TerminalChunk } from '../../electron/services/terminal';

const made: string[] = [];

afterEach(async () => {
  for (const one of made.splice(0)) await rm(one, { recursive: true, force: true });
});

async function workspace(): Promise<string> {
  const folder = await realpath(await mkdtemp(join(tmpdir(), 'graphe-scenario-term-')));
  made.push(folder);
  return folder;
}

function terminalIn(): { terminals: Terminals; chunks: TerminalChunk[]; out: () => string } {
  const chunks: TerminalChunk[] = [];
  const terminals = new Terminals(
    (chunk) => chunks.push(chunk),
    () => undefined,
  );
  return { terminals, chunks, out: () => chunks.map((one) => one.data).join('') };
}

/** Wait for the terminal to have printed something, or give up.
 *
 *  A real shell in a real pty: there is no clock to fake here, because what is
 *  being waited for is another process doing work. Twenty milliseconds of
 *  polling is the price of asserting on the bytes a shell actually wrote. */
async function until(what: () => boolean, ms = 8000): Promise<boolean> {
  const started = Date.now();
  while (Date.now() - started < ms) {
    if (what()) return true;
    await new Promise((wake) => setTimeout(wake, 20));
  }
  return what();
}

/** The shell is only present when the build ships the helper and the execute
 *  bit survived installation. */
function needsPty(terminals: Terminals): boolean {
  return terminals.available().yes;
}

/* -------------------------------------------------------------------------- */

describe('T42: what a person types and what the shell prints', () => {
  it('carries characters outside ASCII through in both directions, whole', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;

    const said = 'héllo 世界 🎉 ünïcode';
    app.terminals.write(opened.session.id, `printf '%s\\n' '${said}'\n`);
    expect(await until(() => app.out().includes(said))).toBe(true);
    // What came back is the text itself, not escaped or replaced by boxes.
    expect(app.out()).toContain('héllo 世界 🎉 ünïcode');
    expect(app.out()).not.toContain('\\u');
  });

  it('passes a bracketed paste through byte for byte, in one payload', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;

    app.terminals.write(opened.session.id, `printf '%s\\n' 'READY'\n`);
    expect(await until(() => app.out().includes('READY'))).toBe(true);

    // What a bracketed paste looks like on the wire: the markers the terminal
    // emits around the payload, with the payload's own line breaks inside them.
    // Sent in one write, as the window sends a paste.
    const before = app.out().length;
    app.terminals.write(
      opened.session.id,
      '\u001b[200~first line\nsecond line\nthird line\u001b[201~',
    );
    expect(await until(() => app.out().length > before)).toBe(true);
    const echoed = app.out().slice(before);

    // The payload came through as bytes, in order, and the shell is the thing
    // that drew it. How a shell echoes the `ESC [ 200 ~` markers around a paste
    // is its own business (this one drops the leading `ESC [` entirely), so the
    // assertion is on what is actually observable: the three lines, in the
    // order they were pasted, with nothing of this service having parsed the
    // sequence - `write` takes keystrokes and there is no call on it that takes
    // a command. Byte-level pass-through is asserted directly in
    // tests/terminal.test.ts, where the shell's echo is not in the way.
    expect(echoed.indexOf('first line')).toBeLessThan(echoed.indexOf('second line'));
    expect(echoed.indexOf('second line')).toBeLessThan(echoed.indexOf('third line'));

    // And the shell is still usable afterwards, which is what "one payload"
    // means for the person: the paste left the terminal where it found it.
    app.terminals.write(opened.session.id, `printf '%s\\n' 'STILL-HERE'\n`);
    expect(await until(() => app.out().includes('STILL-HERE'))).toBe(true);
  });

  it('takes a resize, clamps a nonsense one, and still works afterwards', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;

    expect(app.terminals.resize(opened.session.id, 100, 40)).toBe(true);
    // A window zoomed to something no pty has: the size is clamped rather than
    // refused, and the shell is not left in a state a later write cannot reach.
    expect(app.terminals.resize(opened.session.id, 10_000, 0)).toBe(true);
    app.terminals.write(opened.session.id, `printf '%s\\n' 'STILL-ALIVE'\n`);
    expect(await until(() => app.out().includes('STILL-ALIVE'))).toBe(true);
  });

  it('puts a printed escape sequence in the stream as data rather than acting on it', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;

    // A screen-clear and a clipboard request, printed by whatever is running in
    // the shell. The marker is built by the shell so the echo of the command
    // line cannot be mistaken for the program's own output.
    app.terminals.write(
      opened.session.id,
      "printf '\\033[2J\\033]52;c;cGF5bG9hZA==\\007'; printf 'PRINTED-%s\\n' \"$(printf 42)\"\n",
    );
    expect(await until(() => app.out().includes('PRINTED-42'))).toBe(true);

    // The bytes the program printed are in the stream, unaltered: the service
    // neither runs them nor strips them, and whether anything acts on them is
    // the window's decision rather than this one's.
    expect(app.out()).toContain('\u001b[2J');
    expect(app.out()).toContain('\u001b]52;c;');

    // The only way anything reaches the pty is a terminal this app started, and
    // a screen-clear printed by a program does not change that.
    expect(app.terminals.write('a-terminal-nobody-started', 'ls\n')).toBe(false);
    expect(app.terminals.scrollback('a-terminal-nobody-started')).toBe('');
    expect(app.terminals.list().map((one) => one.id)).toEqual([opened.session.id]);
  });
});

/* -------------------------------------------------------------------------- */

describe('T43: closing a terminal, and what it kept', () => {
  it('ends the shell and forgets it, so nothing can write to it afterwards', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;
    app.terminals.write(opened.session.id, `printf '%s\\n' 'BEFORE-CLOSE'\n`);
    expect(await until(() => app.out().includes('BEFORE-CLOSE'))).toBe(true);
    const held = app.terminals.scrollback(opened.session.id);
    expect(held).toContain('BEFORE-CLOSE');

    expect(app.terminals.close(opened.session.id)).toBe(true);
    expect(app.terminals.list()).toEqual([]);
    expect(app.terminals.write(opened.session.id, 'echo still there\n')).toBe(false);
    expect(app.terminals.scrollback(opened.session.id)).toBe('');
    // Closing one that is already gone is not an error worth showing anybody.
    expect(app.terminals.close(opened.session.id)).toBe(false);
  });

  it('ends every terminal this app started, so nothing is left holding the folder', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const first = await workspace();
    const second = await workspace();
    const one = app.terminals.open({ workspace: first, kind: 'shell' });
    const two = app.terminals.open({ workspace: second, kind: 'server' });
    if (!one.ok || !two.ok) return;
    expect(app.terminals.list().map((held) => held.id).sort()).toEqual(['term-1', 'term-2']);

    app.terminals.closeAll();

    expect(app.terminals.list()).toEqual([]);
    expect(app.terminals.write(one.session.id, 'echo hi\n')).toBe(false);
    expect(app.terminals.write(two.session.id, 'echo hi\n')).toBe(false);
  });

  it('keeps what it printed up to a bound, so a window opened late can still be read', async () => {
    const app = terminalIn();
    if (!needsPty(app.terminals)) return;
    const folder = await workspace();
    const opened = app.terminals.open({ workspace: folder, kind: 'shell' });
    if (!opened.ok) return;

    // More output than the retention allows. The bound is on what is kept, not
    // on what is drawn: an unbounded scrollback is a leak with a person's
    // session inside it. Piped rather than expanded, so no argument list has to
    // hold six hundred kilobytes.
    app.terminals.write(
      opened.session.id,
      "head -c 600000 /dev/zero | tr '\\0' x; printf 'END-OF-THE-BIG-ONE\\n'\n",
    );
    expect(await until(() => app.out().includes('END-OF-THE-BIG-ONE'), 20_000)).toBe(true);
    expect(await until(() => app.terminals.scrollback(opened.session.id).length > 100_000, 20_000)).toBe(true);

    const kept = app.terminals.scrollback(opened.session.id);
    // The bound the terminal keeps: 512 KB, oldest dropped first. What survives
    // is the end of the session, which is what somebody opening the window late
    // is looking for.
    expect(kept.length).toBeLessThanOrEqual(512 * 1024);
    expect(kept.length).toBeGreaterThan(100_000);
    expect(kept.endsWith('x')).toBe(true);
  });

  it('names the folder the way a person reads it', () => {
    expect(saysWorkspace(join(process.env['HOME'] ?? '/', 'work', 'site'))).toBe('~/work/site');
    expect(saysWorkspace('/elsewhere/site')).toBe('/elsewhere/site');
  });
});
