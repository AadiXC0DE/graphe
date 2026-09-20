// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { canvasDrafts, clearCanvasDraft, keepCanvasDraft } from '../src/lib/canvas-drafts';
import { newFlow } from '../src/work/canvas';

beforeEach(() => localStorage.clear());

describe('canvas shutdown recovery', () => {
  it('recovers edits only for their project after the queue is gone', () => {
    const flow = newFlow();
    keepCanvasDraft(localStorage, '/a', flow);
    expect(canvasDrafts(localStorage, '/a')).toEqual([flow]);
    expect(canvasDrafts(localStorage, '/b')).toEqual([]);
  });

  it('does not let an older acknowledgement erase a newer edit', () => {
    const flow = newFlow();
    const edited = { ...flow, name: 'Latest words' };
    keepCanvasDraft(localStorage, '/a', flow);
    keepCanvasDraft(localStorage, '/a', edited);
    clearCanvasDraft(localStorage, '/a', flow.id, flow);
    expect(canvasDrafts(localStorage, '/a')[0]?.name).toBe('Latest words');
    clearCanvasDraft(localStorage, '/a', flow.id, edited);
    expect(canvasDrafts(localStorage, '/a')).toEqual([]);
  });

  it('removes the recovery copy after confirmed deletion', () => {
    const flow = newFlow();
    keepCanvasDraft(localStorage, '/a', flow);
    clearCanvasDraft(localStorage, '/a', flow.id);
    expect(canvasDrafts(localStorage, '/a')).toEqual([]);
  });
});
