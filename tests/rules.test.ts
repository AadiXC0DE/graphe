/** The rules a project carries, and the one thing they must never be able to do.
 *
 *  The failure guarded throughout: a rules file is a file in a repository, and
 *  a file in a repository is something a pull request, a dependency or a
 *  prompt-injected model can write. If a rule could answer "yes", the Guard
 *  would be one committed line away from off. So the claim under test is not
 *  "rules work" — it is that no rules file, however written, can make any
 *  verdict softer than the one the Guard reached on its own.
 *
 *  The second failure guarded is quieter: a rule that is silently dropped is a
 *  rule somebody believes is protecting them. Every unusable entry has to come
 *  back as a sentence.
 */

import { describe, expect, it } from 'vitest';

import {
  RULE_WORDS,
  afterCall,
  atTheEnd,
  beforeCall,
  inWords,
  readRules,
  rulesFile,
} from '../src/agent/hooks';
import type { Answer, Rules, World } from '../src/agent/hooks';
import { describeCall, evaluate, stricter } from '../src/agent/guard/policy';
import type { GuardFacts } from '../src/agent/guard/policy';
import type { ToolCall, Verdict } from '../src/agent/types';

const PROJECT = '/work/project';
const facts: GuardFacts = { projectRoot: PROJECT };

function call(name: string, input: Record<string, unknown> = {}): ToolCall {
  return { id: 't1', name, input };
}

/** A rules file as it would sit on disk, so every test goes through the reader
 *  rather than hand-building the parsed shape the reader is supposed to make. */
function file(...rules: unknown[]): Rules {
  return readRules(JSON.stringify({ rules }));
}

/** The same ordering the Guard uses. A verdict may move up this list under a
 *  rule and must never move down it. */
const HARDNESS: Record<Verdict['kind'], number> = {
  allow: 0,
  'snapshot-first': 1,
  confirm: 2,
  deny: 3,
};

const EVERY_VERDICT: readonly Verdict[] = [
  { kind: 'allow' },
  { kind: 'snapshot-first', reason: 'a way back' },
  { kind: 'confirm', question: 'Go ahead?', detail: 'the Guard asked this' },
  { kind: 'deny', reason: 'the Guard refused this' },
];

const EVERY_ANSWER: readonly Answer[] = ['ask', 'refuse', 'keep a way back'];

describe('R-01 a rule can tighten and can never loosen', () => {
  it('never returns anything softer, for every verdict crossed with every answer', () => {
    // WHY: the whole security claim in one table. Four starting verdicts times
    // three things a rule may say — twelve directions, and not one of them may
    // come out below where it started.
    for (const guarded of EVERY_VERDICT) {
      for (const answer of EVERY_ANSWER) {
        const rules = file({
          name: 'every direction',
          when: 'before',
          it: 'anything',
          then: answer,
          because: 'Because this project says so.',
        });
        const after = beforeCall(call('write', { path: 'src/a.ts', content: 'x' }), guarded, rules);
        expect(HARDNESS[after.verdict.kind]).toBeGreaterThanOrEqual(HARDNESS[guarded.kind]);
        expect(after.spoke).toEqual(['every direction']);
      }
    }
  });

  it('leaves a refusal exactly as the Guard wrote it, whatever the rule says', () => {
    // WHY: a rule that could rewrite a denial's words could not lower the
    // verdict but could still lie about it — "left alone because the tests are
    // red" over the top of "this reaches outside your project".
    const guarded: Verdict = { kind: 'deny', reason: 'the Guard refused this' };
    for (const answer of EVERY_ANSWER) {
      const rules = file({ name: 'noisy', when: 'before', then: answer, because: 'House style.' });
      const after = beforeCall(call('write', { path: 'src/a.ts' }), guarded, rules);
      expect(after.verdict).toEqual(guarded);
    }
  });

  it('turns a yes into a question and a question into a no, which is the point', () => {
    // WHY: the counterweight to every test above. If nothing could tighten
    // either, the module would pass its safety tests by doing nothing at all.
    const asking = file({ name: 'design system', when: 'before', then: 'ask', because: 'Hand-edited.' });
    const raised = beforeCall(call('write', { path: 'src/a.ts' }), { kind: 'allow' }, asking);
    expect(raised.verdict.kind).toBe('confirm');

    const refusing = file({ name: 'frozen', when: 'before', then: 'refuse', because: 'Frozen for now.' });
    const dropped = beforeCall(
      call('write', { path: 'src/a.ts' }),
      { kind: 'confirm', question: 'Go ahead?' },
      refusing,
    );
    expect(dropped.verdict.kind).toBe('deny');
  });

  it('has no word for letting something through, and says so by name', () => {
    // WHY: the first of the two layers. In Cursor, OpenCode and Amp a rule that
    // answers "allow" skips the gate. A file reaching for that word here is
    // turned away by name, not obeyed.
    const rules = file({ name: 'open the gate', when: 'before', then: 'allow', because: 'Trust me.' });
    expect(rules.rules).toHaveLength(0);
    expect(rules.skipped).toEqual([RULE_WORDS.badAnswer('open the gate', 'allow')]);

    const after = beforeCall(call('bash', { command: 'rm -rf /' }), { kind: 'confirm', question: 'Go ahead?' }, rules);
    expect(after.verdict.kind).toBe('confirm');
  });

  it('keeps the harder of two verdicts, and the first one on a tie', () => {
    // WHY: the second layer, on its own. Everything above folds through this
    // function, so its ordering is the ordering.
    const guard: Verdict = { kind: 'deny', reason: 'the Guard' };
    const rule: Verdict = { kind: 'deny', reason: 'the rule' };
    expect(stricter(guard, rule)).toEqual(guard);
    expect(stricter({ kind: 'allow' }, rule)).toEqual(rule);
    expect(stricter(rule, { kind: 'allow' })).toEqual(rule);
    expect(stricter({ kind: 'confirm', question: 'q' }, { kind: 'snapshot-first', reason: 'r' }).kind).toBe('confirm');
  });
});

