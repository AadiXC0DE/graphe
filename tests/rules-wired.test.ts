/** The project's rules, actually reaching a tool call.
 *
 * The rules module is pure and tested on its own. What this guards is the join:
 * a rules layer that is written, tested and never consulted is the shape this
 * repo has already shipped seven times — plumbed end to end with no caller.
 *
 * Two claims matter and neither is provable from the pure module alone. A rule
 * must be able to make the Guard's answer harder at the moment a call is
 * judged; and it must not be skippable by somebody turning their own questions
 * off, because the top rung is a decision about the Guard and a project's rules
 * are a decision the team made.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { createGuardInterceptor } from '../src/agent/pi/adapter';
import { atTheEnd, readRules, type Rules } from '../src/agent/hooks';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { ToolCall } from '../src/agent/types';
import type { Decision } from '../src/agent/pi/adapter';

const ROOT = '/Users/mira/Projects/portfolio';

/** A rules file a person could plausibly have written. */
const HOUSE = readRules(
  JSON.stringify({
    rules: [
      {
        name: 'The design system is hand-edited',
        when: 'before',
        it: 'changes files',
        under: ['src/design'],
        then: 'refuse',
        because: 'These files are the design system.',
      },
    ],
  }),
);

function interceptor(over: {
  howFar?: GuardFacts['howFar'];
  rules?: Rules;
  answer?: Decision;
}) {
  const asked: ToolCall[] = [];
  const blocked: string[] = [];
  const review = createGuardInterceptor({
    facts: { projectRoot: ROOT, ...(over.howFar === undefined ? {} : { howFar: over.howFar }) },
    relay: {
      started: () => undefined,
      blocked: (_call: ToolCall, why: string) => blocked.push(why),
      asking: () => undefined,
      finished: () => undefined,
    } as never,
    confirmations: {
      ask: (call: ToolCall) => {
        asked.push(call);
        return Promise.resolve(over.answer ?? 'yes');
      },
    } as never,
    ...(over.rules === undefined ? {} : { rules: (): Rules => over.rules as Rules }),
  });
  return { review, asked, blocked };
}

const writeToDesign: ToolCall = {
  id: 'call-1',
  name: 'write',
  input: { path: `${ROOT}/src/design/tokens.css`, content: 'a {}' },
};

describe('a project’s own rules, at the moment a call is judged', () => {
  it('refuses a call the Guard would have let through', async () => {
    const plain = interceptor({});
    const withRules = interceptor({ rules: HOUSE });

    // Same call, same facts. The only difference is the rules file.
    const without = await plain.review(writeToDesign);
    const stopped = await withRules.review(writeToDesign);

    expect(stopped?.block).toBe(true);
    expect(stopped?.reason).toMatch(/design system/i);
    // And the rule is why: without it this call does not end in a refusal.
    expect(without?.block ?? false).toBe(false);
  });

  it('says which rule stopped it, in the rule’s own words', async () => {
    const { review } = interceptor({ rules: HOUSE });
    const said = await review(writeToDesign);
    expect(said?.reason).toContain('The design system is hand-edited');
  });

  it('leaves a call no rule mentions alone', async () => {
    const { review } = interceptor({ rules: HOUSE });
    const elsewhere: ToolCall = {
      id: 'call-2',
      name: 'write',
      input: { path: `${ROOT}/src/pages/index.tsx`, content: 'x' },
    };
    expect((await review(elsewhere))?.block ?? false).toBe(false);
  });

  /** The rung is a person's choice about being asked. It is not a way to get
   *  out of what the project itself has agreed — otherwise "never publish by
   *  hand" is undone by a setting nobody connected to it. */
  it('still applies when somebody has turned their own questions off', async () => {
    const { review } = interceptor({ howFar: 'doing', rules: HOUSE });
    const said = await review(writeToDesign);
    expect(said?.block).toBe(true);
    expect(said?.reason).toMatch(/design system/i);
  });

  it('still lets everything else through on that rung', async () => {
    const { review } = interceptor({ howFar: 'doing', rules: HOUSE });
    const reading: ToolCall = { id: 'call-3', name: 'read', input: { path: `${ROOT}/README.md` } };
    expect(await review(reading)).toBeUndefined();
  });

  /** A project with no rules must behave exactly as it did before any of this
   *  existed — the whole layer is opt-in by the file being there. */
  it('changes nothing at all for a project that carries none', async () => {
    const none = readRules(null);
    const { review } = interceptor({ rules: none });
    expect((await review(writeToDesign))?.block ?? false).toBe(false);
  });
});

/** The end-of-turn rules had the same fault the before-a-call ones did: written,
 *  tested, and never consulted. `atTheEnd` had no caller anywhere in `src/` or
 *  `electron/`, so the brief's own example rule — "nothing goes back broken" —
 *  was recorded correctly and never once asked. */
