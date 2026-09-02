/** The ways a press could end a run nobody asked to end.
 *
 * Reported twice: every helper dying the moment a panel was opened. It was not
 * the opening — it was the *leaving*. Escape is handled on the window, and that
 * listener is registered before any panel's, so pressing it to close Settings
 * stopped the turn first and closed the panel second. Every helper of that turn
 * was killed in the same frame.
 *
 * Two more of the same shape were found beside it: a fifth project evicting a
 * busy one, and trusting an extension rebuilding a conversation mid-run.
 *
 * Mostly the join rather than the arithmetic — a rule nobody can run is a rule
 * that quietly stops holding, and these three all held nothing.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { HELPER_PATIENCE_MS, HELPER_TOOK_TOO_LONG, whyEndHelper } from '../src/agent/pi/tools';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

import { escapeMeans } from '../src/lib/escape';
const shell = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

/** The one Escape handler, from the key to the end of the branch. */
const escape = (): string => {
  const at = app.indexOf('if (event.key === "Escape") {');
  expect(at).toBeGreaterThan(-1);
  return app.slice(at, at + 1200);
};

describe('Escape backs out of what is in front, before it stops anything', () => {
  /** Nothing up, nothing open, nothing running. */
  const quiet = {
    answeredAlready: false,
    connectOpen: false,
    connectBusy: false,
    switching: false,
    overlayUp: false,
    busy: false,
  };

  /* The order is the whole of it, and it is run rather than read: a press meant
     to close a panel that stops a job instead is the loudest way this app can
     misread somebody. */
  it('leaves the run alone while any panel is up', () => {
    expect(escapeMeans({ ...quiet, overlayUp: true, busy: true })).toBe('let-the-sheet-have-it');
  });

  it('stops the run only when Escape can mean nothing else', () => {
    expect(escapeMeans({ ...quiet, busy: true })).toBe('stop');
  });

  it('closes the connect sheet before anything else, and cancels it mid-flight', () => {
    expect(escapeMeans({ ...quiet, connectOpen: true, busy: true })).toBe('close-connect');
    expect(escapeMeans({ ...quiet, connectOpen: true, connectBusy: true, busy: true })).toBe(
      'cancel-connect',
    );
  });

  it('closes the switcher before it reaches a panel or the run', () => {
    expect(escapeMeans({ ...quiet, switching: true, overlayUp: true, busy: true })).toBe(
      'close-switcher',
    );
  });

  it('does nothing at all when there is nothing to back out of', () => {
    expect(escapeMeans(quiet)).toBe('nothing');
  });

  it('is what the window actually presses', () => {
    const branch = escape();
    expect(branch).toContain('escapeMeans({');
    expect(branch).toContain("case 'stop':");
    expect(branch).toContain('halt();');
  });

  it('counts every panel that can be in front', () => {
    const at = app.indexOf('const overlayUp = (): boolean =>');
    expect(at).toBeGreaterThan(-1);
    // Which sheets exist is a fact about this window and nowhere else, so this
    // half stays a reading of it. What Escape does about them is run, above.
    const list = app.slice(at, app.indexOf(';', at));
    for (const panel of [
      'settingsOpen',
      'usageOpen',
      'skillsOpen',
      'connectedOpen',
      'addMore',
      'paletteOpen',
      'graphOpen',
      'reviewsOpen',
      'helpersAt',
      'designAt',
    ]) {
      expect(list, panel).toContain(panel);
    }
  });

  it('stands aside for anything nearer the key that already answered', () => {
    // The composer's own mention menu answers Escape in React, which runs
    // before this listener. Without this, dismissing it stopped the run.
    expect(escapeMeans({ ...quiet, answeredAlready: true, busy: true })).toBe('nothing');
    // And the window really passes that on rather than deciding it itself.
    expect(escape()).toContain('answeredAlready: event.defaultPrevented');
  });

  it('still stops the run when nothing is in front of it', () => {
    expect(escapeMeans({ ...quiet, busy: true })).toBe('stop');
  });

  it('watches the panels it reads, or it would read them stale', () => {
    const at = app.indexOf('if (event.key === "Escape") {');
    const deps = app.slice(at, app.indexOf('  ]);', at));
    for (const panel of ['settingsOpen', 'usageOpen', 'addMore', 'graphOpen', 'designAt']) {
      expect(deps, panel).toContain(panel);
    }
  });
});

describe('a project with work going is not the one dropped off the end', () => {
  it('asks before evicting, the way conversations already did', () => {
    const at = shell.indexOf('const workspaces = new Workspaces<Held>({');
    expect(at).toBeGreaterThan(-1);
    const body = shell.slice(at, shell.indexOf('\n});', at));
    expect(body).toContain('mayEvict:');
    expect(body).toContain('!one.held.working');
    expect(body).toContain('!one.held.listening');
    expect(body).toContain('one.held.awaitingAnswer.length === 0');
  });

  it('is the same test the conversations use, so the two cannot drift', () => {
    const conversations = shell.slice(shell.indexOf('function conversationsIn('));
    const rule = conversations.slice(0, conversations.indexOf('\n}'));
    expect(rule).toContain('!session.working');
    expect(rule).toContain('!session.listening');
    expect(rule).toContain('session.awaitingAnswer.length === 0');
  });
});

describe('trusting an extension does not end the sentence it is in', () => {
  it('remembers the switch and leaves a working conversation alone', () => {
    const at = shell.indexOf('CHANNEL.trustCarried');
    const body = shell.slice(at, shell.indexOf('\n  });', at));
    expect(body).toContain('was.held.working || was.held.listening');
    // The preference is written before the bail-out, so the switch is kept.
    expect(body.indexOf('file.change(')).toBeLessThan(body.indexOf('was.held.working'));
    // And nothing is closed after it.
    expect(body.indexOf('was.held.working')).toBeLessThan(body.indexOf('sessions.close('));
  });
});

/* A fourth of the same shape, found later: the clock over a helper. It watched
   for words, and a builder running a test suite has none to give — so the app
   killed a helper that was working and told the model it had stalled. */
describe('a clock is not a fourth way to end work nobody asked to end', () => {
  it('leaves a helper alone while anything at all is coming out of it', () => {
    const startedAt = 0;
    // Ten minutes of a test suite: a line of its own output every half minute.
    for (let at = 30_000; at <= 10 * 60_000; at += 30_000) {
      expect(whyEndHelper({ startedAt, lastSign: at, now: at + 1000 })).toBeNull();
    }
  });

  it('still ends one that has shown no sign of itself at all', () => {
    expect(whyEndHelper({ startedAt: 0, lastSign: 0, now: HELPER_PATIENCE_MS })).toBe(
      HELPER_TOOK_TOO_LONG,
    );
  });

  it('counts the helper\'s own noise and its steps, not only its answer', () => {
    const tools = readFileSync(new URL('../src/agent/pi/tools.ts', import.meta.url), 'utf8');
    for (const channel of ["child.stdout.on('data'", "child.stderr.on('data'"]) {
      const at = tools.indexOf(channel);
      expect(at, channel).toBeGreaterThan(-1);
      expect(tools.slice(at, at + 300), channel).toContain('stirred()');
    }
    // And the child says what step it is on, so a long step is not silence.
    const runner = readFileSync(new URL('../src/agent/pi/subagent-runner.ts', import.meta.url), 'utf8');
    expect(runner).toContain("report({ type: 'step', text: doing })");
  });
});
