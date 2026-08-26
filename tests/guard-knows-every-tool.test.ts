/** The Guard has heard of every tool Graphe hands the model.
 *
 *  A tool with no row falls through to the unknown-tool question, which asks
 *  about it on every single call. That is not a safe default in practice: it is
 *  a question in the middle of every turn, and a question asked forty times is
 *  the one nobody reads by the fortieth.
 *
 *  This is a sweep rather than a list, so a tool added tomorrow cannot be
 *  forgotten. It shipped that way twice — `step_done` and `score_candidates`
 *  both asked on every tick — and neither was noticed until somebody watched a
 *  real turn.
 */

import { describe, expect, it } from 'vitest';

import { evaluate } from '../src/agent/guard/policy';
import { describeCall } from '../src/lib/describe';
import { grapheTools } from '../src/agent/pi/tools';
import { pageTools } from '../src/agent/pi/tools';

const ROOT = '/Users/mira/Projects/portfolio';

/** Input that gives each shape of tool something to judge, so a tool that
 *  refuses an empty call is not mistaken for one nobody has heard of. */
const SOMETHING = {
  command: 'ls',
  path: `${ROOT}/README.md`,
  url: 'https://example.com',
  query: 'a question',
  target: '@e1',
  text: 'hello',
  app: 'Figma',
  steps: [{ do: 'read' }],
  name: 'a-name',
  task: 'have a look',
  note: 'done',
};

describe('every tool Graphe registers', () => {
  it('is one the Guard has an opinion about', () => {
    const named = [
      ...grapheTools('/tmp/agent', 'a-figma-token').map((one) => one.name),
      ...pageTools(ROOT).map((one) => one.name),
      // The ones only handed out where the shell can supply them.
      'ask_first',
      'step_done',
      'cancel_build',
      'keep_running',
      'running',
      'stop_running',
      'mcp',
      'retain',
      'recall',
      'reflect',
      'memory_edit',
      'forget',
      'debug_attach',
      'debug_step',
      'debug_frames',
      'debug_eval',
      'debug_detach',
      'read_diff',
    ];
    const unknown = named.filter((name) => {
      const verdict = evaluate({ id: 'x', name, input: SOMETHING }, { projectRoot: ROOT });
      return verdict.kind === 'confirm' && /do not fully recognise/.test(verdict.question);
    });
    expect(unknown, `no Guard row: ${unknown.join(', ')}`).toEqual([]);
  });

  /** The other half of the same problem: a tool with no words of its own draws
   *  as "Working on your project", which is the one sentence that says nothing.
   *  It was every other line of a real feed. */
  it('has words of its own for the feed', () => {
    const common = [
      ...grapheTools('/tmp/agent', 'a-figma-token').map((one) => one.name),
      ...pageTools(ROOT).map((one) => one.name),
      'step_done',
      'cancel_build',
      'read_map',
      'read_diff',
      'run_checks',
      'keep_running',
      'running',
      'stop_running',
      'mcp',
      'connect_tool',
      'retain',
      'recall',
      'reflect',
      'memory_edit',
      'forget',
      'set_going',
      'try_ways',
    ];
    const bland = [...new Set(common)].filter(
      (name) => describeCall({ id: 'x', name, input: SOMETHING }).label === 'Working on your project',
    );
    expect(bland, `no words of their own: ${bland.join(', ')}`).toEqual([]);
  });
});