describe('what the rules make of a turn that just ended', () => {
  const END = readRules(
    JSON.stringify({
      rules: [
        {
          name: 'Nothing goes back broken',
          when: 'at the end',
          needs: 'tests',
          then: 'refuse',
          because: 'A red run is not finished work.',
        },
      ],
    }),
  );

  it('holds the turn when the check it names has not passed', () => {
    const said = atTheEnd(END, {});
    expect(said.hold.length).toBe(1);
    expect(said.hold[0]).toMatch(/red run/i);
  });

  it('lets it go once the check has passed', () => {
    expect(atTheEnd(END, { checks: { tests: { passing: true } } }).hold).toEqual([]);
  });

  /** A check nobody ran is not a check that passed. */
  it('holds on not knowing, exactly as it holds on failing', () => {
    expect(atTheEnd(END, {}).hold.length).toBe(1);
    expect(atTheEnd(END, { checks: { tests: { passing: false } } }).hold.length).toBe(1);
  });

  it('is actually consulted when a turn settles', () => {
    const source = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
    // The call, not the declaration: matching the bare name passes on a file
    // that defines the function and never calls it, which is the whole bug.
    // Inside the settled branch, not merely defined somewhere in the file —
    // matching the bare name passes on a file that defines the function and
    // never calls it, which is the whole bug this guards.
    const settled = source.slice(source.indexOf("if (event.type === 'settled')"));
    const branch = settled.slice(0, settled.indexOf('\n    }'));
    expect(branch).toMatch(/^\s*sayWhatTheRulesHeld\(\);/m);
    expect(source).toMatch(/atTheEnd\(house, desk\.world\(\)\)/);
  });

  /** Saying it forever is its own failure: a rule naming a check that can never
   *  pass would end every turn of the sitting with the same paragraph. */
  it('stops saying it after a few turns rather than every turn', () => {
    const source = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
    expect(source).toMatch(/heldAlready >= MOST_HELD_SAYINGS/);
  });
});

describe('after rules are wired into the live tool loop', () => {
  const ADAPTER = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');
  const EVENTS = readFileSync(new URL('../src/agent/pi/events.ts', import.meta.url), 'utf8');

  it('keeps the original call until tool-end and calls afterCall only on success', () => {
    expect(EVENTS).toContain('private readonly running = new Map<string, ToolCall>()');
    expect(EVENTS).toContain('this.onToolEnd?.({');
    expect(ADAPTER).toContain('if (ok && call !== undefined) handleAfterCall(call)');
    expect(ADAPTER).toContain('const after = afterCall(call, house, desk.world())');
  });

  it('has a host-owned repair cap and steers only while Pi is still streaming', () => {
    expect(ADAPTER).toContain('const repairs = new RepairCoordinator()');
    expect(ADAPTER).toContain('repairs.try({ check');
    expect(ADAPTER).toContain('if (!session.isStreaming) return');
    expect(ADAPTER).toContain('await session.steer(text)');
  });

  it('surfaces broken and skipped rules instead of silently dropping them', () => {
    expect(ADAPTER).toContain('RULE_WORDS.fileTrouble(house.trouble)');
    expect(ADAPTER).toContain('...house.skipped');
    expect(ADAPTER).toContain('sayRulesDiagnostics()');
  });
});

/** Checks going stale when nothing asked the Guard.
 *
 * `forgetChecks` on the interceptor covers every call the model makes. It does
 * not cover the three ways a project's files move with no tool call involved:
 * work taken off the board and written in from a copy, going back to an earlier
 * moment, and a person's own editor. A check that passed before any of those
 * passed against files that are no longer there — and a rule reading it would
 * hold or release a turn on a reading about the past.
 */
describe('checks let go when the files move underneath them', () => {
  const MAIN = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');
  const ADAPTER = readFileSync(new URL('../src/agent/pi/adapter.ts', import.meta.url), 'utf8');

  it('gives the shell a way to say so at all', () => {
    // The desk lives inside the session's closure, so without this the shell
    // cannot reach it however much it knows the files moved.
    expect(ADAPTER).toMatch(/forgetChecks\(\): void \{\s*desk\.forget\(\);/);
  });

  it('tells every conversation in the project, not only the one in front', () => {
    // Each conversation holds its own desk; telling one leaves the rest reading
    // answers about files that have since been written over.
    expect(MAIN).toMatch(/for \(const one of open\.held\.sessions\.open\) one\.held\.forgetChecks\(\);/);
  });

  it('says so after going back to an earlier moment', () => {
    const at = MAIN.indexOf('await open.held.timeline.restoreTo(versionId)');
    expect(at).toBeGreaterThan(-1);
    expect(MAIN.slice(at, at + 200)).toContain('filesMovedIn(open)');
  });

  it('says so when work is taken in, one piece or a whole set', () => {
    // Both write into the project from a copy, and neither passes a tool call
    // through the Guard on the way.
    expect(MAIN.split('filesMovedIn(open)').length - 1).toBeGreaterThanOrEqual(3);
  });
});
