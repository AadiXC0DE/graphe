/** What an add-on is doing here, said in one word somebody can act on.
 *
 * The screen used to have two words — added, or not — for nine different
 * situations, which is how "I added it and nothing happened" stays a mystery.
 * These are the eight states the plan asks for, from facts the shell and the
 * open conversations already have: a project's own copy nobody has said yes to,
 * a package that loaded in this chat, a change that landed under a chat built
 * before it, a policy that leaves one out, a half-landed install, and a loader
 * that threw.
 */

import { describe, expect, it } from 'vitest';

import {
  extensionRows,
  limitWords,
  type SeenHere,
  type SessionHere,
  type ExtensionReport,
} from '../src/agent/pi/extension-states';
import { MOST_ROUNDS } from '../src/work/carryon';

const HERE = '/Users/you/Sites/paper-street/.pi/extensions/storybook/index.ts';
const ADDED = '/Users/you/.pi/agent/npm/node_modules/pi-lens/extensions/lens.ts';

function seen(overrides: Partial<SeenHere> = {}): SeenHere {
  return {
    id: 'pi-lens',
    version: '1.4.2',
    where: ADDED,
    cameFrom: 'installed',
    inThisProject: false,
    needsTrust: false,
    filesMissing: false,
    ...overrides,
  };
}

function report(overrides: Partial<ExtensionReport> = {}): ExtensionReport {
  return {
    where: ADDED,
    id: 'pi-lens',
    version: '1.4.2',
    loaded: false,
    looked: true,
    policy: 'on',
    commands: [],
    startsTurns: false,
    problem: null,
    ...overrides,
  };
}

function session(overrides: Partial<SessionHere> = {}): SessionHere {
  return { name: 'the one about type', pending: [], reports: [], ...overrides };
}

describe('the eight states', () => {
  it('calls a file nothing has said yes to what it is', () => {
    const [row] = extensionRows(
      [seen({ where: HERE, cameFrom: 'carried', inThisProject: true, needsTrust: true, version: null })],
      [session()],
    );
    expect(row?.state).toBe('needs trust');
    expect(row?.origin).toBe('Came with the project');
    expect(row?.scope).toBe('This project');
  });

  it('says it is running here, and names the chats it is running in', () => {
    const rows = extensionRows(
      [seen()],
      [
        session({ name: 'the one about type', reports: [report({ loaded: true })] }),
        session({ name: 'the second look', reports: [report({ loaded: true })] }),
        session({ name: 'something else', reports: [report({ loaded: false })] }),
      ],
    );
    expect(rows[0]?.state).toBe('active here');
    expect(rows[0]?.activeIn).toEqual(['the one about type', 'the second look']);
    expect(rows[0]?.says).toBe('Running in 2 chats.');
  });

  it('tells an installed one from one this chat has not been built with yet', () => {
    const quiet = extensionRows([seen()], [session({ reports: [report()] })]);
    expect(quiet[0]?.state).toBe('installed');
    expect(quiet[0]?.says).toBe('Added. Not loaded in this chat yet.');

    // A change landed under this chat: it is running what it was built with,
    // which is a different sentence from "nothing loaded it".
    const pending = extensionRows(
      [seen()],
      [session({ pending: ['pi-lens'], reports: [report()] })],
    );
    expect(pending[0]?.state).toBe('activation pending');
    expect(pending[0]?.says).toBe('Installed; reload this chat to activate');
  });

  it('does not call a change pending in a chat that loaded it anyway', () => {
    const rows = extensionRows(
      [seen()],
      [session({ pending: ['pi-lens'], reports: [report({ loaded: true })] })],
    );
    expect(rows[0]?.state).toBe('active here');
  });

  it('says when the add-ons setting is what left it out', () => {
    const rows = extensionRows([seen()], [session({ reports: [report({ policy: 'off' })] })]);
    expect(rows[0]?.state).toBe('disabled');
  });

  it('calls an install whose files are not on disk what it is', () => {
    const rows = extensionRows([seen({ filesMissing: true })], [session({ reports: [report()] })]);
    expect(rows[0]?.state).toBe('incompatible');
  });

  it('carries the loader\u2019s own words when its code threw', () => {
    const rows = extensionRows(
      [seen()],
      [
        session({
          reports: [
            report({
              looked: true,
              problem: { says: 'It did not load when this chat was opened.', logs: ['boom'] },
            }),
          ],
        }),
      ],
    );
    expect(rows[0]?.state).toBe('failed');
    // The reason, not a shrug: "it did not load" on its own is the shrug.
    expect(rows[0]?.says).toBe('It did not load when this chat was opened.');
    expect(rows[0]?.logs).toEqual(['boom']);
  });

  it('calls a file nothing has looked at found, not failed', () => {
    const rows = extensionRows([seen({ id: 'storybook', cameFrom: 'loose' })], [session()]);
    expect(rows[0]?.state).toBe('discovered');
    expect(rows[0]?.origin).toBe('Put here by hand');
    expect(rows[0]?.scope).toBe('Every project');
    // Nothing looked at it. That is not a verdict about what it does.
    expect(rows[0]?.problem).toBeNull();
  });
});

