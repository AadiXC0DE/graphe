/**
 * A conversation working on its own copy, and the two ways out of it.
 *
 * The failure guarded here is work that cannot be reached. A second
 * conversation in a project is given a copy to write in; putting it down keeps
 * everything it wrote but hands the folder back, so the work sits in a copy
 * with nothing on screen to bring it home or throw it out. Both ways out were
 * declared, plumbed across the shell and handled — and called by nobody, which
 * is the same as not existing.
 *
 * After that, three ways the controls themselves could go wrong: appearing over
 * a conversation somebody else is still working in; a press that names no
 * conversation, which the shell answers about whichever is in front — and one
 * of the two presses deletes; and an "are you sure" left standing while the
 * screen moves on to another conversation.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { keepAsking, offersOwnCopy, OWN_COPY_WORDS, ownCopyWhere } from '../src/lib/owncopy';

const HERE = '/one/conversation';
const OTHER = '/another/conversation';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');

const MAIN = read('../electron/main.ts');
const SIDEBAR = read('../src/components/Sidebar.tsx');

/**
 * Everything the window is made of, as one piece of text.
 *
 * Minus the two files that only describe the shell's surface: a method named in
 * the contract and forwarded by the bridge is still a method nothing calls, and
 * that is exactly what this is looking for.
 */
function windowSource(): string {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const skip = new Set([join(root, 'lib', 'ipc.ts'), join(root, 'lib', 'bridge.ts')]);
  const parts: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (/\.tsx?$/.test(entry.name) && !skip.has(path)) parts.push(readFileSync(path, 'utf8'));
    }
  };
  walk(root);
  return parts.join('\n');
}

const WINDOW = windowSource();

/* ========================================================================== */
/* OC-01 the work in a copy can be reached at all                              */
/* ========================================================================== */

describe('OC-01 the two ways out of a copy', () => {
  /* The original defect, in one line: both existed the whole way down and
     neither had a caller, so a parallel conversation's work was stranded. */
  it('are pressed from somewhere in the window, not only declared', () => {
    expect(WINDOW).toMatch(/worktreeLand\s*\(/);
    expect(WINDOW).toMatch(/worktreeDrop\s*\(/);
  });

  /* The name is not decoration: unnamed, the shell acts on whichever
     conversation is in front, and one of the two deletes a folder. */
  it('name the conversation they act on', () => {
    expect(ownCopyWhere(HERE)).toEqual({ conversation: HERE });
    expect(ownCopyWhere(OTHER).conversation).toBe(OTHER);
    expect(WINDOW).toMatch(/worktreeLand\s*\(\s*ownCopyWhere\(/);
    expect(WINDOW).toMatch(/worktreeDrop\s*\(\s*ownCopyWhere\(/);
  });
});

/* ========================================================================== */
/* OC-02 the window is told the fact, rather than guessing at it               */
/* ========================================================================== */

describe('OC-02 which conversation has a copy', () => {
  /* Which conversations work in a copy is a note kept in the shell alone. A
     control that guesses either offers to bring back nothing, or never shows. */
  it('is answered along with the conversation being opened', () => {
    expect(MAIN).toMatch(/ownCopy:/);
  });

  it('is the real fact and never a fixed answer', () => {
    expect(MAIN).not.toMatch(/ownCopy:\s*(?:true|false)\b/);
    expect(MAIN).toMatch(/ownCopy:[^,\n]*checkout/);
  });
});

/* ========================================================================== */
/* OC-03 which row is allowed to offer them                                    */
/* ========================================================================== */

describe('OC-03 where the offer appears', () => {
  it('appears on the conversation on screen when it has a copy', () => {
    expect(offersOwnCopy(HERE, HERE, true)).toBe(true);
  });

  /* Offered on another row, the destructive one points at work somebody else
     is still doing — the shell only ever answered about the one in front. */
  it('never appears on any other conversation in the list', () => {
    expect(offersOwnCopy(OTHER, HERE, true)).toBe(false);
    expect(offersOwnCopy(HERE, OTHER, true)).toBe(false);
  });

  /* Almost every conversation writes in the project folder itself. Offering to
     bring back work from a copy that does not exist is an offer to do nothing. */
  it('stays away when the conversation has no copy of its own', () => {
    expect(offersOwnCopy(HERE, HERE, false)).toBe(false);
    expect(offersOwnCopy(OTHER, HERE, false)).toBe(false);
  });

  it('stays away when nothing is on screen at all', () => {
    expect(offersOwnCopy(HERE, null, true)).toBe(false);
  });
});

/* ========================================================================== */
/* OC-04 the question that stands before something is deleted                  */
/* ========================================================================== */

describe('OC-04 an "are you sure" that has been left behind', () => {
  it('stands while its own conversation is the one on screen', () => {
    expect(keepAsking(HERE, HERE)).toBe(HERE);
  });

  /* Somebody answering a question is answering the one they were asked. A
     question raised over one conversation and answered over another deletes
     work nobody asked about. */
  it('comes down the moment the screen moves to another conversation', () => {
    expect(keepAsking(HERE, OTHER)).toBeNull();
    expect(keepAsking(HERE, null)).toBeNull();
  });

  it('is nothing at all when none was raised', () => {
    expect(keepAsking(null, HERE)).toBeNull();
    expect(keepAsking(null, null)).toBeNull();
  });
});

/* ========================================================================== */
/* OC-05 what it says                                                          */
/* ========================================================================== */

describe('OC-05 the words on the controls', () => {
  const visible = [
    OWN_COPY_WORDS.says,
    OWN_COPY_WORDS.bring,
    OWN_COPY_WORDS.bringHint,
    OWN_COPY_WORDS.away,
    OWN_COPY_WORDS.awayHint,
    OWN_COPY_WORDS.sure,
    OWN_COPY_WORDS.yes,
    OWN_COPY_WORDS.no,
  ];

  /* The machinery under this is a worktree and a merge, and the controls say
     so — talking around it left people guessing what "the work" meant. */
  it('names the operation it performs', () => {
    expect(OWN_COPY_WORDS.says).toMatch(/worktree/i);
    expect(OWN_COPY_WORDS.bring).toMatch(/merge/i);
    expect(OWN_COPY_WORDS.away).toMatch(/delete/i);
  });

  it('stops short of the plumbing under it', () => {
    for (const said of visible) {
      expect(said, said).not.toMatch(/\b(refspec|HEAD|SHA|blob|stderr|exit code)\b/i);
    }
  });

  /* Throwing work away cannot be undone, and a question that does not say so is
     a question people answer without reading. */
  it('says out loud that throwing the work away is final', () => {
    expect(OWN_COPY_WORDS.sure).toMatch(/no getting it back/i);
  });

  it('lives in one place rather than being written into the shelf', () => {
    expect(SIDEBAR).toContain('OWN_COPY_WORDS');
    for (const said of visible) expect(SIDEBAR, said).not.toContain(said);
  });
});
