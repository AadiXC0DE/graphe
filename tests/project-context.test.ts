// @vitest-environment jsdom
/** What the project shares with every chat in it.
 *
 * Two lists with two owners, and the difference between them is the whole
 * point: a reference belongs to the conversation it was brought into and
 * travels nowhere by itself, while what the project shares is handed to the
 * shell with every turn, so a chat nobody has sent in yet is given it too.
 *
 * The shell half is tested as a pure function over what the window sends it —
 * that argument crosses the bridge, so it is not trusted.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  MOST_SHARED,
  projectContextBlock,
  projectContextWords,
  sharedFrom,
} from '../src/agent/pi/project-context';
import {
  keepShared,
  keptShared,
  onlyInThisChat,
  sharingWithProject,
  sharedKey,
} from '../src/lib/shared-context';
import { APP_NOTICE } from '../src/lib/ipc';
import { appWideFor } from '../electron/appwide';
import { gitIsMissing, keptAppWide, stillShowing } from '../src/lib/app-wide';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

beforeEach(() => {
  localStorage.clear();
});

const BRIEF = { id: 'p1', name: 'the brief.pdf', note: 'what the site is for' };
const STYLE = { id: 'p2', name: 'house style.md', note: '' };

describe('what reaches a turn', () => {
  it('carries the project’s items, named as the project’s and not this chat’s', () => {
    const said = projectContextBlock([BRIEF, STYLE]);
    expect(said).not.toBeNull();
    expect(said).toContain(projectContextWords.open);
    expect(said).toContain(projectContextWords.close);
    // The item and its note on one line; how the two are separated is copy.
    const brief = (said ?? '').split('\n').find((one) => one.includes('the brief.pdf'));
    expect(brief).toContain('what the site is for');
    expect(said).toContain('- house style.md');
    // The sentence that keeps a model from reading it as something the person
    // in front of it just sent.
    expect(said).toContain(projectContextWords.lede);
  });

  it('says nothing at all when the project shares nothing', () => {
    expect(projectContextBlock([])).toBeNull();
    expect(projectContextBlock([{ id: 'x', name: '   ', note: '' }])).toBeNull();
  });

  /* A list somebody pasted in twice is one item, and a list longer than a turn
     can carry says how much did not fit rather than dropping it in silence. */
  it('bounds what it carries and names the rest', () => {
    const many = Array.from({ length: MOST_SHARED + 3 }, (_, at) => ({
      id: `p${String(at)}`,
      name: `doc-${String(at)}.md`,
      note: '',
    }));
    const said = projectContextBlock(many) ?? '';
    expect(said).toContain(projectContextWords.more(3));
    expect(said).toContain(`- doc-${String(MOST_SHARED - 1)}.md`);
    expect(said).not.toContain(`- doc-${String(MOST_SHARED)}.md`);
  });
});

describe('what the window sends', () => {
  it('is read for the right shape and nothing else', () => {
    const read = sharedFrom([
      BRIEF,
      { id: 'p3', name: 7 },
      null,
      'the brief.pdf',
      { id: 'p4', note: 'no name' },
      { id: 'p5', name: 'a real one.pdf', note: 12 },
    ]);
    expect(read.map((one) => one.name)).toEqual(['the brief.pdf', 'a real one.pdf']);
    expect(read[1]?.note).toBe('');
  });

  it('is one row per thing, however many times it is sent', () => {
    expect(sharedFrom([BRIEF, { ...BRIEF, name: 'the brief.pdf' }]).length).toBe(1);
  });

  it('is nothing at all when the window sends nothing a project would share', () => {
    expect(sharedFrom(null)).toEqual([]);
    expect(sharedFrom('the brief.pdf')).toEqual([]);
    expect(sharedFrom({})).toEqual([]);
  });
});

