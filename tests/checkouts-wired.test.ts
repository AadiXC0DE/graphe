/** The Checkouts band, from the channel that fills it to the press that empties
 *  a copy.
 *
 * The assertion that matters is about the press that removes something. What a
 * card offers to remove is the folder, never the branch, and a copy holding
 * writing no branch is carrying keeps its folder and is told so.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const MAIN = readFileSync(fileURLToPath(new URL('../electron/main.ts', import.meta.url)), 'utf8');
const IPC = readFileSync(fileURLToPath(new URL('../src/lib/ipc.ts', import.meta.url)), 'utf8');
const PRELOAD = readFileSync(fileURLToPath(new URL('../electron/preload.ts', import.meta.url)), 'utf8');
const BRIDGE = readFileSync(fileURLToPath(new URL('../src/lib/bridge.ts', import.meta.url)), 'utf8');
const OVERVIEW = readFileSync(
  fileURLToPath(new URL('../src/components/Overview.tsx', import.meta.url)),
  'utf8',
);

/* -------------------------------------------------------------------------- */
/* The wire                                                                    */
/* -------------------------------------------------------------------------- */

describe('the band reaches the shell', () => {
  const channels = [
    'checkouts',
    'checkoutFront',
    'checkoutLook',
    'checkoutLand',
    'checkoutPutAway',
  ] as const;

  it('names every channel once, in all four places', () => {
    for (const channel of channels) {
      expect(IPC, channel).toContain(`${channel}: 'graphe:`);
      expect(PRELOAD, channel).toContain(`CHANNEL.${channel}`);
      expect(MAIN, channel).toContain(`CHANNEL.${channel}`);
      expect(BRIDGE, channel).toContain(`${channel}: (`);
    }
  });

  it('answers the browser tab rather than refusing, because a tab has no copies', () => {
    const at = BRIDGE.indexOf('checkouts(): Promise<Result<readonly WorkspaceFacts[]>>');
    expect(at).toBeGreaterThan(-1);
    expect(BRIDGE.slice(at, at + 200)).toContain('done([])');
  });

  it('draws the band in the panel, and not in a folder holding several projects', () => {
    expect(OVERVIEW).toContain(
      '{git === null || several ? null : <Checkouts branch={git.branch} busy={busy} />}',
    );
  });
});

describe('what the shell will and will not do to a copy', () => {
  function handlerFor(channel: string): string {
    const at = MAIN.indexOf(`handle<readonly WorkspaceFacts[]>(CHANNEL.${channel}`);
    expect(at, channel).toBeGreaterThan(-1);
    return MAIN.slice(at, at + 1800);
  }

  it('gives the folder back and never deletes the branch', () => {
    const putAway = handlerFor('checkoutPutAway');
    expect(putAway).toContain('putAwayCheckoutAt');
    expect(putAway).not.toContain('dropWorktree');
  });

  it('refuses to put away a copy holding writing its branch does not carry', () => {
    const putAway = handlerFor('checkoutPutAway');
    expect(putAway).toContain('await holdsWork(gitRunHereFor(), one.folder)');
    expect(putAway).toContain('fail(HOLDS_WRITING)');
    expect(MAIN).toContain('const HOLDS_WRITING: Trouble');
    expect(MAIN).toContain('${workspaceWords.holds}');
  });

  it('refuses the same copy the front press, because the folder has to go first', () => {
    expect(handlerFor('checkoutFront')).toContain('fail(HOLDS_WRITING)');
  });

  it('reads a copy’s change through the same reading the review queue opens', () => {
    const at = MAIN.indexOf('handle<string>(CHANNEL.checkoutLook');
    expect(at).toBeGreaterThan(-1);
    const window = MAIN.slice(at, at + 900);
    expect(window).toContain('checkoutForReview');
    expect(window).toContain('sharedBase(gitRunHereFor()');
    expect(window).toContain('reviewDiff(checkout.folder, base)');
  });

  it('lands a card through the same operation the conversation’s own press runs', () => {
    expect(MAIN).toContain('async function landTheCopy(');
    expect(handlerFor('checkoutLand')).toContain('landTheCopy(open, where, one)');
    const at = MAIN.indexOf('handle<null>(CHANNEL.worktreeLand');
    expect(MAIN.slice(at, at + 400)).toContain('landTheCopy(open, where, entry)');
  });

  it('addresses a card by the copy it names, not by whichever conversation is in front', () => {
    expect(MAIN).toContain('function copyNamed(');
    expect(handlerFor('checkoutPutAway')).toContain('copyNamed(open, address)');
  });

  it('remembers which conversations have a card nobody has answered', () => {
    expect(MAIN).toContain('const askingSomebody = new Set<string>()');
    expect(MAIN).toContain('function holdForAnswer(');
    expect(MAIN).toContain('continuations.waiting(project, address, on)');
    expect(MAIN).toContain("askingSomebody.has(keyOf(repo, address))\n        ? 'asking'");
  });
});

