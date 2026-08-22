/** The research brief: what goes out in front of somebody's question when they
 *  ask for the question to be researched rather than answered. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseProposal, shouldLookFirst, worthPlanning } from '../src/agent/plan';

import {
  asResearch,
  DEPTHS,
  implementationPlanFromResearch,
  researchBrief,
  researchWords,
  RESEARCH_BRIEF,
} from '../src/agent/research';

describe('what research sends', () => {
  it('puts the method first and the question whole', () => {
    const sent = asResearch('Is our type scale actually a scale?');

    expect(sent.startsWith(RESEARCH_BRIEF)).toBe(true);
    // Unedited, and last: a request paraphrased into a brief is a request
    // nobody can check the answer against.
    expect(sent.endsWith('Is our type scale actually a scale?')).toBe(true);
  });

  it('trims what somebody typed without rewriting it', () => {
    expect(asResearch('  Why is the nav slow?  ')).toContain('Why is the nav slow?');
    expect(asResearch('  Why is the nav slow?  ')).not.toContain('  Why is the nav slow?  ');
  });

  it('sends nothing at all for nothing at all', () => {
    expect(asResearch('   ')).toBe('');
  });

  it('asks for helpers at the same time rather than one after another', () => {
    // The whole reason this mode exists. If the brief stops saying it, the mode
    // is a longer prompt and nothing else.
    expect(RESEARCH_BRIEF).toMatch(/at the same time rather than one after another/i);
  });

  it('asks for the project itself, not only the web', () => {
    expect(RESEARCH_BRIEF).toMatch(/read this project as well as the web/i);
  });

  it('refuses to let research turn into changes on its own', () => {
    expect(RESEARCH_BRIEF).toMatch(/change nothing until/i);
  });

  it('asks the model for a structured implementation plan when one is relevant', () => {
    expect(RESEARCH_BRIEF).toContain('IMPLEMENTATION PLAN');
    expect(RESEARCH_BRIEF).toMatch(/when the research is about work that could be implemented/i);
  });

  it('reads the model’s explicit implementation plan without guessing intent from words', () => {
    const report = [
      '# Findings',
      'The current behavior is confirmed.',
      '',
      'IMPLEMENTATION PLAN',
      '1. Make the research choice apply once.',
      '2. Build the checklist from this model-written plan.',
    ].join('\n');
    expect(implementationPlanFromResearch(report)).toBe(
      '1. Make the research choice apply once.\n2. Build the checklist from this model-written plan.',
    );
    expect(implementationPlanFromResearch('## IMPLEMENTATION PLAN:\n1. Do the work.')).toBe(
      '1. Do the work.',
    );
    expect(implementationPlanFromResearch('Research more before deciding.')).toBeNull();
    expect(implementationPlanFromResearch('IMPLEMENTATION PLAN\n\n')).toBeNull();
  });

  it('does not emit a pre-research cost warning', () => {
    expect((researchWords as Record<string, unknown>).slower).toBeUndefined();
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).not.toContain('saidSlower');
    expect(app).not.toContain('researchWords.slower');
  });

  it('is one-shot, so the next user sentence reaches the model without word matching', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const researchBranch = app.slice(
      app.indexOf("if (plans === 'research')"),
      app.indexOf("if (plans === 'research')") + 1500,
    );
    expect(researchBranch).toContain("setPlans('auto')");
    expect(researchBranch).toContain('deliver(asResearch(text, chosenDepth())');
    expect(app).not.toMatch(/classifyResearch|researchCases|PROCEED_RE/);
  });

  it('turns only the model-written implementation section into the build checklist', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('implementationPlanFromResearch(report)');
    expect(app).toContain('parseProposal(planText)');
    expect(app).toContain('const steps = proposal?.steps ?? []');
    expect(app).toContain('.buildSave(');
  });

  /* The same sweep every other word bank in the app stands: plain words on the
     surface, and none of the machinery underneath. */
  it('never names the machinery', () => {
    const everything = [
      ...Object.values(researchWords),
      ...DEPTHS.flatMap((one) => [one.name, one.note]),
      ...DEPTHS.map((one) => researchBrief(one.id)),
      RESEARCH_BRIEF,
    ]
      .join(' ')
      .toLowerCase();
    for (const banned of ['subagent', 'token', 'api', 'prompt', 'context window', 'llm', 'model']) {
      expect(everything).not.toContain(banned);
    }
  });
});

