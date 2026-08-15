/** Slash-command workflows — the file, the parsing, the expansion. */

import { describe, expect, it } from 'vitest';

import {
  commandWord,
  expand,
  promptFor,
  readWorkflow,
  workflowWords,
  workflowsFrom,
} from '../src/work/workflows';

describe('commandWord — the filename makes the command', () => {
  it('takes the extension off the filename', () => {
    expect(commandWord('review.md')).toBe('/review');
  });

  it('rejects a name that is not a usable command', () => {
    expect(commandWord('review')).toBeNull();
    expect(commandWord('.hidden.md')).toBeNull();
    expect(commandWord('no space.md')).toBeNull();
    expect(commandWord('under_score.md')).toBeNull();
    expect(commandWord('two.words.md')).toBeNull();
    expect(commandWord('README.md')).toBe('/README');
  });

  it('is case-insensitive at the letter', () => {
    expect(commandWord('Review.md')).toBe('/Review');
  });
});

describe('readWorkflow — a prompt file becomes a workflow', () => {
  it('reads the frontmatter and the body', () => {
    const read = readWorkflow(
      {
        name: 'review.md',
        body: ['---', 'description: Review a pull request carefully', 'argument-hint: the PR to look at', '---', '', 'Look at $@ and tell me what you find.'].join('\n'),
      },
      'project',
    );
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.workflow.command).toBe('/review');
    expect(read.workflow.description).toBe('Review a pull request carefully');
    expect(read.workflow.hint).toBe('the PR to look at');
    expect(read.workflow.source).toBe('project');
  });

  it('refuses a file without a usable command name', () => {
    const read = readWorkflow({ name: 'no name.md', body: 'hello' }, 'global');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toBe(workflowWords.needName);
  });

  it('refuses a file with nothing in the body', () => {
    const read = readWorkflow({ name: 'empty.md', body: '---\ndescription: nothing\n---' }, 'global');
    expect(read.ok).toBe(false);
    if (read.ok) return;
    expect(read.because).toBe(workflowWords.needBody);
  });
});

describe('expand — typed words go in', () => {
  it('replaces $@ with everything', () => {
    expect(expand('Look at $@ now.', 'the header')).toBe('Look at the header now.');
  });

  it('replaces $1 with the first word', () => {
    expect(expand('Change $1 so it works.', 'pricing.tsx it')).toBe('Change pricing.tsx so it works.');
  });

  it('leaves a missing placeholder alone rather than guessing', () => {
    const after = expand('Open $1 and review it.', '');
    expect(after).toContain('$1');
  });

  it('keeps body intact when there are no words', () => {
    expect(expand('Do the whole thing.', '')).toBe('Do the whole thing.');
  });
});

describe('workflowsFrom — project wins over global', () => {
  const file = (name: string, body = 'do $@'): { name: string; body: string } => ({ name, body });

  it('lists both folders, project first', () => {
    const list = workflowsFrom([file('review.md')], [file('plan.md')]);
    expect(list.map((one) => one.command)).toEqual(['/review', '/plan']);
  });

  it('a project workflow overrides its global namesake', () => {
    const list = workflowsFrom(
      [file('review.md', 'project body')],
      [file('review.md', 'global body')],
    );
    expect(list).toHaveLength(1);
    const only = list[0];
    expect(only).toBeDefined();
    expect(only?.source).toBe('project');
    expect(only?.body).toBe('project body');
  });

  it('ignores files that are not usable commands', () => {
    const list = workflowsFrom([file('readme.txt')], [file('notes.md.txt')]);
    expect(list).toHaveLength(0);
  });
});

describe('promptFor — a workflow asked for', () => {
  it('expands the typed words into the body', () => {
    const read = readWorkflow({ name: 'review.md', body: 'Review $@ carefully.' }, 'project');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(promptFor(read.workflow, 'the new header')).toBe('Review the new header carefully.');
  });

  it('sends the body as it is with no words', () => {
    const read = readWorkflow({ name: 'review.md', body: 'Review the whole repo.' }, 'global');
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(promptFor(read.workflow, '')).toBe('Review the whole repo.');
  });
});