describe('what it is counted as when more than one of them is true', () => {
  it('puts the half-landed install above the loader that threw on it', () => {
    // A package whose files are missing cannot have loaded anything, and the
    // load error is a symptom of that. The install is what somebody acts on.
    const rows = extensionRows(
      [seen({ filesMissing: true })],
      [session({ reports: [report({ problem: { says: 'It did not load.', logs: ['ENOENT'] } })] })],
    );
    expect(rows[0]?.state).toBe('incompatible');
  });

  it('puts an unanswered trust question above whether it happened to load', () => {
    const rows = extensionRows(
      [seen({ where: HERE, cameFrom: 'carried', inThisProject: true, needsTrust: true })],
      [session({ reports: [report({ where: HERE, loaded: true })] })],
    );
    expect(rows[0]?.state).toBe('needs trust');
  });
});

describe('the two halves, joined', () => {
  it('keeps a row whose session said nothing about it', () => {
    // Nothing has looked at it, so there is nothing to join it to — and it is
    // still on disk, so it is still a row.
    const rows = extensionRows([seen({ where: HERE })], [session({ reports: [report()] })]);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.where).toBe(HERE);
  });

  it('collects the commands it offers here', () => {
    const rows = extensionRows(
      [seen()],
      [
        session({ reports: [report({ loaded: true, commands: ['lens'] })] }),
        session({ reports: [report({ loaded: true, commands: ['lens-symbols'] })] }),
      ],
    );
    expect(rows[0]?.commands).toEqual(['lens', 'lens-symbols']);
  });

  it('says nothing went wrong when no session reported a problem', () => {
    const rows = extensionRows([seen()], [session({ reports: [report({ looked: false })] })]);
    expect(rows[0]?.problem).toBeNull();
    expect(rows[0]?.logs).toEqual([]);
  });

  /* Which conversations have it loaded, and which do not — the plan's "active
     conversations per installation". A chat built before it was added is not
     one of them, and saying it is would be the same lie as a bare count. */
  it('names only the conversations the add-on is actually loaded into', () => {
    const rows = extensionRows(
      [seen()],
      [
        session({ name: 'the one about type', reports: [report({ loaded: true })] }),
        session({ name: 'the second look', reports: [report({ loaded: false })] }),
        session({ name: 'a chat built before it', reports: [report({ loaded: false })] }),
      ],
    );
    expect(rows[0]?.activeIn).toEqual(['the one about type']);
  });

  /* The one limit the shell stated travels with the row, and an add-on with
     none leaves the row's limits empty rather than inventing one. */
  it('carries the limit the shell stated for an add-on', () => {
    const said = 'It keeps one advisor setting for this whole computer.';
    const stated = extensionRows([seen({ limit: said })], [session({ reports: [report()] })]);
    expect(stated[0]?.limits).toEqual([said]);

    const quiet = extensionRows([seen()], [session({ reports: [report()] })]);
    expect(quiet[0]?.limits).toEqual([]);
  });

  /* The limit on turns an add-on starts is a fact about the host, not about any
     one add-on, and it is only drawn where the add-on's own card says it starts
     them. An add-on that starts nothing reading "it can start turns of its own"
     would be the label lying. */
  it('states the turn limit only for an add-on whose card says it starts turns', () => {
    const starts = extensionRows(
      [seen()],
      [session({ reports: [report({ startsTurns: true })] })],
    );
    expect(starts[0]?.limits).toEqual([limitWords.startsTurns(MOST_ROUNDS)]);
    expect(starts[0]?.limits[0]).toContain('Nothing can refuse one before it begins');

    const quiet = extensionRows([seen()], [session({ reports: [report()] })]);
    expect(quiet[0]?.limits).toEqual([]);
  });
});