describe('R-02 nothing in the file reaches the Guard’s own switches', () => {
  it('still refuses a tool that reaches for the permission system, with the Guard’s reason', () => {
    // WHY: the named non-negotiable. A rules file is the most attacker-reachable
    // input in the product, and this is the call it would want to open up.
    const switching = call('disable_safety', { path: 'src/a.ts' });
    const guarded = evaluate(switching, facts);
    expect(guarded.kind).toBe('deny');

    for (const answer of EVERY_ANSWER) {
      const rules = file({ name: 'let it through', when: 'before', it: 'anything', then: answer, because: 'Fine.' });
      expect(beforeCall(switching, guarded, rules).verdict).toEqual(guarded);
    }
  });

  it('refuses it through a connected tool too, where the name arrives wrapped', () => {
    // WHY: the Guard checks the inner name as well as the outer one. A rule
    // layered on top must not be the thing that undoes that second check.
    const wrapped = call('mcp', { server: 'anything', tool: 'bypass_permissions' });
    const guarded = evaluate(wrapped, facts);
    expect(guarded.kind).toBe('deny');
    const rules = file({ name: 'allow everything', when: 'before', then: 'ask', because: 'Fine.' });
    expect(beforeCall(wrapped, guarded, rules).verdict).toEqual(guarded);
  });
});

