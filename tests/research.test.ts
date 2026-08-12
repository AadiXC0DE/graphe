/** The research brief: what goes out in front of somebody's question when they
 *  ask for the question to be researched rather than answered. */

import { describe, expect, it } from 'vitest';

import { asResearch, researchWords, RESEARCH_BRIEF } from '../src/agent/research';

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

  it('says what it will cost somebody before they wait for it', () => {
    expect(researchWords.slower).toMatch(/longer/i);
    expect(researchWords.slower).toMatch(/costs more/i);
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
