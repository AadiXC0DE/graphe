/** The note a new conversation opens with when somebody continues another one.
 *
 * The two things worth guarding: nothing of the old transcript is claimed to
 * have come across, and a handoff is short enough to read and edit rather than a
 * dump of the conversation it came from.
 */

import { describe, expect, it } from 'vitest';

import { continuationWords, handoffMessage, type Handoff } from '../src/work/continuing';

const base: Handoff = {
  from: 'Make the pricing page calmer',
  objective: 'Make the pricing page calmer and move the trial badge',
  gotTo: 'Moved the badge; the spacing still needs a look.',
  files: ['src/pricing/Page.tsx', 'src/pricing/Page.css'],
  folder: '/work/site',
  project: 'site',
};

describe('a continuation note', () => {
  it('says what was being made, where it got to, and which files it is in', () => {
    const said = handoffMessage(base);
    expect(said).toContain('Make the pricing page calmer');
    expect(said).toContain('Moved the badge');
    expect(said).toContain('src/pricing/Page.tsx');
    expect(said).toContain('/work/site');
  });

  it('says plainly that the old transcript did not come with it', () => {
    const said = handoffMessage(base);
    expect(said).toContain('Nothing else of');
    // And that the files are the continuity, which is the true half.
    expect(said).toContain('everything already written there is here');
  });

  it('flattens a long opening line and cuts it at a word', () => {
    const long = 'x'.repeat(50);
    const said = handoffMessage({
      ...base,
      objective: `First line\n\n${[long, long, long, long, long, long].join(' ')}`,
    });
    expect(said).not.toContain('\nFirst line\n\n');
    expect(said).toContain('…');
    // Never mid-word: what is kept ends on a whole word.
    const carried = said.slice(said.indexOf('First line'), said.indexOf('…'));
    expect(carried.endsWith(' ') || /\w$/.test(carried)).toBe(true);
  });

  it('keeps at most a screenful of files and says nothing when there are none', () => {
    const many = handoffMessage({
      ...base,
      files: Array.from({ length: 40 }, (_one, at) => `src/file-${String(at)}.ts`),
    });
    expect(many.match(/src\/file-/g)).toHaveLength(12);

    const none = handoffMessage({ ...base, files: [] });
    expect(none).not.toContain('Files it worked in');
  });

  it('still reads when there is nothing but a name to go on', () => {
    const bare = handoffMessage({
      ...base,
      objective: null,
      gotTo: null,
      files: [],
    });
    expect(bare).toContain('Continuing from "Make the pricing page calmer"');
    expect(bare).toContain('/work/site');
  });

  it('names each action in three words or fewer, with a sentence under it', () => {
    // The repository's own rule for anything that looks like a button: the
    // operation in one to three words, and the explanation underneath rather
    // than in the label.
    for (const [what, said] of Object.entries(continuationWords)) {
      if (what === 'hint' || what.endsWith('Hint')) continue;
      expect(said.split(' ').length, `${what}: ${said}`).toBeLessThanOrEqual(3);
    }
    expect(continuationWords.hint.length).toBeGreaterThan(40);
    expect(continuationWords.forkHint.length).toBeGreaterThan(40);
  });
});