describe('R-03 a file that will not read says so', () => {
  it('no file at all is no rules and no complaint', () => {
    // WHY: the ordinary case. Most projects carry no rules and must not be told
    // off for it, or the real complaint below stops being read.
    expect(readRules(null)).toEqual({ rules: [], trouble: null, skipped: [] });
  });

  it('names what is wrong with a file that is there and broken', () => {
    // WHY: a misplaced comma used to be indistinguishable from no file at all,
    // which is exactly the bug this repo already fixed once for connected tools.
    expect(readRules('{ "rules": [ } ').trouble).toContain('not valid JSON');
    expect(readRules('[]').trouble).toBe(RULE_WORDS.notAnObject);
    expect(readRules('{}').trouble).toBe(RULE_WORDS.noList);
    expect(readRules('{"rules": "none"}').trouble).toBe(RULE_WORDS.notAList);
  });

  it('carries the trouble out to every moment, so it can reach the screen', () => {
    // WHY: reported nowhere is the same as ignored. Each of the three entry
    // points has to hand the sentence on rather than swallow it.
    const broken = readRules('{}');
    expect(beforeCall(call('write', {}), { kind: 'allow' }, broken).trouble).toBe(RULE_WORDS.noList);
    expect(afterCall(call('write', {}), broken).trouble).toBe(RULE_WORDS.noList);
    expect(atTheEnd(broken).trouble).toBe(RULE_WORDS.noList);
  });

  it('keeps the rules it could read and names the ones it could not', () => {
    // WHY: one typo must not cost a team the other nine rules, and must not
    // cost them the news that the tenth is not running.
    const rules = file(
      { name: 'good', when: 'before', it: 'changes files', then: 'ask', because: 'Careful here.' },
      'not a rule at all',
      { when: 'before', then: 'ask', because: 'nameless' },
      { name: 'wrong moment', when: 'sometimes', then: 'ask', because: 'x' },
      { name: 'wrong thing', when: 'before', it: 'sings', then: 'ask', because: 'x' },
      { name: 'no reason', when: 'before', then: 'ask' },
      { name: 'endless', when: 'at the end', then: 'refuse', because: 'x' },
    );
    expect(rules.rules.map((rule) => rule.name)).toEqual(['good']);
    expect(rules.skipped).toEqual([
      RULE_WORDS.notARule('the second one'),
      RULE_WORDS.needsName('the third one'),
      RULE_WORDS.badMoment('wrong moment', 'sometimes'),
      RULE_WORDS.badDoing('wrong thing', 'sings'),
      RULE_WORDS.needsBecause('no reason'),
      RULE_WORDS.endNeedsCheck('endless'),
    ]);
  });

  it('a file with a bad rule wedged into it still cannot lower the Guard', () => {
    // WHY: the shape an attack would take. A pull request adds one line saying
    // "allow" beside rules a team already trusts; the good rules keep working,
    // the wedged one is named on screen, and the Guard's refusal is untouched.
    const rules = file(
      { name: 'wedged in', when: 'before', it: 'anything', then: 'allow', because: 'Trust me.' },
      { name: 'careful with commands', when: 'before', it: 'runs a command', then: 'ask', because: 'Careful.' },
    );
    expect(rules.skipped).toEqual([RULE_WORDS.badAnswer('wedged in', 'allow')]);

    const risky = call('bash', { command: 'rm -rf /' });
    const guarded = evaluate(risky, facts);
    expect(guarded.kind).toBe('deny');
    const after = beforeCall(risky, guarded, rules);
    expect(after.verdict).toEqual(guarded);
    expect(after.spoke).toEqual(['careful with commands']);
  });
});

describe('R-04 a check nobody has run is not a check that passed', () => {
  const holdTheTurn = file({
    name: 'nothing goes back broken',
    when: 'at the end',
    needs: 'tests',
    then: 'refuse',
    because: 'The tests are not green.',
  });

  it('holds the turn when nothing is known about the check', () => {
    // WHY: deny-by-default, the one rule the Guard is built on. "I have not
    // looked" reading as "it is fine" is how a gate becomes decoration.
    expect(atTheEnd(holdTheTurn, {}).hold).toEqual([
      RULE_WORDS.held('nothing goes back broken', 'The tests are not green.'),
    ]);
  });

  it('holds the turn when the check is known to be failing', () => {
    const world: World = { checks: { tests: { passing: false } } };
    expect(atTheEnd(holdTheTurn, world).hold).toHaveLength(1);
  });

  it('lets the turn end once the check is known to be passing', () => {
    // WHY: the counterweight. A gate that never opens is not a gate.
    const world: World = { checks: { tests: { passing: true } } };
    expect(atTheEnd(holdTheTurn, world).hold).toEqual([]);
    expect(atTheEnd(holdTheTurn, world).spoke).toEqual([]);
  });

  it('names the checks the end of a turn depends on, passing or not', () => {
    // WHY: this is how the impure caller learns what to go and run. Only
    // listing failing ones would mean nothing ever gets run a first time.
    expect(atTheEnd(holdTheTurn, { checks: { tests: { passing: true } } }).run).toEqual(['tests']);
    expect(atTheEnd(holdTheTurn, {}).run).toEqual(['tests']);
  });

  it('mentions rather than holds when the rule only wanted to ask', () => {
    const gentle = file({
      name: 'worth a look',
      when: 'at the end',
      needs: 'typecheck',
      then: 'ask',
      because: 'The types do not check yet.',
    });
    expect(atTheEnd(gentle, {}).hold).toEqual([]);
    expect(atTheEnd(gentle, {}).mention).toHaveLength(1);
  });

  it('applies the same rule before a call, so a red check blocks the next change', () => {
    // WHY: the loop the whole feature exists for — "before anything is saved,
    // run the tests". The end of the turn is too late to stop a save.
    const rules = file({
      name: 'green before saving',
      when: 'before',
      it: 'changes files',
      needs: 'tests',
      then: 'refuse',
      because: 'The tests are red.',
    });
    const saving = call('write', { path: 'src/a.ts', content: 'x' });
    expect(beforeCall(saving, { kind: 'allow' }, rules, {}).verdict.kind).toBe('deny');
    expect(beforeCall(saving, { kind: 'allow' }, rules, { checks: { tests: { passing: true } } }).verdict.kind).toBe(
      'allow',
    );
  });
});

