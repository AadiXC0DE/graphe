/** Branch names that say what the branch is for.
 *
 * The slug rules and the decision to rename are pure, so both are checked here
 * without a repository: words in, a git-safe name or a refusal out.
 */

import { describe, expect, it } from 'vitest';
import {
  branchNameFor,
  freeName,
  isSafeBranchName,
  renameTo,
  slugFor,
} from '../src/history/naming';

const nothingTaken = () => false;

describe('slugs', () => {
  it('lowercases and joins with dashes', () => {
    expect(slugFor('Make The Header Sticky')).toBe('make-header-sticky');
  });

  it('drops leading filler but keeps the subject', () => {
    expect(slugFor('can you please fix the login redirect')).toBe('fix-login-redirect');
    expect(slugFor('please')).toBe('please');
  });

  it('never leaves a leading or trailing dash', () => {
    for (const text of ['  spacing  ', '---dark mode---', '!!! ship it !!!']) {
      const slug = slugFor(text);
      expect(slug).not.toBeNull();
      expect(slug?.startsWith('-')).toBe(false);
      expect(slug?.endsWith('-')).toBe(false);
    }
  });

  it('never doubles a dash', () => {
    expect(slugFor('add  a   dark   mode')).toBe('add-dark-mode');
    expect(slugFor('one -- two')).toBe('one-two');
  });

  it('strips everything git refuses', () => {
    const slug = slugFor('fix ../../etc/passwd ~ ^ : ? * [ \\ "quotes"');
    expect(slug).not.toBeNull();
    expect(slug).toMatch(/^[a-z0-9-]+$/);
    expect(slug).not.toContain('..');
  });

  it('caps the length without cutting a word in half', () => {
    const slug = slugFor(
      'rewrite the entire settings screen and every one of its rows and notes today',
    );
    expect(slug).not.toBeNull();
    expect((slug ?? '').length).toBeLessThanOrEqual(44);
    expect(slug).not.toMatch(/-$/);
    // Whole words only, so nothing reads as a typo.
    expect((slug ?? '').split('-').every((word) => word !== '')).toBe(true);
  });

  it('clips a single word longer than the cap rather than dropping it', () => {
    const slug = slugFor('a'.repeat(90));
    expect(slug).toBe('a'.repeat(44));
  });

  it('has nothing to say about words that are not words', () => {
    expect(slugFor('')).toBeNull();
    expect(slugFor('   ')).toBeNull();
    expect(slugFor('!!! ??? ***')).toBeNull();
  });

  it('refuses names git or a branch list would take for something else', () => {
    expect(slugFor('HEAD')).toBeNull();
    expect(slugFor('main')).toBeNull();
    expect(slugFor('conversation')).toBeNull();
  });

  it('ignores a fenced snippet, which names nothing', () => {
    expect(slugFor('fix `const x = ..;` in the parser')).toBe('fix-in-parser');
  });
});

describe('what git will take', () => {
  it('accepts an ordinary name of ours', () => {
    expect(isSafeBranchName('graphe/fix-login-redirect')).toBe(true);
  });

  it('refuses the shapes git reserves', () => {
    for (const bad of [
      '',
      'graphe/',
      '/graphe/x',
      'graphe//x',
      'graphe/.hidden',
      'graphe/x.lock',
      'graphe/x..y',
      'graphe/x y',
      'graphe/x~1',
      'graphe/x^',
      'graphe/x:y',
      'graphe/x?',
      'graphe/x*',
      'graphe/x[',
      'graphe/x\\y',
      'graphe/x@{1}',
      'graphe/x.',
    ]) {
      expect(isSafeBranchName(bad), bad).toBe(false);
    }
  });

  it('never mints a name it would refuse', () => {
    const words = [
      'fix .. the ~thing^',
      'add [dark] mode?',
      'HEAD*',
      'refactor: the auth/session split',
      '.lock the file',
      'a'.repeat(200),
    ];
    for (const text of words) {
      const name = branchNameFor(text);
      if (name === null) continue;
      expect(isSafeBranchName(name), name).toBe(true);
      expect(name.startsWith('graphe/')).toBe(true);
    }
  });
});

describe('falling back rather than failing', () => {
  it('takes the name when nothing holds it', () => {
    expect(freeName('graphe/dark-mode', nothingTaken)).toBe('graphe/dark-mode');
  });

  it('numbers the name when it is taken', () => {
    const held = new Set(['graphe/dark-mode', 'graphe/dark-mode-2']);
    expect(freeName('graphe/dark-mode', (name) => held.has(name))).toBe('graphe/dark-mode-3');
  });

  it('gives up rather than looping forever', () => {
    expect(freeName('graphe/dark-mode', () => true)).toBeNull();
  });
});

describe('whether to rename at all', () => {
  const neutral = { branch: 'graphe/conversation-4' };

  it('names a neutral branch of ours after the first request', () => {
    expect(renameTo(neutral, 'make the header sticky', nothingTaken)).toBe(
      'graphe/make-header-sticky',
    );
  });

  it('leaves a branch alone once it has been named', () => {
    expect(renameTo({ ...neutral, named: true }, 'something else', nothingTaken)).toBeNull();
  });

  it('leaves a branch alone once it is pushed', () => {
    expect(renameTo({ ...neutral, pushed: true }, 'make it sticky', nothingTaken)).toBeNull();
  });

  it('never touches a branch the person made', () => {
    for (const branch of ['main', 'feat/login', 'graphe-conversation-4', 'conversation-4']) {
      expect(renameTo({ branch }, 'make it sticky', nothingTaken), branch).toBeNull();
    }
  });

  it('never touches one of ours that was made for something else', () => {
    expect(renameTo({ branch: 'graphe/pr-42' }, 'review it', nothingTaken)).toBeNull();
  });

  it('waits when the words name nothing', () => {
    expect(renameTo(neutral, '?!', nothingTaken)).toBeNull();
    expect(renameTo(neutral, '   ', nothingTaken)).toBeNull();
  });

  it('falls back to a number rather than failing on a name in use', () => {
    const held = new Set(['graphe/make-header-sticky']);
    expect(renameTo(neutral, 'make the header sticky', (name) => held.has(name))).toBe(
      'graphe/make-header-sticky-2',
    );
  });

  it('takes the neutral name from the fallback shape too', () => {
    expect(renameTo({ branch: 'graphe/conversation-m9f2k1' }, 'add dark mode', nothingTaken)).toBe(
      'graphe/add-dark-mode',
    );
  });
});

describe('a link is not a name', () => {
  it('drops a URL and names the request instead', () => {
    expect(slugFor('do a PR review for https://github.com/AadiXC0DE/graphe/pull/41'))
      .toBe('pr-review-for');
    expect(slugFor('fix the nav on paper-street.com and ship it')).toBe('fix-nav-on-and-ship-it');
  });

  it('is still a name when the words are only a link', () => {
    // Nothing left to name it after, so the neutral name stands.
    expect(slugFor('https://github.com/AadiXC0DE/graphe/pull/41')).toBeNull();
  });

  it('never comes out longer than a branch list can read', () => {
    const long = slugFor('rewrite the entire authentication and authorisation subsystem end to end');
    expect(long).not.toBeNull();
    expect((long ?? '').length).toBeLessThanOrEqual(44);
  });
});
