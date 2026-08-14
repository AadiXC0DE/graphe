import { describe, expect, it } from 'vitest';

import { durationInWords } from '../src/lib/when';

describe('durationInWords — how long a run went for', () => {
  it('says minutes alone below an hour', () => {
    expect(durationInWords(120)).toBe('2m');
  });

  it('rolls a whole hour over', () => {
    expect(durationInWords(3599)).toBe('1h');
  });

  it('says hours and minutes above an hour', () => {
    expect(durationInWords(3600)).toBe('1h');
    expect(durationInWords(7500)).toBe('2h 5m');
    expect(durationInWords(2 * 3600 + 30 * 60)).toBe('2h 30m');
  });

  it('never says less than a minute', () => {
    expect(durationInWords(1)).toBe('1m');
  });
});
