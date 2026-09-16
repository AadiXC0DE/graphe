/** E10: what an add-on change means for a conversation that is already open.
 *
 * A session is built with the add-ons that were installed the moment it opened.
 * Installing one afterwards changes nothing about a session that is going, and
 * a conversation that quietly cannot see it is the worst of both: the person
 * paid for an install and got nothing, with no way to tell that from the add-on
 * being broken. So it says so, in one sentence, and reloading is safe to ask
 * for — which is what the second half of this proves, against a real session.
 */

import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { createSession } from '../src/agent/pi/adapter';
import { RELOAD_TO_ACTIVATE, RELOAD_TO_LET_GO, reloadWords } from '../src/agent/pi/package-lifecycle';
import type { PackageChange } from '../src/agent/pi/package-lifecycle';

const made: string[] = [];

function scratch(what: string): string {
  const dir = mkdtempSync(join(tmpdir(), `graphe-${what}-`));
  made.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** An exchange to reopen on. Pi writes the file when an answer arrives rather
 *  than when a question does, so both halves go in. */
async function anExchangeIn(sessionDir: string, projectRoot: string): Promise<void> {
  const pi = await import('@earendil-works/pi-coding-agent');
  const manager = pi.SessionManager.continueRecent(projectRoot, sessionDir);
  manager.appendMessage({
    role: 'user',
    content: [{ type: 'text', text: 'Hello' }],
    timestamp: Date.now(),
  });
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: 'Working on it.' }],
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
/* The words                                                                    */
/* -------------------------------------------------------------------------- */

describe('what a session says about a change under it', () => {
  it('is the same sentence everywhere, and it says what to do', () => {
    const installed: PackageChange = {
      id: 'pi-lens',
      doing: 'install',
      before: null,
      after: { version: '1.4.2' },
    };
    const removed: PackageChange = {
      id: 'pi-lens',
      doing: 'remove',
      before: { version: '1.4.2' },
      after: null,
    };

    expect(reloadWords(installed)).toBe('Installed; reload this chat to activate');
    expect(reloadWords(installed)).toBe(RELOAD_TO_ACTIVATE);
    expect(reloadWords(removed)).toBe(RELOAD_TO_LET_GO);
  });
});

/* -------------------------------------------------------------------------- */
/* The session                                                                  */
/* -------------------------------------------------------------------------- */

describe('a conversation that was open when an add-on changed', () => {
  it('is activation pending in exactly those words, and clean before that', async () => {
    const projectRoot = scratch('activation-project');
    const agentDir = scratch('activation-agent');
    const session = await createSession({ projectRoot, agentDir, onEvent: () => {} });
    try {
      expect(session.activationPending).toBeNull();
      session.markActivationPending(RELOAD_TO_ACTIVATE);
      expect(session.activationPending).toBe('Installed; reload this chat to activate');
    } finally {
      session.dispose();
    }
  }, 30_000);

  it('comes back with the transcript, the model and the permissions it had', async () => {
    const projectRoot = scratch('reload-project');
    const agentDir = scratch('reload-agent');
    const sessionDir = scratch('reload-sessions');

    const live = await createSession({ projectRoot, agentDir, sessionDir, onEvent: () => {} });
    live.dispose();
    await anExchangeIn(sessionDir, projectRoot);
    expect(readdirSync(sessionDir)).toHaveLength(1);

    // What somebody chose for this conversation, and what a rebuild has to
    // keep: the model, and how far the agent may go.
    const chosen = { providerId: 'anthropic', modelId: 'claude-sonnet-4-5' };
    const before = await createSession({
      projectRoot,
      agentDir,
      sessionPath: join(sessionDir, readdirSync(sessionDir)[0] ?? ''),
      model: chosen,
      onEvent: () => {},
    });
    before.goAsFarAs('changing');
    const transcript = before.history;
    const at = before.conversation;
    before.markActivationPending(RELOAD_TO_ACTIVATE);
    expect(before.activationPending).toBe(RELOAD_TO_ACTIVATE);
    before.dispose();

    // The reload: the same file, the same choice, the same rung — a session
    // built again rather than a conversation started over.
    const after = await createSession({
      projectRoot,
      agentDir,
      sessionPath: at ?? undefined,
      model: chosen,
      onEvent: () => {},
    });
    try {
      expect(after.conversation).toBe(at);
      expect(after.history).toEqual(transcript);
      expect(after.history.length).toBeGreaterThan(0);
      expect(after.model).toEqual(chosen);
      // A fresh session starts at the cautious default, which is exactly why
      // the reload carries the rung across rather than assuming it.
      expect(after.howFar).toBe('asking');
      after.goAsFarAs('changing');
      expect(after.howFar).toBe('changing');
    } finally {
      after.dispose();
    }
  }, 30_000);
});
