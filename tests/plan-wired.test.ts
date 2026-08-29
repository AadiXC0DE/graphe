/** A plan somebody argued with, actually reaching the agent.
 *
 * The card can be rearranged, struck, annotated and answered — and every one of
 * those is lost unless the message that goes back carries it. A card that reads
 * as an argument while the agent receives the original plan is worse than no
 * argument at all: the person believes they changed the work and they did not.
 *
 * The second claim guarded here is about the default. "Get on with it" answers
 * an unanswered plan the moment it lands, which is right for a plan nobody was
 * waiting on — and wrong for one that asked a question, because answering your
 * own question is not asking one.
 */

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { decidedMessage, type PlanDecision } from '../src/agent/plan';
import { planned } from '../src/lib/thread';

const STEPS = ['Read the tokens', 'Rebuild the header', 'Check every width'];

function decision(over: Partial<PlanDecision> = {}): PlanDecision {
  return {
    kept: STEPS.map((step) => ({ step })),
    dropped: [],
    reordered: false,
    answers: [],
    ...over,
  } as PlanDecision;
}

describe('what travels back when a plan was argued with', () => {
  /** The common case. Somebody read it, agreed, pressed — their own sentence
   *  goes as they typed it, with nothing appended explaining itself. */
  it('says nothing extra when the plan was agreed as proposed', () => {
    expect(decidedMessage(decision())).toBeNull();
  });

  it('names what to leave out when a step was struck', () => {
    const said = decidedMessage(decision({ dropped: ['Check every width'] }));
    expect(said).not.toBeNull();
    expect(said).toContain('Check every width');
  });

  /** Moving a step is a change to the work even though every step survives.
   *  A message that only lists what to do loses it entirely. */
  it('says so when the steps were put in a different order', () => {
    expect(decidedMessage(decision({ reordered: true }))).not.toBeNull();
  });

  it('carries what was said about a step', () => {
    const said = decidedMessage(
      decision({ kept: [{ step: STEPS[0] as string, note: 'Use the new scale' }] }),
    );
    expect(said).toContain('Use the new scale');
  });
});

describe('a plan that asked something', () => {
  it('keeps the questions on the turn, where the card can draw them', () => {
    const turn = planned('rebuild the header', {
      steps: STEPS,
      caveats: [],
      questions: ['Which header — the site or the app?'],
    });
    expect(turn.kind).toBe('plan');
    if (turn.kind !== 'plan') return;
    expect(turn.questions).toEqual(['Which header — the site or the app?']);
  });

  /** A plan with no questions is the ordinary one, and must stay ordinary —
   *  an empty list rather than an absent field, so nothing has to guess. */
  it('is an empty list when nothing was asked', () => {
    const turn = planned('x', { steps: STEPS, caveats: [] });
    if (turn.kind !== 'plan') return;
    expect(turn.questions).toEqual([]);
  });
});

/** The tests above prove the pure side. They do NOT prove the window uses it —
 *  deleting the call in `App.tsx` leaves every one of them passing, which is
 *  exactly the shape of vacuous test this repo has already shipped. `App.tsx`
 *  cannot be rendered here (no React testing library), so the join is checked
 *  the same way the stale-folder rule is: on the source. */
describe('the window actually sends what was decided', () => {
  const APP = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('hands the decision to the message rather than dropping it', () => {
    expect(APP).toMatch(/decidedMessage\(chosen\.decision\)/);
  });

  it('takes the kept steps in the order they were left in', () => {
    // Reading `steps` here instead would send the proposed order however the
    // person rearranged it, and nothing on screen would say so.
    expect(APP).toMatch(/const agreed = chosen\?\.kept \?\? steps;/);
  });

  it('never lets a plan that asked something answer itself', () => {
    expect(APP).toMatch(/if \(waiting\.questions\.length > 0\) return;/);
  });

  it('still passes the questions to the card that draws them', () => {
    expect(APP).toMatch(/questions=\{turn\.questions\}/);
  });
});

/* ========================================================================== */
/* The gate reaches every session, not only the one in front                   */
/* ========================================================================== */

/**
 * Plan is a gate, and a gate with a door beside it is not one.
 *
 * A session is built in four places — the conversation, the copy made when
 * somebody has asked to see work checked first, a pull request's own checkout,
 * and a piece on the board. Three of them were opened without the gate, so with
 * "check it first" on, the very message Plan was holding ran in a copy with
 * every tool it started with. What this asserts is not a wording: it is that a
 * fifth session, added later, cannot quietly be the fourth hole.
 */
describe('every session Plan has to reach', () => {
  const SHELL = readFileSync(new URL('../electron/main.ts', import.meta.url), 'utf8');

  /** Every `createSession({ … })` in the shell, as the text of its arguments. */
  function sessionsBuilt(): readonly string[] {
    const built: string[] = [];
    const opener = 'createSession({';
    for (let at = SHELL.indexOf(opener); at !== -1; at = SHELL.indexOf(opener, at + 1)) {
      let depth = 0;
      let end = at + opener.length - 1;
      for (; end < SHELL.length; end += 1) {
        const letter = SHELL[end];
        if (letter === '{') depth += 1;
        if (letter === '}') {
          depth -= 1;
          if (depth === 0) break;
        }
      }
      built.push(SHELL.slice(at, end + 1));
    }
    return built;
  }

  it('finds every place a session is opened', () => {
    // Four today. A fifth is not a failure — it is a prompt to say whether the
    // gate belongs in it, which is exactly what the next case asks.
    expect(sessionsBuilt().length).toBeGreaterThanOrEqual(4);
  });

  it('opens none of them without saying whether Plan is on', () => {
    const ungated = sessionsBuilt().filter((one) => !one.includes('planMode:'));
    expect(ungated, `a session opened outside the gate: ${String(ungated.length)}`).toEqual([]);
  });

  it('holds the board while the folder is in Plan', () => {
    // A piece on the board is the work the model is refused for asking about,
    // so who put it there cannot be what decides it.
    expect(SHELL).toContain('if (planHeldOn(desk.path)) return;');
  });

  it('lets the board go again when Plan is left', () => {
    // Held pieces are only waiting; without this they wait for a turn that
    // never comes.
    expect(SHELL).toMatch(/if \(!on\) \{[\s\S]{0,200}runWhatCan\(desk\)/);
  });

  it('reads Plan off the folder, so a board nobody has open is not held', () => {
    expect(SHELL).toContain("return projectAt({ project: path })?.held.planMode === true;");
  });
});
