/** The advisor settings Graphe keeps right.
 *
 * A live machine ran for months on values written by an older install: a window
 * a single large step could not fit in, secrets travelling unredacted, and one
 * provider hiccup refusing every tool until the app was restarted. The defaults
 * existed the whole time — they were only ever written for keys the file did not
 * already have, and that file had them all.
 *
 * So two things are protected here. That the keys Graphe owns are put right on
 * every start, whatever the file says. And that nothing else in the file is
 * touched, including a key somebody has explicitly taken back.
 */

import { describe, expect, it } from 'vitest';

import {
  GRAPHE_OWNED,
  addonBlockedWords,
  advisorSettings,
  advisorSwitchWords,
  ownedOverrides,
  reconcile,
} from '../src/agent/advisor';

const OPUS = { providerId: 'anthropic', modelId: 'claude-opus-4-5' };

/** The file as it was found on a machine that had been running for months. */
const AS_FOUND = {
  advisor: 'anthropic/claude-opus-4-5',
  alwaysOn: true,
  contextMaxChars: 15_000,
  advisorToolResultMaxLines: 2000,
  advisorToolResultMaxBytes: 51_200,
  advisorRedactSecrets: false,
  advisorLoopThreshold: 3,
  gateFailureMode: 'block-session',
  advisorBlockOnBlocked: true,
  advisorCompletionGate: true,
  // Theirs, and none of our business.
  advisorGitContext: 'full',
  advisorMaxCallsPerSession: 12,
  advisorCustomInvocation: 'the moon is full',
};

describe('the keys Graphe owns', () => {
  it('is a short list, and every one of them is a fault somebody hit', () => {
    expect(GRAPHE_OWNED).toEqual({
      advisorRedactSecrets: true,
      contextMaxChars: 48_000,
      advisorToolResultMaxLines: 60,
      advisorToolResultMaxBytes: 3_000,
      advisorLoopThreshold: 4,
      advisorAutoLoopGate: false,
      advisorCompletionGate: false,
      gateFailureMode: 'warn-and-continue',
      advisorBlockOnBlocked: false,
    });
  });

  it('puts an existing file right rather than reading it as an answer', () => {
    const { settings } = reconcile(AS_FOUND);
    for (const [key, value] of Object.entries(GRAPHE_OWNED)) {
      expect(settings[key], key).toBe(value);
    }
  });

  it('leaves every other key exactly as it was', () => {
    const { settings } = reconcile(AS_FOUND);
    expect(settings['advisorGitContext']).toBe('full');
    expect(settings['advisorMaxCallsPerSession']).toBe(12);
    expect(settings['advisorCustomInvocation']).toBe('the moon is full');
    expect(settings['advisor']).toBe('anthropic/claude-opus-4-5');
    expect(Object.keys(settings).filter((key) => !(key in GRAPHE_OWNED)).sort()).toEqual(
      Object.keys(AS_FOUND).filter((key) => !(key in GRAPHE_OWNED)).sort(),
    );
  });

  it('says what it moved, and says nothing when it moved nothing', () => {
    expect([...reconcile(AS_FOUND).changed].sort()).toEqual(
      [
        'advisorAutoLoopGate',
        'advisorBlockOnBlocked',
        'advisorCompletionGate',
        'advisorLoopThreshold',
        'advisorRedactSecrets',
        'advisorToolResultMaxBytes',
        'advisorToolResultMaxLines',
        'contextMaxChars',
        'gateFailureMode',
      ].sort(),
    );
    const { settings } = reconcile(AS_FOUND);
    expect(reconcile(settings).changed).toEqual([]);
    expect(reconcile({}).changed.length).toBe(Object.keys(GRAPHE_OWNED).length);
  });

  it('writes them into a file that has nothing in it yet', () => {
    const { settings } = reconcile({});
    expect(settings).toEqual({ ...GRAPHE_OWNED });
  });
});

/** The way out for somebody who knows exactly what they want and does not want
 *  it written over every launch. */
