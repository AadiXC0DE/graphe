/** Who asked for a piece of background work, written down with it.
 *
 * The asking conversation travels on the piece and comes back with the note, so
 * a finished piece can be reported to the conversation that wanted it.
 */

import { describe, expect, it } from 'vitest';

import { Workbench } from '../src/history/attempts';
import { Following } from '../src/work/after';
import { asPiece, noteOf, readWritten } from '../src/work/written';

function bench(): Workbench {
  return new Workbench({
    history: { hasUnsavedChanges: () => Promise.resolve(false) } as never,
    under: '/tmp/graphe-tests',
  });
}

describe('who asked for a piece of work is written down', () => {
  it('is kept on the piece', () => {
    const piece = bench().ask('rewrite the header', { startedBy: '/sessions/a.jsonl' });
    expect(piece.startedBy).toBe('/sessions/a.jsonl');
  });

  it('is absent where nobody asked, rather than blank', () => {
    expect(bench().ask('a piece from the canvas').startedBy).toBeUndefined();
  });

  it('survives being written down and read back', () => {
    const piece = bench().ask('rewrite the header', { startedBy: '/sessions/a.jsonl' });
    const note = noteOf(piece, { project: '/work/site', name: 'site', owner: { pid: 1, since: 0 } });
    const back = readWritten(JSON.parse(JSON.stringify(note)) as unknown);
    expect(back?.startedBy).toBe('/sessions/a.jsonl');
    expect(asPiece(back!).startedBy).toBe('/sessions/a.jsonl');
  });

  it('carries through a piece that was waiting for another', () => {
    const asked: { doing: string; startedBy?: string | null }[] = [];
    let first: 'running' | 'done' = 'running';
    const chain = new Following({
      ask: (doing, where) => asked.push({ doing, startedBy: where.startedBy }),
      stopped: () => undefined,
      stateOf: (id) => (id === 'a' ? first : 'waiting'),
    });
    chain.hold({ id: 'b', doing: 'then this', at: 1, after: 'a', startedBy: '/sessions/a.jsonl' });
    first = 'done';
    chain.finished('a');
    expect(asked).toEqual([{ doing: 'then this', startedBy: '/sessions/a.jsonl' }]);
  });
});