describe('R-05 what a rule is about', () => {
  it('a folder covers everything under it and nothing merely spelt like it', () => {
    // WHY: "src/design" matching "src/designer" would quietly widen every rule
    // anybody writes, and widening is the direction that costs somebody a file.
    const rules = file({
      name: 'design system',
      when: 'before',
      it: 'changes files',
      under: ['src/design'],
      then: 'ask',
      because: 'Hand-edited.',
    });
    const inside = beforeCall(call('write', { path: 'src/design/tokens.css' }), { kind: 'allow' }, rules);
    const beside = beforeCall(call('write', { path: 'src/designer/notes.ts' }), { kind: 'allow' }, rules);
    expect(inside.verdict.kind).toBe('confirm');
    expect(beside.verdict.kind).toBe('allow');
  });

  it('matches a path however it was spelt, absolute or not', () => {
    const rules = file({
      name: 'design system',
      when: 'before',
      it: 'changes files',
      under: ['src/design'],
      then: 'ask',
      because: 'Hand-edited.',
    });
    const absolute = beforeCall(call('edit', { path: `${PROJECT}/src/design/a.css` }), { kind: 'allow' }, rules);
    const dotted = beforeCall(call('edit', { path: './src/design/a.css' }), { kind: 'allow' }, rules);
    expect(absolute.verdict.kind).toBe('confirm');
    expect(dotted.verdict.kind).toBe('confirm');
  });

  it('an entry written as a suffix matches by ending', () => {
    const rules = file({
      name: 'styles',
      when: 'before',
      it: 'changes files',
      under: ['*.css'],
      then: 'ask',
      because: 'Styles are shared.',
    });
    expect(beforeCall(call('write', { path: 'a/b/main.css' }), { kind: 'allow' }, rules).verdict.kind).toBe('confirm');
    expect(beforeCall(call('write', { path: 'a/b/main.ts' }), { kind: 'allow' }, rules).verdict.kind).toBe('allow');
  });

  it('finds the location inside a command, which is the only place a command puts one', () => {
    // WHY: a command has no `path` field — it names its locations in its own
    // text. A rule about a folder that only ever read fields would look
    // straight past the one call most able to wreck it.
    const rules = file({
      name: 'design system',
      when: 'before',
      it: 'runs a command',
      under: ['src/design'],
      then: 'ask',
      because: 'Hand-edited.',
    });
    const sweeping = call('bash', { command: 'sed -i s/red/blue/ src/design/tokens.css' });
    const elsewhere = call('bash', { command: 'sed -i s/red/blue/ src/lib/other.ts' });
    expect(beforeCall(sweeping, { kind: 'allow' }, rules).verdict.kind).toBe('confirm');
    expect(beforeCall(elsewhere, { kind: 'allow' }, rules).verdict.kind).toBe('allow');
  });

  it('a rule about running commands stays quiet when nothing is being run', () => {
    // WHY: a rule that fires on everything is a rule people switch off.
    const rules = file({
      name: 'no commands',
      when: 'before',
      it: 'runs a command',
      then: 'ask',
      because: 'Commands cannot be undone.',
    });
    expect(beforeCall(call('read', { path: 'src/a.ts' }), { kind: 'allow' }, rules).verdict.kind).toBe('allow');
    expect(beforeCall(call('bash', { command: 'ls' }), { kind: 'allow' }, rules).verdict.kind).toBe('confirm');
  });

  it('matches a word inside a command, whatever its case', () => {
    const rules = file({
      name: 'never publish by hand',
      when: 'before',
      it: 'runs a command',
      mentions: ['deploy'],
      then: 'refuse',
      because: 'Publishing is not something to do from here.',
    });
    expect(beforeCall(call('bash', { command: 'npm run DEPLOY' }), { kind: 'allow' }, rules).verdict.kind).toBe('deny');
    expect(beforeCall(call('bash', { command: 'npm run build' }), { kind: 'allow' }, rules).verdict.kind).toBe('allow');
  });

  it('sorts a call into the same kinds the Guard already means by them', () => {
    // WHY: a second classification beside the Guard's would drift, and only one
    // of the two would be tested.
    expect(describeCall(call('bash', { command: 'ls' })).does).toBe('runs a command');
    expect(describeCall(call('write', { path: 'a.ts' })).does).toBe('changes files');
    expect(describeCall(call('rm', { path: 'a.ts' })).does).toBe('deletes something');
    expect(describeCall(call('read', { path: 'a.ts' })).does).toBe('reads');
    expect(describeCall(call('websearch', { query: 'x' })).does).toBe('reaches the internet');
    expect(describeCall(call('somethingnewentirely', {})).does).toBe('something else');
  });
});