describe('a key somebody has taken back', () => {
  const theirs = { ...AS_FOUND, graphe: { ownedOverrides: ['contextMaxChars', 'gateFailureMode'] } };

  it('is left alone, and stays out of what we say we changed', () => {
    const { settings, changed } = reconcile(theirs);
    expect(settings['contextMaxChars']).toBe(15_000);
    expect(settings['gateFailureMode']).toBe('block-session');
    expect(changed).not.toContain('contextMaxChars');
    expect(changed).not.toContain('gateFailureMode');
    // The rest are still ours.
    expect(settings['advisorRedactSecrets']).toBe(true);
    expect(changed).toContain('advisorRedactSecrets');
  });

  it('survives being written through', () => {
    const { settings } = reconcile(theirs);
    expect(settings['graphe']).toEqual({ ownedOverrides: ['contextMaxChars', 'gateFailureMode'] });
  });

  it('is read out of anything, without believing any of it', () => {
    expect(ownedOverrides(theirs)).toEqual(['contextMaxChars', 'gateFailureMode']);
    expect(ownedOverrides({})).toEqual([]);
    expect(ownedOverrides({ graphe: 'yes' })).toEqual([]);
    expect(ownedOverrides({ graphe: { ownedOverrides: 'contextMaxChars' } })).toEqual([]);
    expect(ownedOverrides({ graphe: { ownedOverrides: ['ok', 7, ''] } })).toEqual(['ok']);
  });
});

/** Both are off to begin with: each one stops work that was going fine, and the
 *  one at the end turns "finished" into a list of everything still unproven. */
describe('the two the person can turn on', () => {
  it('are off unless somebody said otherwise', () => {
    const { settings } = reconcile({});
    expect(settings['advisorCompletionGate']).toBe(false);
    expect(settings['advisorAutoLoopGate']).toBe(false);
  });

  it('change the value while the key stays ours', () => {
    const { settings, changed } = reconcile(AS_FOUND, { completionGate: true, loopGate: true });
    expect(settings['advisorCompletionGate']).toBe(true);
    expect(settings['advisorAutoLoopGate']).toBe(true);
    expect(changed).toContain('advisorAutoLoopGate');
    // Turned off again, the key is written again rather than left as it was.
    expect(reconcile(settings, { completionGate: false }).settings['advisorCompletionGate']).toBe(
      false,
    );
  });

  it('are keys Graphe owns, so a switch is never a way out of the list', () => {
    expect('advisorCompletionGate' in GRAPHE_OWNED).toBe(true);
    expect('advisorAutoLoopGate' in GRAPHE_OWNED).toBe(true);
  });
});

describe('the settings written before a turn', () => {
  it('carries the owned keys, the choice, and the switches together', () => {
    const next = advisorSettings(AS_FOUND, {
      advises: OPUS,
      does: null,
      switches: { completionGate: true },
    });
    expect(next['contextMaxChars']).toBe(48_000);
    expect(next['gateFailureMode']).toBe('warn-and-continue');
    expect(next['advisorCompletionGate']).toBe(true);
    expect(next['advisorAutoLoopGate']).toBe(false);
    expect(next['advisor']).toBe('anthropic/claude-opus-4-5');
    expect(next['advisorGitContext']).toBe('full');
  });

  it('puts them right even while the advisor is off, because the file is shared', () => {
    const off = advisorSettings(AS_FOUND, { advises: null, does: null });
    expect(off['gateFailureMode']).toBe('warn-and-continue');
    expect(off['advisorBlockOnBlocked']).toBe(false);
    expect(off['alwaysOn']).toBe(false);
  });

  it('reads a file it cannot make sense of as an empty one', () => {
    expect(advisorSettings('nonsense', { advises: null, does: null })).toEqual({
      ...GRAPHE_OWNED,
      alwaysOn: false,
    });
  });
});

describe('the words on the two switches, and on the notice', () => {
  it('say what happens, not what fires', () => {
    expect(advisorSwitchWords.completionGate.label).toBe('Ask the advisor before saying it’s done');
    expect(advisorSwitchWords.loopGate.label).toBe('Ask when it repeats itself');
    for (const one of Object.values(advisorSwitchWords)) {
      expect(one.hint.length).toBeGreaterThan(30);
      expect(one.hint.endsWith('.')).toBe(true);
    }
  });

  it('tell somebody what stopped and offer both ways out of it', () => {
    expect(addonBlockedWords.what).toMatch(/add-on/i);
    expect(addonBlockedWords.because(5)).toContain('5');
    expect(addonBlockedWords.reset).toBe('Reset it for this conversation');
    expect(addonBlockedWords.off).toBe('Turn it off here');
  });

  it('name no mechanism anywhere', () => {
    const everything = [
      ...Object.values(advisorSwitchWords).flatMap((one) => [one.label, one.hint]),
      addonBlockedWords.what,
      addonBlockedWords.because(3),
      addonBlockedWords.reset,
      addonBlockedWords.off,
    ]
      .join(' ')
      .toLowerCase();
    for (const jargon of ['gate', 'hook', 'tool', 'extension', 'package', 'session', 'threshold']) {
      expect(everything, `says "${jargon}"`).not.toContain(jargon);
    }
  });
});
