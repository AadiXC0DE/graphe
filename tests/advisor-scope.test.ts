/** Two conversations, one advisor setting.
 *
 * `pi-advisor-flow` reads its own settings file and has nowhere to take a
 * per-conversation choice from, so a conversation's choice only takes effect by
 * being written there. It used to be written on every turn, and the last
 * conversation to write won: a chat could be answered by a model nobody chose
 * in it.
 *
 * The plan prefers a per-conversation setting and allows this serialization
 * where Pi has no seam for one, as long as the limitation is labelled. Pi 0.85.1
 * has no such seam: `CreateAgentSessionOptions` carries a model and a thinking
 * level, not an extension's settings, and `ExtensionAPI` has no per-session
 * settings object. So this is `AdvisorFile`, driven for real here rather than
 * asserted from the adapter's source text: the second conversation must not
 * reach the file, and must be told why in words.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  AdvisorFile,
  advisorScopeWords,
  holdScope,
  letGoScope,
  noScope,
  sameChoice,
  saysChoice,
  type AdvisorChoice,
} from '../src/agent/advisor';

const opus = { providerId: 'anthropic', modelId: 'opus' };
const gpt = { providerId: 'openai', modelId: 'gpt-5' };

const chosen = (advises: typeof opus | null): AdvisorChoice => ({
  advises,
  does: opus,
  thinks: 'medium',
  gates: { completionGate: false, loopGate: false },
});

describe('the machine’s one advisor file', () => {
  it('is nobody’s until a conversation asks for it', () => {
    const first = holdScope(noScope(), 'a', chosen(opus));
    expect(first.granted).toBe(true);
    expect(first.scope.owner).toBe('a');
    expect(first.because).toBeNull();
  });

  it('does not hand the file, or the model, to a second conversation', () => {
    const held = holdScope(noScope(), 'a', chosen(opus)).scope;
    const second = holdScope(held, 'b', chosen(gpt));
    expect(second.granted).toBe(false);
    expect(second.scope.owner).toBe('a');
    expect(second.because).toBe(
      advisorScopeWords.held(saysChoice(chosen(gpt)), saysChoice(chosen(opus))),
    );
    // Nothing of the first conversation's choice moved.
    expect(second.scope.holds?.advises).toEqual(opus);
  });

  /* The same setting in two conversations is nobody being served somebody
     else's model, so it is not worth refusing. */
  it('lets two conversations share one setting', () => {
    const held = holdScope(noScope(), 'a', chosen(opus)).scope;
    const second = holdScope(held, 'b', chosen(opus));
    expect(second.granted).toBe(true);
    expect(second.scope.owner).toBe('a');
  });

  it('lets the holder change its own mind', () => {
    const held = holdScope(noScope(), 'a', chosen(opus)).scope;
    const changed = holdScope(held, 'a', chosen(gpt));
    expect(changed.granted).toBe(true);
    expect(changed.scope.holds?.advises).toEqual(gpt);
  });

  it('gives the file back when the holder is finished with it', () => {
    const held = holdScope(noScope(), 'a', chosen(opus)).scope;
    expect(letGoScope(held, 'b')).toBe(held);
    const free = letGoScope(held, 'a');
    expect(free.owner).toBeNull();
    expect(holdScope(free, 'b', chosen(gpt)).granted).toBe(true);
  });

  it('compares choices by what would be written, not by identity', () => {
    expect(sameChoice(chosen(opus), chosen(opus))).toBe(true);
    expect(sameChoice(chosen(opus), chosen(gpt))).toBe(false);
    expect(sameChoice(chosen(opus), { ...chosen(opus), thinks: 'high' })).toBe(false);
    expect(sameChoice(null, null)).toBe(true);
  });

  it('says off as a real answer rather than a blank', () => {
    expect(saysChoice({ advises: null, does: null })).toBe('off');
    expect(saysChoice(chosen(opus))).toBe('anthropic/opus');
  });
});

/* The whole point of the plan's clause: one chat selecting an advisor must not
   change another chat's provider/model. Driven through the same object the
   adapter uses, with the write spied on, because "did not reach the file" is
   only true if nothing was written. */
describe('two conversations at once', () => {
  it('writes once for the holder, and never for the one that was refused', async () => {
    const file = new AdvisorFile();
    const wrote = vi.fn(async () => undefined);

    const held = await file.take('a', chosen(opus), wrote);
    expect(held.granted).toBe(true);
    expect(wrote).toHaveBeenCalledTimes(1);

    const refused = await file.take('b', chosen(gpt), wrote);
    expect(refused.granted).toBe(false);
    // The file still holds the first conversation's choice, and nothing wrote
    // over it: this is the defect the plan names, gone.
    expect(file.scope.holds?.advises).toEqual(opus);
    expect(wrote).toHaveBeenCalledTimes(1);
  });

  it('tells the one that was refused what happened, in words naming both models', async () => {
    const file = new AdvisorFile();
    await file.take('a', chosen(opus), async () => undefined);

    const refused = await file.take('b', chosen(gpt), async () => undefined);
    expect(refused.because).toContain('another conversation is using it for anthropic/opus');
    expect(refused.because).toContain('asked for openai/gpt-5');
  });

  it('lets the second one through once the holder is finished', async () => {
    const file = new AdvisorFile();
    await file.take('a', chosen(opus), async () => undefined);
    file.release('a');
    expect(file.scope).toEqual(noScope());

    const second = await file.take('b', chosen(gpt), async () => undefined);
    expect(second.granted).toBe(true);
    expect(file.scope.owner).toBe('b');
  });

  /* A conversation that was never the holder giving the file back is how one
     chat would silently take another's choice away. */
  it('is not given back by a conversation that does not hold it', async () => {
    const file = new AdvisorFile();
    await file.take('a', chosen(opus), async () => undefined);
    file.release('b');
    expect(file.scope.owner).toBe('a');
    expect(file.scope.holds?.advises).toEqual(opus);
  });

  /* Two conversations starting together used to interleave two half-written
     files, and the addition reads this file between the two. */
  it('writes one at a time, in the order they were asked for', async () => {
    const file = new AdvisorFile();
    const order: string[] = [];
    let release = (): void => undefined;
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = file.write(async () => {
      order.push('first in');
      await blocked;
      order.push('first out');
    });
    const second = file.write(async () => {
      order.push('second');
    });

    // The second write has not begun while the first is still inside.
    await Promise.resolve();
    expect(order).toEqual(['first in']);
    release();
    await Promise.all([first, second]);
    expect(order).toEqual(['first in', 'first out', 'second']);
  });

  it('carries on after a write that failed', async () => {
    const file = new AdvisorFile();
    await file.write(async () => {
      throw new Error('the disk said no');
    });
    const after = vi.fn(async () => undefined);
    await file.write(after);
    expect(after).toHaveBeenCalledTimes(1);
  });
});

/* What the screen says, which is the plan's other half: the limitation has to
   be somewhere a person reads, not only in a comment. */
describe('the limitation, said on the advisor’s own row', () => {
  it('names the one setting before anybody holds it', () => {
    expect(advisorScopeWords.oneSetting).toContain('one advisor setting for this whole computer');
    expect(advisorScopeWords.oneSetting).toContain('until that conversation closes');
  });

  it('says whether this conversation is the one holding it', () => {
    expect(advisorScopeWords.ours('anthropic/opus')).toContain('This conversation holds');
    expect(advisorScopeWords.inUse('anthropic/opus')).toContain('Another conversation holds');
  });
});
