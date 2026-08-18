/** Seeing the change before saying yes.
 *
 * Everything here is the part that decides what somebody is shown at the moment
 * they agree to something. The camera is stood in for, so what is tested is the
 * pairing, the order, and the one rule the whole feature rests on: a change that
 * could not be photographed says so and is still decidable.
 */

import { describe, expect, it } from 'vitest';

import { WIDTHS, type Look } from '../src/design/widths';
import {
  NOTHING_CAME_OUT,
  nothingCameOut,
  photographHeld,
  readsHeld,
  sightOf,
  whatIsMissing,
  whichToShow,
  type Held,
  type Looking,
  type Photographer,
} from '../src/diff/holdshot';
import { holdWords } from '../src/share/holding';

/* -------------------------------------------------------------------------- */
/* A camera nobody has to point                                                */
/* -------------------------------------------------------------------------- */

function looked(id: string, shot: string | null, trouble: string | null = null): Look {
  const size = WIDTHS.find((one) => one.id === id);
  return {
    id,
    name: size?.name ?? id,
    width: size?.width ?? 0,
    shot,
    trouble,
  };
}

/** Answers per folder, and keeps the order it was asked in. */
function camera(answers: Record<string, Looking>): Photographer & { asked: string[] } {
  const asked: string[] = [];
  return {
    asked,
    look: (folder: string) => {
      asked.push(folder);
      return Promise.resolve(answers[folder] ?? { looks: [] });
    },
  };
}

const everyWidth = (mark: string): Looking => ({
  looks: WIDTHS.map((size) => looked(size.id, `${mark}-${size.id}`)),
});

async function held(answers: Record<string, Looking>, project: string | null = '/project'): Promise<Held> {
  return photographHeld({
    photographer: camera(answers),
    copy: '/copy',
    project,
    id: 'held-1',
    doing: 'Make the header stick',
    clock: () => 1000,
  });
}

/* ========================================================================== */
/* S-01 the picture the decision arrives with                                  */
/* ========================================================================== */

describe('S-01 the copy, photographed', () => {
  it('pairs each width of the copy with the same width of the project', async () => {
    const shots = await held({ '/copy': everyWidth('after'), '/project': everyWidth('before') });

    expect(shots.sights.map((sight) => sight.id)).toEqual(['phone', 'tablet', 'desktop']);
    for (const sight of shots.sights) {
      expect(sight.now).toBe(`before-${sight.id}`);
      expect(sight.changed).toBe(`after-${sight.id}`);
      expect(sight.missing).toBeNull();
    }
    expect(readsHeld(shots).ok).toBe(true);
  });

  it('reads the widths smallest first, whatever order the camera answered in', async () => {
    const shots = await held({
      '/copy': {
        looks: [looked('desktop', 'a-desktop'), looked('phone', 'a-phone'), looked('tablet', 'a-tablet')],
      },
      '/project': { looks: [looked('tablet', 'b-tablet')] },
    });

    expect(shots.sights.map((sight) => sight.width)).toEqual([390, 834, 1440]);
  });

  it('keeps a width the project declared for itself rather than dropping it', async () => {
    const shots = await held({
      '/copy': { looks: [...everyWidth('after').looks, looked('wall', 'after-wall')] },
      '/project': everyWidth('before'),
    });

    expect(shots.sights.map((sight) => sight.id)).toEqual(['phone', 'tablet', 'desktop', 'wall']);
  });

  it('opens on the widest one that shows the change', async () => {
    const shots = await held({ '/copy': everyWidth('after'), '/project': everyWidth('before') });
    expect(whichToShow(shots)?.id).toBe('desktop');
  });

  it('carries what the work was asked to do, in the person’s own words', async () => {
    const shots = await held({ '/copy': everyWidth('after'), '/project': everyWidth('before') });
    expect(shots.doing).toBe('Make the header stick');
    expect(shots.at).toBe(1000);
  });
});

/* ========================================================================== */
/* S-02 what it costs to take                                                  */
/* ========================================================================== */

describe('S-02 one render at a time', () => {
  it('photographs the copy first, then the project it would replace', async () => {
    const eye = camera({ '/copy': everyWidth('after'), '/project': everyWidth('before') });
    await photographHeld({ photographer: eye, copy: '/copy', project: '/project', id: 'x', doing: 'x' });

    expect(eye.asked).toEqual(['/copy', '/project']);
  });

  it('does not photograph the project when the copy came out of nothing', async () => {
    const eye = camera({ '/copy': { looks: [] }, '/project': everyWidth('before') });
    await photographHeld({ photographer: eye, copy: '/copy', project: '/project', id: 'x', doing: 'x' });

    expect(eye.asked).toEqual(['/copy']);
  });

  it('shows the change on its own when there is nothing to compare against', async () => {
    const shots = await held({ '/copy': everyWidth('after') }, null);

    expect(shots.sights.every((sight) => sight.now === null)).toBe(true);
    expect(shots.sights.every((sight) => sight.changed !== null)).toBe(true);
    for (const sight of shots.sights) expect(sight.missing).not.toBeNull();
  });
});

/* ========================================================================== */
/* S-03 honesty                                                                */
/* ========================================================================== */

