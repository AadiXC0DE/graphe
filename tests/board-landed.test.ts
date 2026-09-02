/** Background work finishing has one sender, and it is the authority.
 *
 * There were two: the window watched the board go quiet and prompted the
 * conversation directly, which skipped the round budget and the "ours" filter,
 * and the authority's own path for it was never called at all. So the same
 * event either arrived twice or, with no window open, not at all.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { Workbench } from '../src/history/attempts';
import { Following } from '../src/work/after';
import { asPiece, noteOf, readWritten } from '../src/work/written';

const main = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const hook = readFileSync(
  fileURLToPath(new URL('../src/hooks/useBoard.ts', import.meta.url)),
  'utf8',
);
const board = readFileSync(fileURLToPath(new URL('../src/work/board.ts', import.meta.url)), 'utf8');

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

describe('the shell tells the authority, and nothing else does', () => {
  it('says a piece landed, to the conversation that asked for it', () => {
    expect(main).toContain('function tellTheConversation(');
    expect(main).toContain(
      "continuations.landed(desk.path, address, { id: piece.id, title: piece.doing })",
    );
    expect(main).toContain('const address = piece.startedBy ?? open.held.sessions.current?.path');
  });

  it('settles an idle conversation itself, because none is coming', () => {
    const at = main.indexOf('function tellTheConversation(');
    const block = main.slice(at, main.indexOf('\n}', at));
    expect(block).toContain('if (session === null || session.working) return;');
    expect(block).toContain("void continuations.settled(desk.path, address, 'finished');");
  });

  it('is called once a piece has actually landed', () => {
    expect(main).toContain('tellTheConversation(desk, landed);');
  });

  it('carries the asking conversation onto the board', () => {
    expect(main).toContain('desk.bench.ask(doing, { id, at, ways, model, startedBy })');
    expect(main).toContain("keepGoing(open.path, basename(open.path), doing, after, false, ways ?? null, null, from.address ?? '')");
  });
});

describe('the window no longer sends anything of its own', () => {
  it('has no nudge left in it', () => {
    expect(hook).not.toContain('wentQuiet');
    expect(hook).not.toContain('bridge.prompt');
  });

  it('keeps the helpers nothing calls out of the module too', () => {
    expect(board).not.toContain('quietWords');
    expect(board).not.toContain('wentQuiet');
  });
});
