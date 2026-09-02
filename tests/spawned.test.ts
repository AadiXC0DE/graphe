/** Everything this app starts is written down where the shell can find it.
 *
 * The seam rather than the ledger: what matters is that a helper and a server
 * both say so, that nothing is written down twice, and that a ledger which
 * throws never reaches the work.
 */

import { afterEach, describe, expect, it } from 'vitest';

import { ended, started, watchWhatWeStart, type Kind } from '../src/share/spawned';

type Row = { pid: number; what: string; kind: Kind };

function watching(): { rows: Row[]; gone: number[] } {
  const rows: Row[] = [];
  const gone: number[] = [];
  watchWhatWeStart({
    started: (one) => rows.push({ pid: one.pid, what: one.what, kind: one.kind }),
    ended: (pid) => gone.push(pid),
  });
  return { rows, gone };
}

afterEach(() => watchWhatWeStart(null));

describe('what the shell is told', () => {
  it('writes down a helper and a server, each as what it is', () => {
    const seen = watching();
    started({ pid: 101, what: 'git', kind: 'helper' });
    started({ pid: 102, what: 'npm run dev', kind: 'server' });
    expect(seen.rows).toEqual([
      { pid: 101, what: 'git', kind: 'helper' },
      { pid: 102, what: 'npm run dev', kind: 'server' },
    ]);
  });

  it('says when one is over', () => {
    const seen = watching();
    started({ pid: 7, what: 'tsc', kind: 'check' });
    ended(7);
    expect(seen.gone).toEqual([7]);
  });

  /* A spawn that never got off the ground has no pid, and a row about it would
     be a row nothing can ever close. */
  it('writes down nothing for a child that never started', () => {
    const seen = watching();
    started({ pid: undefined, what: 'missing', kind: 'helper' });
    started({ pid: 0, what: 'missing', kind: 'helper' });
    ended(undefined);
    expect(seen.rows).toEqual([]);
    expect(seen.gone).toEqual([]);
  });

  it('costs nothing when nobody is listening', () => {
    watchWhatWeStart(null);
    expect(() => started({ pid: 5, what: 'git', kind: 'helper' })).not.toThrow();
    expect(() => ended(5)).not.toThrow();
  });

  /* A ledger is bookkeeping. The child still ran, and a throw here must never
     reach the work that started it. */
  it('never lets a ledger that throws reach the work', () => {
    watchWhatWeStart({
      started: () => {
        throw new Error('no');
      },
      ended: () => {
        throw new Error('no');
      },
    });
    expect(() => started({ pid: 5, what: 'git', kind: 'helper' })).not.toThrow();
    expect(() => ended(5)).not.toThrow();
  });
});
