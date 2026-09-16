/** Which `/word` runs what.
 *
 * The failure this guards: an add-on registers a command, somebody types it,
 * and the words arrive at a model as prose — "count what the conversation has
 * touched" instead of counting it. And its mirror: a word a workflow already
 * owns being handed to Pi, which dispatches its own commands before it reads
 * templates, so the add-on's handler would run while the picker showed the
 * workflow's name.
 */

import { cp, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

import { createSession } from '../src/agent/pi/adapter';
import type { AgentEvent } from '../src/agent/types';

import {
  leadingWord,
  pickerCommands,
  routeFor,
  type AddonCommand,
  type WorkflowHere,
} from '../src/agent/pi/commands';

const made: string[] = [];

afterAll(async () => {
  for (const one of made.splice(0)) await rm(one, { recursive: true, force: true });
});

const fixture = (which: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${which}`, import.meta.url));

const TALLY: AddonCommand = {
  name: 'tally',
  description: 'Counts what the conversation has touched so far.',
  from: 'pi-tally',
};

const REVIEW: WorkflowHere = {
  command: '/review',
  name: 'review',
  description: 'Look at what changed.',
  source: 'project',
};

describe('the word a message opens with', () => {
  it('is the word, with the slash off, when a message opens with one', () => {
    expect(leadingWord('/tally')).toBe('tally');
    expect(leadingWord('/tally everything since lunch')).toBe('tally');
    expect(leadingWord('  /tally  ')).toBe('tally');
  });

  it('is nothing for a slash that is not a command', () => {
    expect(leadingWord('what about /tally here')).toBeNull();
    expect(leadingWord('/2 + 2')).toBeNull();
    expect(leadingWord('src/components/AddMore.tsx')).toBeNull();
    expect(leadingWord('')).toBeNull();
  });
});

describe('where a typed word goes', () => {
  it('is the add-on when only the add-on answers to it', () => {
    expect(routeFor('tally', { workflows: [REVIEW], addons: [TALLY] })).toBe('addon');
  });

  it('is the workflow when only a way of working answers to it', () => {
    expect(routeFor('review', { workflows: [REVIEW], addons: [TALLY] })).toBe('workflow');
  });

  it('is the workflow when both do, which is the one in front of the person', () => {
    const clash = { ...TALLY, name: 'review' };
    expect(routeFor('review', { workflows: [REVIEW], addons: [clash] })).toBe('workflow');
  });

  it('is nothing when neither does, so the words are not sent to a model', () => {
    expect(routeFor('nonsense', { workflows: [REVIEW], addons: [TALLY] })).toBe('unknown');
    expect(routeFor('tally', { workflows: [], addons: [] })).toBe('unknown');
  });

  it('forgets a command the moment its add-on is not loaded here', () => {
    // The queued case: it was offered when the picker was read, the chat was
    // reloaded without the add-on, and the press lands afterwards.
    expect(routeFor('tally', { workflows: [], addons: [] })).toBe('unknown');
  });
});

describe('the picker', () => {
  it('lists both kinds with where each one comes from', () => {
    const rows = pickerCommands([REVIEW], [TALLY]);
    expect(rows).toEqual([
      {
        command: '/review',
        name: 'review',
        description: 'Look at what changed.',
        from: 'This project',
        runs: 'workflow',
        shadowed: null,
      },
      {
        command: '/tally',
        name: 'tally',
        description: 'Counts what the conversation has touched so far.',
        from: 'pi-tally',
        runs: 'addon',
        shadowed: null,
      },
    ]);
  });

  it('says whose computer a workflow of somebody else’s came from', () => {
    const mine = pickerCommands([{ ...REVIEW, source: 'global' }], [])[0];
    expect(mine?.from).toBe('Your computer');
  });

  it('keeps a row whose name is taken, with the reason on it', () => {
    const rows = pickerCommands([REVIEW], [{ ...TALLY, name: 'review' }]);
    expect(rows).toHaveLength(2);
    expect(rows[1]?.shadowed).toBe('A way of working in This project already answers to this.');
    expect(rows[1]?.runs).toBe('addon');
  });

  it('says which of two add-ons answering one word actually runs', () => {
    const rows = pickerCommands([], [TALLY, { ...TALLY, from: 'pi-other' }]);
    expect(rows[0]?.shadowed).toBeNull();
    expect(rows[1]?.shadowed).toBe('Another add-on here already answers to this.');
  });

  it('is the ways of working alone when no add-on registered one', () => {
    expect(pickerCommands([REVIEW], [])).toHaveLength(1);
    expect(pickerCommands([], [])).toHaveLength(0);
  });
});

/* -------------------------------------------------------------------------- */
/* In a real conversation                                                       */
/* -------------------------------------------------------------------------- */

/** What Pi does with it, against a real session and a real add-on. The pure
 *  decisions above are worth nothing if the words still come out the other end
 *  as prose about counting things. */
describe('a command an add-on registered, in a real chat', () => {
  it('is offered here, and runs in Pi’s command context rather than as prose', async () => {
    const agentDir = await mkdtemp(join(tmpdir(), 'graphe-commands-agent-'));
    made.push(agentDir);
    // Shipped the way a real add-on is: a folder with a manifest saying which
    // file Pi should load, since Pi does not load a folder by itself.
    const into = join(agentDir, 'extensions', 'slash');
    await cp(fixture('slash'), into, { recursive: true });
    await writeFile(
      join(into, 'package.json'),
      JSON.stringify({ name: 'pi-tally', version: '1.2.0', pi: { extensions: ['./index.mjs'] } }),
    );

    const events: AgentEvent[] = [];
    const projectRoot = await mkdtemp(join(tmpdir(), 'graphe-commands-project-'));
    made.push(projectRoot);
    const session = await createSession({
      projectRoot,
      agentDir,
      onEvent: (event) => events.push(event),
    });
    try {
      expect(session.commands()).toEqual([
        {
          name: 'tally',
          description: 'Counts what the conversation has touched so far.',
          from: 'pi-tally',
        },
      ]);

      // The command is the whole message: the handler is what runs. A session
      // with no account connected could not have sent this as a prompt at all,
      // which is half of what this proves. The notice carries the add-on that
      // said it, read off the call stack, because Pi's `notify` has no origin
      // on it — a notice with no name reads as something this app decided.
      await session.prompt('/tally everything since lunch');
      expect(events.filter((one) => one.type === 'notice')).toEqual([
        { type: 'notice', what: 'pi-tally, tallying everything since lunch' },
      ]);
    } finally {
      session.dispose();
    }
  }, 60_000);
});
