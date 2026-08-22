/** What a research run shows while it works, and what happens to the plan it
 *  ends with. Both of these used to fail quietly, which is the worst way. */

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { parseProposal, PLAN_WORDS } from '../src/agent/plan';
import {
  asLinesOfEnquiry,
  implementationPlanFromResearch,
  lineOfEnquiry,
  lookingInto,
  stepsNotOnTheList,
} from '../src/agent/research';

const app = readFileSync(new URL('../src/App.tsx', import.meta.url), 'utf8');

describe('what it is looking into, while it looks', () => {
  it('reads the one question out of the paragraph a helper was handed', () => {
    expect(
      lineOfEnquiry('Looking into: whether the type scale is a scale. Read src/design and report.'),
    ).toBe('whether the type scale is a scale');
    // However it was capitalised, and however much whitespace came with it.
    expect(lineOfEnquiry('looking into:   how the nav loads\nThen search the web.')).toBe(
      'how the nav loads',
    );
  });

  it('leaves an ordinary helper exactly as it was said', () => {
    expect(lineOfEnquiry('Rename the tokens file and report back.')).toBeNull();
    const helpers = [
      { task: 'Rename the tokens file and report back.', state: 'running' as const },
      { task: 'Looking into: why the nav is slow. Read the router.', state: 'running' as const },
    ];
    expect(asLinesOfEnquiry(helpers)).toEqual([
      { task: 'Rename the tokens file and report back.', state: 'running' },
      { task: 'why the nav is slow', state: 'running' },
    ]);
  });

  it('says how many angles are out, and names them', () => {
    const helpers = [
      { task: 'Looking into: why the nav is slow', state: 'running' as const },
      { task: 'Looking into: what the type scale is', state: 'running' as const },
      { task: 'Looking into: who else has hit this', state: 'done' as const },
    ];
    expect(lookingInto(helpers)).toEqual({
      label: 'Looking into 2 things at once — 1 answered so far',
      detail: 'why the nav is slow · what the type scale is',
    });
    expect(lookingInto([{ task: 'Looking into: one thing', state: 'running' }])).toEqual({
      label: 'Looking into one thing',
      detail: 'one thing',
    });
  });

  it('says nothing at all when nothing is out', () => {
    expect(lookingInto([])).toBeNull();
    expect(lookingInto([{ task: 'Looking into: why the nav is slow', state: 'done' }])).toBeNull();
    // A run with no research helpers keeps saying what it is doing.
    expect(lookingInto([{ task: 'Rename the tokens file.', state: 'running' }])).toBeNull();
  });

  it('is what the window shows above the box while the helpers are out', () => {
    expect(app).toContain('const angles = asLinesOfEnquiry(helpers)');
    expect(app).toContain('helpers={angles}');
    expect(app).toContain('const intoIt = lookingInto(helpers)');
    expect(app).toContain('intoIt === null ? doingNow : { ...doingNow, step: intoIt }');
    expect(app).toContain('now: nowThere,');
  });
});

describe('the heading the plan arrives under', () => {
  const plan = '1. Move the reader\n2. Wire the panel';

  /* Every shape a report has actually arrived in. The words are dictated by the
     brief; how they are decorated is not, and a heading that is not matched
     loses the whole plan without saying so. */
  for (const heading of [
    'IMPLEMENTATION PLAN',
    '**IMPLEMENTATION PLAN**',
    '__IMPLEMENTATION PLAN__',
    '## Implementation Plan',
    '### **Implementation Plan**',
    'implementation plan',
    'Implementation Plan:',
    '**Implementation Plan:**',
    '## Implementation Plan: ',
    '   IMPLEMENTATION PLAN   ',
    '## Implementation Plan ##',
    '*Implementation  Plan*',
  ]) {
    it(`finds it under ${JSON.stringify(heading)}`, () => {
      expect(implementationPlanFromResearch(`Findings.\n\n${heading}\n${plan}`)).toBe(plan);
    });
  }

  it('still finds nothing where there is nothing', () => {
    expect(implementationPlanFromResearch('Research more before deciding.')).toBeNull();
    expect(implementationPlanFromResearch('IMPLEMENTATION PLAN\n\n')).toBeNull();
    // A sentence about the heading is not the heading.
    expect(
      implementationPlanFromResearch('Finish under the heading "IMPLEMENTATION PLAN" when relevant.'),
    ).toBeNull();
  });
});

describe('a plan longer than the list that comes out of it', () => {
  const long = Array.from({ length: 15 }, (_, at) => `${String(at + 1)}. Step ${String(at + 1)}`).join(
    '\n',
  );

  it('is read off what the plan itself reported, so the two cannot disagree', () => {
    const proposal = parseProposal(long);
    expect(proposal.steps.length).toBe(12);
    expect(stepsNotOnTheList(proposal.caveats)).toBe(
      'That plan had 3 more steps than the list holds, so they are not on it. Ask and I will add them.',
    );
    expect(stepsNotOnTheList([PLAN_WORDS.more(1)])).toBe(
      'That plan had one more step than the list holds, so the last one is not on it. Ask and I will add it.',
    );
  });

  it('says nothing when the whole plan is on the list', () => {
    expect(stepsNotOnTheList(parseProposal('1. One\n2. Two').caveats)).toBeNull();
    expect(stepsNotOnTheList([])).toBeNull();
    expect(stepsNotOnTheList(['This will need a designer to look at it.'])).toBeNull();
  });

  it('is said out loud in the conversation the research happened in', () => {
    expect(app).toContain("const missed = stepsNotOnTheList(proposal?.caveats ?? [])");
    expect(app).toContain("said('graphe', missed)");
    expect(app).toContain('changeDesk(current, project,');
  });
});