describe('S-03 nothing is quietly skipped', () => {
  it('gives every expected width a sight, photographed or not', async () => {
    const shots = await held({
      '/copy': { looks: [looked('desktop', 'after-desktop')] },
      '/project': { looks: [looked('desktop', 'before-desktop')] },
    });

    expect(shots.sights).toHaveLength(WIDTHS.length);
    expect(whatIsMissing(shots).map((sight) => sight.id)).toEqual(['phone', 'tablet']);
  });

  it('never leaves a missing picture without a reason', async () => {
    const shots = await held({ '/copy': { looks: [looked('phone', null)] } });

    for (const sight of shots.sights) {
      if (sight.changed === null || sight.now === null) expect(sight.missing).not.toBeNull();
    }
  });

  it('never puts a reason beside a pair that came out', () => {
    const sight = sightOf({
      id: 'desktop',
      name: 'Desktop',
      width: 1440,
      now: 'a',
      changed: 'b',
      missing: 'something went wrong',
    });

    expect(sight.missing).toBeNull();
  });

  it('says why when the project will not build, and says it once', async () => {
    const shots = await held({
      '/copy': { looks: [], trouble: 'This project wouldn’t build, so there is nothing to show.' },
    });

    expect(nothingCameOut(shots)).toBe(true);
    expect(shots.note).toBe('This project wouldn’t build, so there is nothing to show.');
    expect(readsHeld(shots).says).toBe('This project wouldn’t build, so there is nothing to show.');
    expect(readsHeld(shots).ok).toBe(false);
  });

  it('falls back to a reason of its own when the camera gives none', async () => {
    const shots = await held({ '/copy': { looks: [] } });

    expect(shots.note).toBe(NOTHING_CAME_OUT);
    for (const sight of shots.sights) expect(sight.missing).toBe(NOTHING_CAME_OUT);
  });

  it('counts a half-photographed set as a fail, not a pass', async () => {
    const shots = await held({
      '/copy': { looks: [looked('phone', null), looked('tablet', 'a'), looked('desktop', 'b')] },
      '/project': everyWidth('before'),
    });

    const reading = readsHeld(shots);
    expect(reading.ok).toBe(false);
    expect(reading.says).toContain('tablet and desktop');
    expect(reading.says).toContain('The phone one didn’t come out.');
  });

  it('still hands back a sight to open when only the older half came out', async () => {
    const shots = await held({
      '/copy': { looks: [looked('phone', 'after-phone'), looked('desktop', null)] },
      '/project': everyWidth('before'),
    });

    expect(whichToShow(shots)?.id).toBe('phone');
  });

  it('keeps what is wrong with a width beside that width', async () => {
    const shots = await held({
      '/copy': { looks: [looked('phone', 'after-phone', 'Something is 40px wider than a phone.')] },
      '/project': everyWidth('before'),
    });

    const phone = shots.sights.find((sight) => sight.id === 'phone');
    expect(phone?.trouble).toBe('Something is 40px wider than a phone.');
  });
});

/* ========================================================================== */
/* S-04 the words                                                              */
/* ========================================================================== */

describe('S-04 the answer is never withheld', () => {
  it('offers both answers in the same words as everywhere else', () => {
    expect(holdWords.approve).toBe('Let it in');
    expect(holdWords.setAside).toBe('Set it aside');
    expect(holdWords.decideAnyway).toContain(holdWords.approve.toLowerCase());
    expect(holdWords.decideAnyway).toContain(holdWords.setAside.toLowerCase());
  });

  it('names the two halves by what they are, not before and after', () => {
    expect(holdWords.now).toBe('How it looks now');
    expect(holdWords.ifIn).toBe('If you let it in');
  });

  it('never says a word from the machinery underneath', () => {
    const everything = Object.values(holdWords).join(' ').toLowerCase();
    for (const banned of ['git', 'worktree', 'branch', 'commit', 'merge', 'checkout', 'screenshot']) {
      expect(everything).not.toContain(banned);
    }
  });

  it('ends the sentences it says, so none of them read as a fragment', () => {
    for (const one of [holdWords.decideAnyway, NOTHING_CAME_OUT, holdWords.lookAgain]) {
      expect(one).toMatch(/[.!]$/);
    }
  });

  /* The reading used to be worked out and then ignored: whatever the pictures
     showed, "Let it in" carried the weight. It now decides which of the two
     answers is the obvious one — and never which of them is possible. */
  it('has a second pair of words for when the pictures show a problem', () => {
    expect(holdWords.approveAnyway).toBe('Let it in anyway');
    // The same answer, said with what it costs attached.
    expect(holdWords.approveAnyway).toContain(holdWords.approve);
    // The caution names the button rather than describing it in other words.
    expect(holdWords.lookAgain.toLowerCase()).toContain(holdWords.setAside.toLowerCase());
  });

  it('knows which sets of pictures are the ones to hesitate over', () => {
    const set = (changed: readonly (string | null)[]): Held => ({
      id: 'held-1',
      doing: 'Make the header stick',
      at: 1000,
      sights: changed.map((shot, at) => ({
        id: at === 0 ? 'phone' : 'desktop',
        name: at === 0 ? 'phone' : 'desktop',
        width: at === 0 ? 390 : 1440,
        now: 'before',
        changed: shot,
        missing: shot === null ? 'The project would not build at this width.' : null,
        trouble: null,
      })),
      note: null,
    });

    expect(readsHeld(set(['a', 'b'])).ok).toBe(true);

    // One width that did not come out is enough: somebody is about to say yes
    // on the strength of this.
    const lost = readsHeld(set(['a', null]));
    expect(lost.ok).toBe(false);
    expect(lost.says).toContain('desktop');
  });
});
