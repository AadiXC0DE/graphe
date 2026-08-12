/** The write-up a design lead can approve, and everything that stops it.
 *
 * Two things are tested here and they fail differently. The description is
 * language: wrong, and the one artefact in this whole flow that a non-technical
 * person can read stops being readable. The refusals are safety: wrong, and
 * somebody's key is on the internet.
 *
 * All of it pure — nothing here spawns anything or reaches a network, which is
 * the point of keeping the deciding and the doing in separate files.
 */

import { describe, expect, it } from 'vitest';

import {
  describeForReview,
  handoverWords,
  nameForWork,
  opening,
  safeToHandOver,
  safeToWriteTo,
  titleOf,
  whereAPictureLives,
  type Handover,
  type Piece,
} from '../src/share/handover';
import {
  canPutOnline,
  canSendItOn,
  readAccount,
  readSignedIn,
  readWhereItLives,
  toolWords,
} from '../src/share/tools';

const AT = Date.UTC(2026, 7, 12, 9, 30);

function piece(over: Partial<Piece> = {}): Piece {
  return {
    title: 'Gave the pricing cards more room',
    says: 'Spacing on three cards, from 16 to 24.',
    where: 'Two areas changed, near the top.',
    pictures: {
      before: 'https://raw.githubusercontent.com/kettle/site/graphe/work-x/a.png',
      after: 'https://raw.githubusercontent.com/kettle/site/graphe/work-x/b.png',
    },
    ...over,
  };
}

function handover(over: Partial<Handover> = {}): Handover {
  return {
    project: 'Kettle',
    title: 'Gave the pricing cards more room',
    pieces: [piece()],
    ...over,
  };
}

/* ========================================================================== */
/* HO-01 what the work is called                                               */
/* ========================================================================== */

describe('HO-01 naming the work', () => {
  it('reads as what was asked for', () => {
    expect(nameForWork('Gave the pricing cards more room', AT)).toMatch(
      /^graphe\/gave-the-pricing-cards-more-room-[a-z0-9]+$/,
    );
  });

  it('survives a title that is punctuation, accents or nothing at all', () => {
    expect(nameForWork('Café — “20% off” banner!', AT)).toMatch(/^graphe\/cafe-20-off-banner-/);
    expect(nameForWork('', AT)).toMatch(/^graphe\/work-/);
    expect(nameForWork('///', AT)).toMatch(/^graphe\/work-/);
  });

  it('never runs away with a very long title', () => {
    const name = nameForWork('a'.repeat(400), AT);
    expect(name.length).toBeLessThan(70);
  });

  it('gives two goes at the same change two different names', () => {
    expect(nameForWork('same thing', AT)).not.toBe(nameForWork('same thing', AT + 60_000));
  });

  /* The one thing this feature must never do. */
  it('never lands on what everybody else is working from', () => {
    for (const theirs of ['main', 'master', 'trunk', 'develop', 'default', 'release-2026']) {
      expect(safeToWriteTo(theirs, theirs)).toBe(false);
      expect(safeToWriteTo(`graphe/${theirs}`, theirs)).toBe(theirs === 'release-2026');
    }
    expect(safeToWriteTo(nameForWork('anything', AT), 'main')).toBe(true);
  });

  it('refuses a name that could be a path, a walk upwards, or somebody else’s', () => {
    for (const bad of [
      'graphe/../evil',
      'graphe/a/b',
      'graphe/',
      'graphe/-leading',
      'graphe/UPPER',
      'someone-else/work',
      '',
      'HEAD',
    ]) {
      expect(safeToWriteTo(bad, 'main')).toBe(false);
    }
  });
});

/* ========================================================================== */
/* HO-02 where the pictures live                                               */
/* ========================================================================== */

