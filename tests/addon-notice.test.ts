/** What an add-on says without asking anything, and where it is still readable.
 *
 * Pi's `notify` is the one UI method the host is handed with no origin on it, so
 * an add-on's notice arrives indistinguishable from one this app said itself.
 * Two things follow, and this file settles both:
 *
 *  - the add-on is named, read off the call stack at the moment of the call —
 *    never guessed at, because a notice fired from a timer has no add-on in its
 *    frames and naming whichever one happens to be loaded would be a lie
 *    somebody could act on;
 *  - the notice is written into the conversation's own record. It used to live
 *    only as long as the window that drew it: one arriving while a conversation
 *    was closed was gone, and reading the conversation back did not bring it.
 *    Pi has an entry that is kept and never shown to the model — a `custom` one
 *    — which is what makes it the honest place for a line meant for a person
 *    and not for the agent.
 *
 * The last test is the one the gap is about: the notice is read back out of the
 * file, by the same reader a reopened conversation uses, after the session that
 * heard it has been disposed of.
 */

import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createSession, readTranscript } from '../src/agent/pi/adapter';
import { saysAddonCannot, saysAddonFailed, uiContextOver, unsupportedTerminal, dialogsOver } from '../src/agent/pi/extension-ui';
import { NOTICE_ENTRY } from '../src/agent/pi/history';
import type { AgentEvent } from '../src/agent/types';

