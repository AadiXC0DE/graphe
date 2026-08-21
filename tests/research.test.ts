/** The research brief: what goes out in front of somebody's question when they
 *  ask for the question to be researched rather than answered. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  asResearch,
  implementationPlanFromResearch,
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

  it('says what it will cost somebody before they wait for it', () => {
    expect(researchWords.slower).toMatch(/longer/i);
    expect(researchWords.slower).toMatch(/costs more/i);
  });

  it('is one-shot, so the next user sentence reaches the model without word matching', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    const researchBranch = app.slice(
      app.indexOf("if (plans === 'research')"),
      app.indexOf("if (plans === 'research')") + 1500,
    );
    expect(researchBranch).toContain("setPlans('auto')");
    expect(researchBranch).toContain('deliver(asResearch(text)');
    expect(app).not.toMatch(/classifyResearch|researchCases|PROCEED_RE/);
  });

  it('turns only the model-written implementation section into the build checklist', () => {
    const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');
    expect(app).toContain('implementationPlanFromResearch(report)');
    expect(app).toContain('parseProposal(planText).steps');
    expect(app).toContain('.buildSave(');
  });

  /* The same sweep every other word bank in the app stands: plain words on the
     surface, and none of the machinery underneath. */
  it('never names the machinery', () => {
    const everything = [...Object.values(researchWords), RESEARCH_BRIEF].join(' ').toLowerCase();
    for (const banned of ['subagent', 'token', 'api', 'prompt', 'context window', 'llm', 'model']) {
      expect(everything).not.toContain(banned);
    }
  });
});
