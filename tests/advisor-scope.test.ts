/** Two conversations, one advisor setting.
 *
 * `pi-advisor-flow` reads its own settings file and has nowhere to take a
 * per-conversation choice from, so a conversation's choice only takes effect by
 * being written there. It used to be written on every turn, and the last
 * conversation to write won: a chat could be answered by a model nobody chose
 * in it. Now one conversation holds the file while it is open, and another
 * asking for a different advisor is left without a second opinion and told why,
 * rather than quietly being served the first one's model.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
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

describe('the wiring', () => {
  const ADAPTER = readFileSync(
    fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
    'utf8',
  );

  it('writes the file when a conversation takes it, and never on a turn', () => {
    const turn = ADAPTER.slice(ADAPTER.indexOf('async prompt('), ADAPTER.indexOf('async useAdvisor('));
    expect(turn).not.toContain('keepAdvisorSettings');
    expect(ADAPTER).toContain('holdScope(');
    expect(ADAPTER).toContain('letGoScope(');
  });

  it('says out loud when another conversation holds it', () => {
    expect(ADAPTER).toContain("options.onEvent({ type: 'notice', what: taken.because })");
  });

  it('gives it back when the conversation is disposed of', () => {
    const dispose = ADAPTER.slice(ADAPTER.indexOf('dispose(): void {'));
    expect(dispose.slice(0, 900)).toContain('letGoScope(');
  });

  it('takes it at the two moments a choice is made, not before every request', () => {
    expect(ADAPTER.match(/takeTheAdvisor\(/g)?.length).toBe(3);
  });
});