const fixture = (which: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${which}`, import.meta.url));

const made: string[] = [];

afterAll(async () => {
  for (const one of made.splice(0)) await rm(one, { recursive: true, force: true });
});

async function scratch(prefix: string): Promise<string> {
  const at = await mkdtemp(join(tmpdir(), prefix));
  made.push(at);
  return at;
}

/** The `notices` add-on, installed the way a real one is: a folder with a
 *  manifest saying which file Pi should load, since Pi never loads a folder by
 *  itself. */
async function installed(agentDir: string): Promise<void> {
  const into = join(agentDir, 'extensions', 'notices');
  await cp(fixture('notices'), into, { recursive: true });
  await writeFile(
    join(into, 'package.json'),
    JSON.stringify({ name: 'notices', version: '1.0.0', pi: { extensions: ['./index.mjs'] } }),
  );
}

/** A conversation with something in it, so Pi has a file to append to. Pi writes
 *  nothing until an answer exists, so both halves of an exchange go in. */
async function anExchange(sessionDir: string, projectRoot: string): Promise<void> {
  const pi = await import('@earendil-works/pi-coding-agent');
  const manager = pi.SessionManager.create(projectRoot, sessionDir);
  manager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Tidy the pages.' }],
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Looking at them now.' }],
    api: 'anthropic-messages',
    provider: 'anthropic',
    model: 'test',
    stopReason: 'stop',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Whose word it is                                                             */
/* -------------------------------------------------------------------------- */

describe('the words a notice about an add-on is said in', () => {
  it('names the add-on, so somebody knows which one to turn off', () => {
    expect(saysAddonCannot('pi-lens', 'setWidget', 'terminal')).toBe(
      'pi-lens asked for setWidget, which needs a terminal window. Nothing was drawn for it, and it was told so.',
    );
    expect(saysAddonCannot('pi-lens', 'setWidget', 'window')).toBe(
      'pi-lens asked for something this window could not do: setWidget.',
    );
    expect(saysAddonFailed('pi-lens', 'turn_end', 'the tally blew up')).toBe(
      'pi-lens failed during turn_end: the tally blew up',
    );
  });

  it('says an add-on without inventing a name for it', () => {
    // Null is what the stack reader answers when no frame belongs to an add-on
    // — a notice fired from a timer has none — and a guess here is a person
    // acting on the wrong add-on.
    expect(saysAddonCannot(null, 'custom', 'window')).toContain('An add-on asked');
    expect(saysAddonFailed(null, null, null)).toBe('An add-on failed during a step: it did not say why');
  });

  it('is handed the add-on by the host, because Pi does not pass one', () => {
    const said: string[] = [];
    const face = uiContextOver({
      dialogs: dialogsOver(async () => ({ kind: 'select', value: null })),
      terminal: unsupportedTerminal(() => undefined),
      notify: (what) => said.push(what),
      who: () => 'pi-lens',
    });

    face.notify('The button row is re-drawn.');
    face.notify('Two pages are missing a heading.', 'warning');
    face.notify('The build file would not parse.', 'error');

    expect(said).toEqual([
      'pi-lens, The button row is re-drawn.',
      'pi-lens, warning: Two pages are missing a heading.',
      'pi-lens, error: The build file would not parse.',
    ]);
  });

  it('says nothing it cannot stand behind when nothing could name the add-on', () => {
    const said: string[] = [];
    const face = uiContextOver({
      dialogs: dialogsOver(async () => ({ kind: 'select', value: null })),
      terminal: unsupportedTerminal(() => undefined),
      notify: (what) => said.push(what),
      who: () => null,
    });

    face.notify('Two pages are missing a heading.', 'warning');
    // The severity is never dropped, and no name is invented to go with it.
    expect(said).toEqual(['warning: Two pages are missing a heading.']);
  });
});

/* -------------------------------------------------------------------------- */
/* Where the notice is kept                                                     */
/* -------------------------------------------------------------------------- */

describe('a notice nobody was watching for', () => {
  it('is still readable after the conversation is opened again', async () => {
    const agentDir = await scratch('graphe-notice-agent-');
    const projectRoot = await scratch('graphe-notice-project-');
    const sessionDir = await scratch('graphe-notice-sessions-');
    await installed(agentDir);
    await anExchange(sessionDir, projectRoot);

    const events: AgentEvent[] = [];
    const session = await createSession({
      projectRoot,
      agentDir,
      sessionDir,
      onEvent: (event) => events.push(event),
    });
    // The add-on fires on session_start, which is bound before the first prompt
    // — so these are notices arriving with nobody in front of the window.
    session.dispose();

    const heard = events.filter((one) => one.type === 'notice').map((one) => one.what);
    expect(heard).toContain('notices, The button row is re-drawn.');

    // Read back out of the file, by the reader a reopened conversation uses.
    const files = await readdir(sessionDir);
    expect(files).toHaveLength(1);
    const read = await readTranscript(join(sessionDir, files[0] ?? ''));
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    const kept = read.value.filter((one) => one.type === 'notice');
    // In the order they were said, each naming the add-on that said it. The
    // list is not asserted whole: the same fixture's terminal-only calls are
    // refused here too, and those are their own notices.
    expect(kept.slice(0, 3)).toEqual([
      { type: 'notice', what: 'notices, The button row is re-drawn.' },
      { type: 'notice', what: 'notices, warning: Two pages are missing a heading.' },
      { type: 'notice', what: 'notices, error: The build file would not parse.' },
    ]);
    expect(kept.every((one) => one.type === 'notice' && one.what.startsWith('notices'))).toBe(true);

    // And they are on disk in Pi's own shape: the entry extensions keep, which
    // the model is never handed.
    const text = await readFile(join(sessionDir, files[0] ?? ''), 'utf8');
    const stored = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((entry) => entry['customType'] === NOTICE_ENTRY);
    expect(stored).toHaveLength(kept.length);
    expect(stored[0]?.['type']).toBe('custom');
  }, 60_000);

  it('comes back as a line in the conversation, in the order it was said', async () => {
    const agentDir = await scratch('graphe-notice-order-agent-');
    const projectRoot = await scratch('graphe-notice-order-project-');
    const sessionDir = await scratch('graphe-notice-order-sessions-');
    await installed(agentDir);
    await anExchange(sessionDir, projectRoot);

    const first = await createSession({ projectRoot, agentDir, sessionDir, onEvent: () => {} });
    first.dispose();

    // A second session on the same file: what it opens with carries the notice
    // the first one heard, so a relaunch shows it rather than losing it.
    const again = await createSession({ projectRoot, agentDir, sessionDir, onEvent: () => {} });
    const kept = again.history.filter((one) => one.type === 'notice');
    again.dispose();

    expect(kept.length).toBeGreaterThan(0);
    expect(kept.every((one) => one.type === 'notice' && one.what.startsWith('notices'))).toBe(true);
  }, 60_000);

  it('keeps one decided while the conversation was still being built', async () => {
    const agentDir = await scratch('graphe-notice-held-agent-');
    const projectRoot = await scratch('graphe-notice-held-project-');
    const sessionDir = await scratch('graphe-notice-held-sessions-');
    /* Two add-ons wanting one tool name is decided before the session exists,
       which is why this is the notice most likely to arrive with nobody
       watching — and the one that used to leave nothing behind at all. */
    for (const [folder, name] of [
      ['first', 'pi-first'],
      ['second', 'pi-second'],
    ] as const) {
      const into = join(agentDir, 'extensions', folder);
      await mkdir(into, { recursive: true });
      await writeFile(
        join(into, 'index.mjs'),
        `export default function (api) {\n  api.registerTool({ name: 'tally', description: 'Counts.' });\n}\n`,
      );
      await writeFile(
        join(into, 'package.json'),
        JSON.stringify({ name, version: '1.0.0', pi: { extensions: ['./index.mjs'] } }),
      );
    }
    await anExchange(sessionDir, projectRoot);

    const heard: AgentEvent[] = [];
    const session = await createSession({
      projectRoot,
      agentDir,
      sessionDir,
      onEvent: (event) => heard.push(event),
    });
    session.dispose();

    const said = heard.filter((one) => one.type === 'notice').map((one) => one.what);
    const conflict = said.find((one) => one.includes('tally'));
    expect(conflict).toBeDefined();

    const files = await readdir(sessionDir);
    const read = await readTranscript(join(sessionDir, files[0] ?? ''));
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.value.some((one) => one.type === 'notice' && one.what === conflict)).toBe(true);
  }, 60_000);
});