describe('the answer to a look-around is built, not looked at again', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('remembers that it just asked, rather than reading the words again', () => {
    // "now implement the redesign" carries the same words that made it look
    // around in the first place, so judging it by the same rule plans the plan.
    expect(worthPlanning('now implement the redesign')).toBe(true);
    expect(app).toContain('const justLookedFirst = useRef(false)');
  });

  it('turns the look-around off for the message that answers it', () => {
    // Both send paths, and both ways into research.
    expect(app.match(/const answering = justLookedFirst\.current;/g)?.length).toBe(2);
    expect(app.match(/justLookedFirst\.current = true;/g)?.length).toBe(4);
    // The rule itself lives where it can be tested, and both paths call it.
    expect(app.match(/shouldLookFirst\(\{ plans, answering, text \}\)/g)?.length).toBe(2);
  });

  /* The rule the window used to hold inline. Its own tests, because a rule
     nobody can run is a rule that quietly stops holding — which is what
     happened: full access turned the whole thing off. */
  it('only the guess steps aside for the message that answers it', () => {
    const text = 'now implement the redesign';
    expect(shouldLookFirst({ plans: 'auto', answering: true, text })).toBe(false);
    // A switch somebody deliberately set to "always" is not overruled by us
    // deciding they meant something else.
    expect(shouldLookFirst({ plans: 'always', answering: true, text })).toBe(true);
    expect(shouldLookFirst({ plans: 'never', answering: false, text })).toBe(false);
    expect(shouldLookFirst({ plans: 'research', answering: false, text })).toBe(false);
  });

  it('does not ask how far the run may go — that was the bug', () => {
    // "Until it's done" is about not stopping to ask. It never meant working
    // without a list, and the biggest jobs are the ones that most need one.
    expect(app).not.toContain("howFar !== 'doing' &&\n        (plans ===");
    expect(app).not.toContain("howFar !== 'doing' &&\n          (plans ===");
  });

  it('judges the message after that one fresh', () => {
    // Cleared on read, so only the immediate answer is exempt.
    const at = app.indexOf('const answering = justLookedFirst.current;');
    expect(app.slice(at, at + 120)).toContain('justLookedFirst.current = false;');
  });
});

describe('research, the checklist, and the answer to it', () => {
  const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

  it('turns the plan research wrote into the checklist, when it wrote one', () => {
    const report = [
      'Findings: three ways to do it.',
      '',
      'IMPLEMENTATION PLAN',
      '1. Move the reader',
      '2. Wire the panel',
      '3. Cover it with a test',
    ].join('\n');
    const found = implementationPlanFromResearch(report);
    expect(found).not.toBeNull();
    expect(parseProposal(found ?? '').steps.length).toBe(3);
  });

  it('has nothing to build from when research wrote no plan', () => {
    expect(implementationPlanFromResearch('Findings, and no plan section at all.')).toBeNull();
  });

  it('only exempts the answer when there is a checklist to answer with', () => {
    // Research that produced steps leaves the exemption standing, so "now build
    // it" builds them. Research that produced none clears it, so the same words
    // earn their own look-around and the big job is still tracked.
    expect(app).toContain('if (steps.length === 0) justLookedFirst.current = false;');
  });

  it('creates the checklist when research settles, not on a later message', () => {
    const at = app.indexOf('implementationPlanFromResearch(report)');
    const near = app.slice(Math.max(0, at - 400), at);
    expect(near).toContain("notice.event.type === 'settled'");
  });
});