describe('the list a project keeps', () => {
  it('is one key per project, so two folders never show each other’s', () => {
    expect(sharedKey('/work/atlas')).not.toBe(sharedKey('/work/other'));
    keepShared('/work/atlas', [BRIEF]);
    expect(keptShared('/work/atlas')).toEqual([BRIEF]);
    expect(keptShared('/work/other')).toEqual([]);
  });

  it('survives being written down and read back', () => {
    keepShared('/work/atlas', [BRIEF, STYLE]);
    expect(keptShared('/work/atlas')).toEqual([BRIEF, STYLE]);
    keepShared('/work/atlas', []);
    expect(keptShared('/work/atlas')).toEqual([]);
  });

  it('reads nothing out of something that is not a list', () => {
    localStorage.setItem(sharedKey('/work/atlas'), '{not json');
    expect(keptShared('/work/atlas')).toEqual([]);
    localStorage.setItem(sharedKey('/work/atlas'), '{"id":"p1"}');
    expect(keptShared('/work/atlas')).toEqual([]);
  });

  /* Sharing is a press and not a side effect: a chat's own reference becoming a
     project item by itself would be the app claiming it had handed something to
     every chat that nobody asked it to. */
  it('only grows when somebody shares something', () => {
    const one = { id: 'r1', kind: 'image' as const, name: 'the mock.png', note: 'PNG' };
    expect(keptShared('/work/atlas')).toEqual([]);
    expect(sharingWithProject([], { id: one.id, name: one.name, note: one.note })).toEqual([
      { id: 'r1', name: 'the mock.png', note: 'PNG' },
    ]);
  });

  it('is not grown twice by sharing the same thing twice', () => {
    const once = sharingWithProject([], BRIEF);
    expect(sharingWithProject(once, BRIEF)).toBe(once);
  });

  /* Taking one off the project's list does not put it into the chat that took
     it out. Whether this chat was ever given it is the chat's record. */
  it('gives an item up without inventing a reference for it', () => {
    const left = onlyInThisChat([BRIEF, STYLE], BRIEF.id);
    expect(left).toEqual([STYLE]);
    expect(onlyInThisChat([BRIEF], 'not-there')).toEqual([BRIEF]);
  });
});

describe('what is missing from this machine', () => {
  it('is named for the two things that stand in the way, and nothing else', () => {
    expect(appWideFor({ git: false, npm: false }).map((one) => one.id)).toEqual([
      APP_NOTICE.noGit,
      APP_NOTICE.noNpm,
    ]);
    expect(appWideFor({ git: true, npm: false }).map((one) => one.id)).toEqual([APP_NOTICE.noNpm]);
    expect(appWideFor({ git: false, npm: true }).map((one) => one.id)).toEqual([APP_NOTICE.noGit]);
  });

  it('is not said at all when nothing is missing', () => {
    expect(appWideFor({ git: true, npm: true })).toEqual([]);
  });

  it('is one row however many times it is found out', () => {
    const twice = appWideFor({ git: false, npm: true }).reduce(keptAppWide, []);
    expect(appWideFor({ git: false, npm: true }).reduce(keptAppWide, twice).length).toBe(1);
  });

  /* Read from the whole list rather than the drawn one: putting the sentence
     away is not the machine finding git. */
  it('stands the git presses down even after the sentence is put away', () => {
    const facts = appWideFor({ git: false, npm: true });
    expect(gitIsMissing(facts)).toBe(true);
    expect(stillShowing(facts, [APP_NOTICE.noGit])).toEqual([]);
    expect(gitIsMissing(facts)).toBe(true);
    expect(gitIsMissing(appWideFor({ git: true, npm: true }))).toBe(false);
  });
});

/* The routing: nothing in this is about the wording of a sentence. */
describe('where an app-wide fact is said', () => {
  // `import.meta.url` is not a file URL under jsdom, so the sources are read
  // from the working directory vitest runs in.
  const main = readFileSync(join(process.cwd(), 'electron', 'main.ts'), 'utf8');
  const app = readFileSync(join(process.cwd(), 'src', 'App.tsx'), 'utf8');

  /* It used to be sent into a conversation, as a `notice` event with no
     project. The window files a notice under the desk in front, and on a first
     launch there is no desk — so the sentence was dropped and the window said
     nothing about the missing git at all. */
  it('is sent app-wide by the shell rather than into a conversation', () => {
    expect(main).not.toContain('GIT_MISSING');
    expect(main).toContain('sayAppWide(one)');
    expect(main).toContain('CHANNEL.appNotice');
    expect(main).toContain('CHANNEL.appNotices');
  });

  it('is asked for as well as pushed, because the push can be missed', () => {
    expect(app).toContain('bridge.appNotices()');
    expect(app).toContain('bridge.onAppNotice(');
  });

  /* Drawn in the column, above the branch that decides what is open — so it is
     there on the start screen, with no project and no conversation. */
  it('is drawn before anything that depends on what is open', () => {
    const drawn = app.indexOf('<AppWide');
    expect(drawn).toBeGreaterThan(-1);
    const welcome = app.indexOf('<Welcome');
    const thread = app.indexOf('<ThreadRows');
    expect(drawn).toBeLessThan(welcome);
    expect(drawn).toBeLessThan(thread);
  });

  it('comes back with the turn and not only with a chat somebody has written in', () => {
    expect(app).toContain('context: shared');
    expect(main).toContain('projectContextBlock(');
    expect(main).toContain('withContext');
  });
});