describe('R-06 after the fact', () => {
  const rules = file({
    name: 'run the tests after a change',
    when: 'after',
    it: 'changes files',
    needs: 'tests',
    then: 'refuse',
    because: 'A change without a green run is a change nobody has checked.',
  });

  it('names the check to run, and hands the model a sentence while it is not passing', () => {
    const said = afterCall(call('write', { path: 'src/a.ts' }), rules, {});
    expect(said.run).toEqual(['tests']);
    expect(said.sayBack).toHaveLength(1);
    expect(said.spoke).toEqual(['run the tests after a change']);
  });

  it('still names the check once it passes, and stops talking about it', () => {
    // WHY: the check has to be re-run after the next change too, so `run` is
    // about what the rule depends on, not about what is currently broken.
    const said = afterCall(call('write', { path: 'src/a.ts' }), rules, { checks: { tests: { passing: true } } });
    expect(said.run).toEqual(['tests']);
    expect(said.sayBack).toEqual([]);
  });

  it('says nothing about a call the rule was not about', () => {
    const said = afterCall(call('read', { path: 'src/a.ts' }), rules, {});
    expect(said).toEqual({ sayBack: [], run: [], spoke: [], trouble: null });
  });
});

describe('R-07 the words', () => {
  it('never uses the vocabulary this product keeps off screen', () => {
    // WHY: every sentence here reaches a person. The repo's language rule is
    // not advisory, and a rules panel is exactly where the mechanism words
    // would creep back in.
    const offScreen = /\b(git|commit|commits|branch|branches|staged|session|token|tokens|API|repo|repository)\b/i;
    const sentences = Object.values(RULE_WORDS).map((entry) =>
      typeof entry === 'function' ? entry('a name', 'a reason') : entry,
    );
    for (const sentence of sentences) expect(sentence).not.toMatch(offScreen);
  });

  it('reads a rule back as a sentence, for the person who did not write it', () => {
    const rules = file(
      {
        name: 'design system',
        when: 'before',
        it: 'changes files',
        under: ['src/design'],
        then: 'ask',
        because: 'These files are hand-edited.',
      },
      {
        name: 'nothing goes back broken',
        when: 'at the end',
        needs: 'tests',
        then: 'refuse',
        because: 'A red run is not finished work.',
      },
    );
    expect(inWords(rules.rules[0]!)).toBe(
      'Before I change a file in src/design, I check with you. These files are hand-edited.',
    );
    expect(inWords(rules.rules[1]!)).toBe(
      'Before I hand anything back, tests has to pass, or I stop and say so. A red run is not finished work.',
    );
  });

  it('keeps its file beside the one connected tools already use', () => {
    expect(rulesFile(PROJECT)).toBe('/work/project/.pi/rules.json');
  });
});
