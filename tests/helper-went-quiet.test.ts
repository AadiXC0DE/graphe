/** A helper that was refused, and said nothing about it.
 *
 * Five reviewers were sent to read a branch. Every `git` they tried was
 * refused, so each of them settled having produced no words, and each reported
 * that it had "finished without saying anything" — which reads as "looked and
 * found nothing" when what happened was "never got to look". The turn above
 * them then wrote a review of a diff nobody had read.
 *
 * The refusal is the whole answer, so it has to travel back with the silence.
 */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { SAID_NOTHING, saidNothingAfterRefusal } from '../src/agent/pi/subagent-runner';
import { HELPER_PATIENCE_MS } from '../src/agent/pi/tools';
import { REVIEWER_TEST_WORDS } from '../src/agent/pi/reviewer-test';

const runner = readFileSync(new URL('../src/agent/pi/subagent-runner.ts', import.meta.url), 'utf8');

/** The beat the child keeps while a step runs, read out of the child rather
 *  than repeated here, so the two cannot drift apart. */
const STEP_BEAT_MS_IN_RUNNER = Number(
  /const STEP_BEAT_MS = ([\d_]+);/.exec(runner)?.[1]?.replace(/_/g, '') ?? '0',
);

describe('what a silenced helper reports', () => {
  it('carries what stopped it, word for word', () => {
    const said = saidNothingAfterRefusal(REVIEWER_TEST_WORDS.readingOnly);
    expect(said).toContain(REVIEWER_TEST_WORDS.readingOnly);
  });

  it('does not read as a helper that looked and found nothing', () => {
    const said = saidNothingAfterRefusal(REVIEWER_TEST_WORDS.onlyOne);
    expect(said).not.toContain('Nothing was found');
    expect(said).toMatch(/could not do what it was asked/i);
  });

  it('tells the one above it what to do instead, rather than leaving it guessing', () => {
    const said = saidNothingAfterRefusal('Some reason.');
    expect(said).toMatch(/job it can do|yourself/i);
  });

  it('keeps the plain sentence for a helper that really did just go quiet', () => {
    expect(SAID_NOTHING).toContain('Nothing was found');
  });

  it('never names the machinery', () => {
    const everything = `${SAID_NOTHING} ${saidNothingAfterRefusal(REVIEWER_TEST_WORDS.onlyOne)}`.toLowerCase();
    for (const banned of ['token', 'api', 'subagent', 'prompt', 'llm', 'stdout', 'json']) {
      expect(everything).not.toContain(banned);
    }
  });
});

describe('the join that fills it in', () => {
  it('remembers the last refusal at the one place refusals happen', () => {
    expect(runner).toContain('if (held !== undefined) lastRefusal = held.reason;');
  });

  it('is declared before the hook that closes over it', () => {
    const declared = runner.indexOf('let lastRefusal: string | null = null;');
    const used = runner.indexOf('lastRefusal = held.reason;');
    expect(declared).toBeGreaterThan(-1);
    expect(declared).toBeLessThan(used);
  });

  it('is what both quiet endings report', () => {
    // The settled path and the nothing-arrived-in-time path, neither left
    // reporting the bare sentence.
    expect(runner.match(/error: nothingSaid\(\)/g)?.length).toBe(2);
    expect(runner).not.toContain('error: SAID_NOTHING');
  });
});

/* The other kind of quiet: a helper that is working hard and saying nothing,
   because the thing taking the time is a step rather than a sentence. */
describe('a helper that is working and silent', () => {
  it('says what step it started, so the quiet is not the only signal', () => {
    expect(runner).toContain("fields.type === 'tool_execution_start'");
    expect(runner).toContain("report({ type: 'step', text: doing })");
  });

  it('keeps saying it while the step runs', () => {
    expect(runner).toContain('const STEP_BEAT_MS = 20_000;');
    expect(runner).toContain('setInterval(');
  });

  it('beats well inside the patience above it, or it is not a heartbeat', () => {
    expect(STEP_BEAT_MS_IN_RUNNER).toBeLessThan(HELPER_PATIENCE_MS / 2);
  });

  it('stops once the step ends, so a stalled provider is still caught', () => {
    expect(runner).toContain("if (fields.type === 'tool_execution_end') stop();");
  });

  it('passes on the step\'s own output as it arrives', () => {
    expect(runner).toContain("if (event.type === 'tool-progress')");
    expect(runner).toContain('saysOutput(event.text)');
  });
});
