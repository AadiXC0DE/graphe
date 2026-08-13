/** How long a model thinks before it answers.
 *
 * The one place in the ordinary run of the interface where the machinery's own
 * word leads. Every model's documentation, every other tool and every forum
 * answer calls these `medium` and `xhigh`; a picker that renames them to
 * "Some time" and "Extra time" makes somebody who knows exactly what they want
 * guess which of ours is theirs. So the level's real name is the label, and the
 * plain words follow in brackets for everybody else — the two audiences read
 * the same row rather than one of them being translated for.
 */

import type { ThinkingLevel } from './ipc';

export const THINKING_LEVELS: readonly ThinkingLevel[] = [
  'off',
  'minimal',
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
];

/** `plain` is written to be read as a ladder in order — each rung obviously
 *  longer than the one above it, without anybody having to know the scale. */
export const thinkingLevels: Record<
  ThinkingLevel,
  { name: string; plain: string; note: string }
> = {
  off: { name: 'off', plain: 'straight away', note: 'Answers without thinking first' },
  minimal: { name: 'minimal', plain: 'barely any time', note: 'A beat, and then it answers' },
  low: { name: 'low', plain: 'a little time', note: 'Thinks briefly before answering' },
  medium: { name: 'medium', plain: 'take more time', note: 'Thinks things through' },
  high: { name: 'high', plain: 'take your time', note: 'Thinks carefully before answering' },
  xhigh: { name: 'xhigh', plain: 'longer still', note: 'Thinks hard on the hard parts' },
  max: { name: 'max', plain: 'longest', note: 'Thinks as long as it needs' },
};

/** The label on the row: `medium (take more time)`. */
export function saysLevel(level: ThinkingLevel): string {
  const said = thinkingLevels[level];
  return `${said.name} (${said.plain})`;
}
