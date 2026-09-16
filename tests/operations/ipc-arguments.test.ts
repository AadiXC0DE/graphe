/** What crosses the bridge, and what is thrown away before it gets anywhere.
 *
 * 9.5 asks that IPC keeps its sender checks, validates argument types, size and
 * owner, and rejects stale or replayed mutation requests and unsafe path
 * targets. The parts that live in a pure function are here: an address is read
 * off an argument list by shape alone, a value of the wrong type is dropped
 * rather than coerced, and a child folder name is a name rather than a path.
 *
 * What is *not* here, because it is a closure inside the Electron entry and
 * cannot be called from a test:
 *
 * - the sender check — `fromOurWindow` (electron/main.ts:7400) refuses anything
 *   that is not the app's own window before the handler body runs (:7442);
 * - the generic catch (:7452), which says part of a change may have gone
 *   through rather than claiming nothing did (finding A05);
 * - the size caps the shell applies to what the window sends — 64 KiB for a
 *   terminal write (:9403), 400-character keys and eight values for an add-on's
 *   answers (:11458);
 * - the refusals on unsafe targets — `deleteConversation` must resolve under the
 *   sessions folder (:9497), `fileText` re-checks both ends through `realpath`
 *   (`fileInProject`, :5242), and a stale add-on answer finds nothing waiting
 *   (:9248).
 *
 * Those are provable only in a real Electron process (`npm run test:electron`)
 * or by reading the source, and neither is a behavioural test. The owner keys
 * that make a replayed request land on the right conversation are proven in
 * `tests/owner.test.ts`, and the address rules in `tests/addressing.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { whereIn } from '../../src/lib/ipc';

const LONG_NAME = 'a'.repeat(80);
const TOO_LONG_NAME = 'a'.repeat(81);

/* ========================================================================== */

describe('an address taken off the arguments', () => {
  it('is read by shape, and anything else is no address at all', () => {
    const notAddresses: unknown[] = [
      undefined,
      null,
      42,
      'conversation-1',
      ['conversation-1'],
      () => undefined,
      new Date(0),
      { project: 'paper-street', extra: true },
      { Project: 'paper-street' },
      { path: '/Users/you/Sites/paper-street' },
    ];
    for (const last of notAddresses) {
      expect(whereIn(['a', 'b', last]), JSON.stringify(last) ?? 'undefined').toEqual({});
    }
  });

  it('never throws, whatever is on the end of it', () => {
    const hostile: unknown[] = [
      { project: { toString: null } },
      { conversation: Symbol('nope') },
      { repo: [] },
      Object.create(null) as unknown,
      new Map(),
    ];
    for (const last of hostile) {
      expect(() => whereIn([last])).not.toThrow();
      expect(typeof whereIn([last])).toBe('object');
    }
    expect(whereIn([])).toEqual({});
  });

  it('keeps the half it can use and drops the half it cannot', () => {
    expect(whereIn([{ project: 'paper-street', conversation: 7 }])).toEqual({ project: 'paper-street' });
    expect(whereIn([{ project: 42, conversation: 'c-1' }])).toEqual({ conversation: 'c-1' });
    expect(whereIn([{ project: '   ', conversation: '\n' }])).toEqual({});
  });
});

describe('a child folder name', () => {
  it('is a name, up to the length a folder name can be', () => {
    expect(whereIn([{ repo: LONG_NAME }])).toEqual({ repo: LONG_NAME });
    expect(whereIn([{ repo: TOO_LONG_NAME }])).toEqual({});
  });

  it('is refused the moment it is a path or a control character', () => {
    for (const repo of ['a/b', 'a\\b', '../b', 'a\u0000b', 'a\nb', 'a\tb', 'a\u007fb']) {
      expect(whereIn([{ repo }]), JSON.stringify(repo)).toEqual({});
    }
  });

  it('keeps a folder name with a space in it, because people have those', () => {
    expect(whereIn([{ repo: 'my app' }])).toEqual({ repo: 'my app' });
  });
});