describe('HO-02 the pictures have somewhere to be', () => {
  const name = 'graphe/work-abc';

  it('points at the pictures carried along with the work', () => {
    expect(whereAPictureLives('kettle/site', name, '.graphe/what-changed/01-before.png')).toBe(
      'https://raw.githubusercontent.com/kettle/site/graphe/work-abc/.graphe/what-changed/01-before.png',
    );
  });

  it('is only ever a locked address', () => {
    const where = whereAPictureLives('kettle/site', name, 'a.png');
    expect(where).not.toBeNull();
    expect(where).toMatch(/^https:\/\//);
  });

  it('says nothing rather than building an address out of nonsense', () => {
    expect(whereAPictureLives('not a project', name, 'a.png')).toBeNull();
    expect(whereAPictureLives('kettle/site', 'main', 'a.png')).toBeNull();
    expect(whereAPictureLives('kettle/site', name, '../../etc/passwd')).toBeNull();
    expect(whereAPictureLives('kettle/site', name, 'a b.png')).toBeNull();
  });
});

/* ========================================================================== */
/* HO-03 the write-up itself                                                   */
/* ========================================================================== */

describe('HO-03 the description', () => {
  it('leads with the answer, not with a list of files', () => {
    const said = describeForReview(handover());
    expect(said.split('\n')[0]).toBe('## What changed in Kettle');
    expect(said).toContain('One change, with a picture of it before and after.');
  });

  it('carries the pictures we already took, side by side', () => {
    const said = describeForReview(handover());
    expect(said).toContain('| Before | After |');
    expect(said).toContain('raw.githubusercontent.com/kettle/site/graphe/work-x/a.png');
    expect(said).toContain('raw.githubusercontent.com/kettle/site/graphe/work-x/b.png');
  });

  it('carries the sentence we already wrote beside them, unchanged', () => {
    expect(describeForReview(handover())).toContain('Spacing on three cards, from 16 to 24.');
    expect(describeForReview(handover())).toContain('Two areas changed, near the top.');
  });

  it('shows one picture honestly when there is only one', () => {
    const one = describeForReview(
      handover({ pieces: [piece({ pictures: { before: null, after: 'https://x.test/b.png' } })] }),
    );
    expect(one).toContain('How it looks now');
    expect(one).not.toContain('| Before | After |');

    const other = describeForReview(
      handover({ pieces: [piece({ pictures: { before: 'https://x.test/a.png', after: null } })] }),
    );
    expect(other).toContain('How it looked before');
  });

  it('says there are none rather than showing a broken one', () => {
    const said = describeForReview(
      handover({ pieces: [piece({ pictures: { before: null, after: null } })] }),
    );
    expect(said).toContain(handoverWords.noPictures);
    expect(said).not.toContain('<img');
  });

  it('never repeats the heading back as its own description', () => {
    const said = describeForReview(
      handover({ pieces: [piece({ says: 'Gave the pricing cards more room', where: null })] }),
    );
    expect(said).not.toContain(
      '### Gave the pricing cards more room\n\nGave the pricing cards more room',
    );
    expect(said).toContain('### Gave the pricing cards more room\n\n| Before | After |');
  });

  it('holds no diff, no file list and no shop talk', () => {
    const said = describeForReview(
      handover({ pieces: [piece(), piece({ title: 'Made the header sticky' })] }),
    );
    expect(said).not.toMatch(/\b(diff|commit|merge|branch|rebase|checkout|staged)\b/i);
    expect(said).not.toContain('.tsx');
    expect(said).not.toContain('@@');
  });

  it('counts what is in it, in words', () => {
    expect(opening(handover({ pieces: [] }))).toBe('Nothing changed.');
    expect(opening(handover({ pieces: [piece(), piece()] }))).toContain('Two changes');
    expect(opening(handover({ pieces: Array.from({ length: 9 }, () => piece()) }))).toContain(
      '9 changes',
    );
  });

  it('is the same description twice, and leaves what it was handed alone', () => {
    const one = handover();
    const copy = JSON.parse(JSON.stringify(one)) as Handover;
    expect(describeForReview(one)).toBe(describeForReview(one));
    expect(one).toEqual(copy);
  });

  it('ends where it says it ends, even with nothing in it', () => {
    const empty = describeForReview(handover({ pieces: [] }));
    expect(empty).toContain('Nothing changed.');
    expect(empty.endsWith('\n')).toBe(true);
  });
});

/* ========================================================================== */
/* HO-04 somebody's own words cannot become markup                             */
/* ========================================================================== */

describe('HO-04 nothing typed becomes structure', () => {
  it('never lets a title open a heading of its own', () => {
    const said = describeForReview(
      handover({ pieces: [piece({ title: '# Actually a heading', says: '- and a list' })] }),
    );
    expect(said).not.toContain('\n# Actually a heading');
    expect(said).toContain('### Actually a heading');
    expect(said).toContain('and a list');
  });

  it('never lets a line break split a section', () => {
    const said = describeForReview(
      handover({ pieces: [piece({ says: 'first line\nsecond line\n\n## fake' })] }),
    );
    expect(said).toContain('first line second line ## fake');
  });

  it('never lets a bar break the two-column table', () => {
    const said = describeForReview(handover({ pieces: [piece({ title: 'a | b | c' })] }));
    expect(said).toContain('alt="a \\| b \\| c');
  });

  it('titles the request with something, whatever it was handed', () => {
    expect(titleOf(handover())).toBe('Gave the pricing cards more room');
    expect(titleOf(handover({ title: '   ' }))).toBe('Kettle');
    expect(titleOf(handover({ title: '', project: '' }))).toBe('Design changes');
  });
});

/* ========================================================================== */
/* HO-05 nothing leaves with a key in it                                       */
/* ========================================================================== */

describe('HO-05 a key stops it going anywhere', () => {
  it('lets ordinary work through', () => {
    expect(safeToHandOver(handover())).toEqual({ ok: true });
    expect(safeToHandOver(handover({ pieces: [] }))).toEqual({ ok: true });
  });

  it('refuses work carrying a key, in every field a reader would see', () => {
    const key = 'AKIAIOSFODNN7EXAMPLE';
    expect(safeToHandOver(handover({ project: `Kettle ${key}` })).ok).toBe(false);
    expect(safeToHandOver(handover({ title: `Fixed ${key}` })).ok).toBe(false);
    expect(safeToHandOver(handover({ pieces: [piece({ says: `Used ${key} for it` })] })).ok).toBe(
      false,
    );
    expect(safeToHandOver(handover({ pieces: [piece({ where: `near ${key}` })] })).ok).toBe(false);
  });

  it('catches a private key pasted into a sentence', () => {
    const leaked = handover({
      pieces: [piece({ says: 'Left this in: -----BEGIN RSA PRIVATE KEY----- oops' })],
    });
    expect(safeToHandOver(leaked).ok).toBe(false);
  });

  it('refuses in plain words, saying nothing has left the machine', () => {
    const answer = safeToHandOver(
      handover({ pieces: [piece({ title: 'ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa' })] }),
    );
    if (answer.ok) throw new Error('expected a refusal');
    expect(answer.because).toMatch(/still only on your computer/);
    expect(answer.because).not.toMatch(/\b(api|token|git|commit|regex|json|string|null)\b/i);
    expect(answer.because).toMatch(/[.!]$/);
  });

  it('does not read the pictures, which are bytes and not words', () => {
    const long = `https://x.test/${'a'.repeat(400)}.png`;
    expect(safeToHandOver(handover({ pieces: [piece({ pictures: { before: long, after: long } })] })).ok).toBe(
      true,
    );
  });
});

/* ========================================================================== */
/* HO-06 the vocabulary                                                        */
/* ========================================================================== */

describe('HO-06 the words in front of somebody', () => {
  const retired =
    /\b(git|commit(s|ted|ting)?|branch(es)?|merg(e|es|ed|ing)|push(es|ed|ing)?|pull request|PR|repo(sitory)?|worktree|stag(e|ed|ing)|rebas(e|ed|ing)|checkout|deploy(s|ed|ing|ment)?|token|API|session)\b/i;

  it('says nothing about the machinery', () => {
    for (const sentence of Object.values(handoverWords)) {
      expect(sentence).not.toMatch(retired);
    }
    for (const sentence of Object.values(toolWords)) {
      expect(sentence).not.toMatch(retired);
    }
  });

  it('would notice a violation if one were written', () => {
    for (const bad of [
      'Opened a pull request',
      'Pushed the branch',
      'Created a PR for review',
      'Deployed to production',
      'Your API token is missing',
    ]) {
      expect(bad).toMatch(retired);
    }
  });

  it('ends every sentence, so none of them read as a fragment', () => {
    for (const sentence of Object.values(handoverWords)) {
      if (sentence === handoverWords.label) continue;
      expect(sentence).toMatch(/[.!…]$/);
    }
  });
});

/* ========================================================================== */
/* HO-07 what this computer has, and what it has not                           */
/* ========================================================================== */

describe('HO-07 detection, and every absence', () => {
  const found = {
    helper: true,
    signedIn: true,
    home: 'kettle/site',
    theProjectItself: 'main',
  } as const;

  it('goes all the way when everything is here', () => {
    expect(canSendItOn({ ...found })).toEqual({ all: true, says: toolWords.ready });
  });

  it('names the first missing thing, and only the first', () => {
    expect(canSendItOn({ ...found, helper: false, signedIn: false, home: null })).toEqual({
      all: false,
      says: toolWords.noHelper,
    });
    expect(canSendItOn({ ...found, signedIn: false, home: null })).toEqual({
      all: false,
      says: toolWords.notSignedIn,
    });
    expect(canSendItOn({ ...found, home: null })).toEqual({
      all: false,
      says: toolWords.noHome,
    });
  });

  it('says the same about putting a project online', () => {
    expect(canPutOnline({ helper: true, signedIn: true }).all).toBe(true);
    expect(canPutOnline({ helper: false, signedIn: false }).says).toBe(toolWords.onlineNoHelper);
    expect(canPutOnline({ helper: true, signedIn: false }).says).toBe(toolWords.onlineNotSignedIn);
  });

  it('every absence is a sentence a person could act on', () => {
    for (const says of [
      toolWords.noHelper,
      toolWords.notSignedIn,
      toolWords.noHome,
      toolWords.onlineNoHelper,
      toolWords.onlineNotSignedIn,
    ]) {
      expect(says.length).toBeGreaterThan(30);
      expect(says).toMatch(/[.!]$/);
    }
  });

  it('reads where a project lives out of what the helper reported', () => {
    expect(
      readWhereItLives('{"nameWithOwner":"kettle/site","defaultBranchRef":{"name":"main"}}'),
    ).toEqual({ home: 'kettle/site', theProjectItself: 'main' });
  });

  it('reads nonsense as "nowhere shared" rather than as a failure', () => {
    for (const raw of ['', 'not json', 'null', '[]', '{}', '{"nameWithOwner":42}']) {
      expect(readWhereItLives(raw)).toEqual({ home: null, theProjectItself: null });
    }
  });

  it('refuses a name that is really an address or a path', () => {
    expect(readWhereItLives('{"nameWithOwner":"https://evil.test/a/b"}').home).toBeNull();
    expect(readWhereItLives('{"nameWithOwner":"a/b/c"}').home).toBeNull();
    expect(readWhereItLives('{"nameWithOwner":"../../x"}').home).toBeNull();
  });

  it('believes a sign-in only when the words agree with the code', () => {
    expect(readSignedIn(0, 'Logged in to github.com account someone')).toBe(true);
    expect(readSignedIn(1, 'Logged in to github.com account someone')).toBe(false);
    expect(readSignedIn(0, 'You are not logged in to any hosts')).toBe(false);
    expect(readSignedIn(0, 'No accounts found')).toBe(false);
  });

  it('reads an account name, or honestly none', () => {
    expect(readAccount(0, 'someone\n')).toBe('someone');
    expect(readAccount(1, 'someone')).toBeNull();
    expect(readAccount(0, '')).toBeNull();
    expect(readAccount(0, '> Error: not authorised')).toBeNull();
  });
});
