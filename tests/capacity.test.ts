/** The caps, and the machine they come from.
 *
 * The bug this replaces was four files each holding their own number: twenty
 * helpers in one fan-out on a laptop with sixteen gigabytes. What matters here
 * is that a small machine gets small numbers, a large one is still bounded, and
 * research never asks for more helpers than the fleet will start.
 */

import { describe, expect, it } from 'vitest';

import { capsFor, capsNow, saysCaps, type Machine } from '../src/work/capacity';

const GB = 1024 ** 3;

function machine(totalGB: number, cores: number, freeGB = 0): Machine {
  return { totalMemBytes: totalGB * GB, freeMemBytes: freeGB * GB, cores };
}

describe('caps from the machine', () => {
  it('never starts more than six helpers, however large the machine', () => {
    expect(capsFor(machine(128, 32)).helpers).toBe(6);
    expect(capsFor(machine(64, 16)).helpers).toBe(6);
  });

  it('never starts fewer than two, however small', () => {
    expect(capsFor(machine(4, 1)).helpers).toBe(2);
    expect(capsFor(machine(0, 0)).helpers).toBe(2);
  });

  it('holds a sixteen-gigabyte laptop well under twenty', () => {
    const caps = capsFor(machine(16, 8));
    expect(caps.helpers).toBeLessThanOrEqual(6);
    expect(caps.helpers).toBeGreaterThanOrEqual(2);
  });

  it('leaves half the processors for the person', () => {
    // Memory is not the binding constraint here; processors are.
    expect(capsFor(machine(64, 4)).helpers).toBe(2);
    expect(capsFor(machine(64, 8)).helpers).toBe(4);
  });

  it('never lets research ask for more helpers than the fleet will start', () => {
    for (const m of [machine(4, 2), machine(8, 4), machine(16, 8), machine(64, 16)]) {
      const caps = capsFor(m);
      expect(caps.research).toBeLessThanOrEqual(caps.helpers);
    }
  });

  it('keeps the board, the check lanes and the servers at four', () => {
    const caps = capsFor(machine(16, 8));
    expect(caps.board).toBe(4);
    expect(caps.checks).toBe(4);
    expect(caps.running).toBe(4);
  });

  it('is not thrown by a machine that reports nonsense', () => {
    const caps = capsFor({ totalMemBytes: Number.NaN, freeMemBytes: Number.NaN, cores: Number.NaN });
    expect(Number.isFinite(caps.helpers)).toBe(true);
    expect(caps.helpers).toBeGreaterThanOrEqual(2);
  });
});

describe('this computer', () => {
  it('answers the same numbers twice', () => {
    expect(capsNow()).toEqual(capsNow());
  });

  it('answers numbers a machine could carry', () => {
    const caps = capsNow();
    expect(caps.helpers).toBeGreaterThanOrEqual(2);
    expect(caps.helpers).toBeLessThanOrEqual(6);
  });
});

describe('saying them', () => {
  it('is one line naming every cap', () => {
    const said = saysCaps(capsFor(machine(16, 8)));
    expect(said).not.toContain('\n');
    for (const word of ['helpers', 'background', 'checks', 'research', 'servers']) {
      expect(said).toContain(word);
    }
  });
});
