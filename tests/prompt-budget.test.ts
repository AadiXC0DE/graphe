/** Required instructions survive a long prompt; the optional notes are what
 *  give way, and the prompt says so.
 *
 * The whole assembled system prompt used to be cut at a character count, which
 * could take half a repository's instructions with it while keeping a paragraph
 * of notes. It is assembled as sections now: the instructions are never dropped
 * and never silently cut, a section longer than it may carry names where the
 * rest of it is, and the notes this app carries itself are left out first, in
 * the prompt's own words.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { PROMPT_BUDGET, standingWords } from '../src/agent/pi/standing';
import { assemblePrompt, piecesOf } from '../src/agent/pi/prompt';

const adapter = readFileSync(
  fileURLToPath(new URL('../src/agent/pi/adapter.ts', import.meta.url)),
  'utf8',
);

/** The factory that assembles the prompt, which is the only place the whole of
 *  it can be held to anything. */
const factory = adapter.slice(
  adapter.indexOf("name: 'graphe-prompt',"),
  adapter.indexOf('await loader.reload('),
);

const long = (n: number, head = ''): string => `${head}${'x'.repeat(n)}`;

describe('what gives way, and what does not', () => {
  it('keeps a required instruction through a prompt far past any budget', () => {
    const required = 'The repository says: run the checks before you say it is done.';
    const put = assemblePrompt(
      [
        { of: 'runtime', text: long(200_000) },
        { of: 'repository', text: required, at: '/p/AGENTS.md' },
        { of: 'memory', text: long(50_000, 'a note. '), required: false },
      ],
      1_000,
    );
    expect(put.systemPrompt).toContain(required);
    expect(put.sections.find((one) => one.of === 'repository')?.dropped).toBe(false);
  });

  it('drops the notes first, and says so in the prompt itself', () => {
    const put = assemblePrompt(
      [
        { of: 'runtime', text: long(4_000) },
        { of: 'memory', text: long(50_000, 'a note. '), required: false },
      ],
      5_000,
    );
    expect(put.systemPrompt).not.toContain('a note.');
    expect(put.saidSo).toContain(standingWords.leftOutForRoom('memory'));
    // The person reading the prompt can see it, not only the person reading a log.
    expect(put.systemPrompt).toContain(standingWords.leftOutForRoom('memory'));
    expect(put.sections.find((one) => one.of === 'memory')?.dropped).toBe(true);
  });

  it('drops nothing required even when that is the only way to fit', () => {
    const put = assemblePrompt([{ of: 'runtime', text: long(1_000) }], 100);
    expect(put.systemPrompt).toContain(long(1_000));
    expect(put.saidSo).toBe(standingWords.pastTheAim(100));
  });

  it('sends the head of a long section and names where the rest is', () => {
    const put = assemblePrompt(
      [{ of: 'repository', text: long(40_000, 'Rule one.\n\n'), at: '/p/AGENTS.md', most: 1_000 }],
      100_000,
    );
    expect(put.systemPrompt).toContain('Rule one.');
    expect(put.systemPrompt).toContain(standingWords.rest('/p/AGENTS.md'));
    expect(put.saidSo).toContain(standingWords.shortened('repository'));
  });

  it('says nothing about giving way when everything fitted', () => {
    const put = assemblePrompt([{ of: 'runtime', text: 'hello' }], PROMPT_BUDGET);
    expect(put.saidSo).toBeNull();
    expect(put.systemPrompt.trim()).toBe('hello');
  });

  it('keeps the sections in precedence order whatever order they arrive in', () => {
    const put = assemblePrompt([
      { of: 'memory', text: 'the notes', required: false },
      { of: 'plan', text: 'the list' },
      { of: 'runtime', text: 'pi text' },
    ]);
    expect(put.systemPrompt.indexOf('pi text')).toBeLessThan(put.systemPrompt.indexOf('the list'));
    expect(put.systemPrompt.indexOf('the list')).toBeLessThan(put.systemPrompt.indexOf('the notes'));
  });
});

describe('what Pi assembled, back into pieces', () => {
  const assembled = [
    'You are an expert coding assistant operating inside pi.',
    '',
    'appended by an add-on',
    '',
    '<project_context>',
    '',
    'Project-specific instructions and guidelines:',
    '',
    '<project_instructions path="/p/AGENTS.md">',
    'Run the checks before you say it is done.',
    '</project_instructions>',
    '',
    '</project_context>',
    '\n\nThe following skills provide specialized instructions for specific tasks.',
    "Use the read tool to load a skill's file when the task matches its description.",
    '',
    '<available_skills>',
    '  <skill>',
    '    <name>pptx</name>',
    '    <description>Slides.</description>',
    '    <location>/p/.pi/skills/pptx/SKILL.md</location>',
    '  </skill>',
    '</available_skills>',
    '\nCurrent working directory: /p',
  ].join('\n');

  it('finds the project instructions by the path Pi wrote', () => {
    const { sections, foot } = piecesOf(assembled, {
      appendSystemPrompt: 'appended by an add-on',
      contextFiles: [{ path: '/p/AGENTS.md', content: 'Run the checks before you say it is done.' }],
    });
    const repository = sections.find((one) => one.of === 'repository');
    expect(repository?.text).toContain('Run the checks');
    expect(repository?.at).toBe('/p/AGENTS.md');
    expect(foot).toBe('Current working directory: /p');
    // Nothing of Pi's own text is thrown away, and the project's instructions
    // are not left in it twice.
    expect(sections.find((one) => one.of === 'runtime')?.text).toContain('expert coding assistant');
    expect(sections.find((one) => one.of === 'extensions')?.text).toBe('appended by an add-on');
    expect(sections.find((one) => one.of === 'skills')?.text).toContain('<available_skills>');
    expect(sections.filter((one) => one.of === 'repository')).toHaveLength(1);
  });

  it('leaves the text where it is when the markers are not there', () => {
    const { sections, foot } = piecesOf('something else entirely', {});
    expect(sections).toHaveLength(1);
    expect(sections[0]?.of).toBe('runtime');
    expect(sections[0]?.text).toBe('something else entirely');
    expect(foot).toBe('');
  });

  /* Pi's working directory line is its last, and stays its last whatever the
     sections end up being. */
  it('puts Pi’s closing line back at the end', () => {
    const { sections, foot } = piecesOf(
      'runtime text\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n<project_instructions path="/p/AGENTS.md">\nrules\n</project_instructions>\n\n</project_context>\nCurrent working directory: /p',
      { contextFiles: [{ path: '/p/AGENTS.md', content: 'rules' }] },
    );
    const put = assemblePrompt(sections, PROMPT_BUDGET, foot);
    expect(put.systemPrompt.endsWith('Current working directory: /p')).toBe(true);
    expect(put.systemPrompt.indexOf('rules')).toBeLessThan(
      put.systemPrompt.lastIndexOf('Current working directory'),
    );
  });
});

describe('where it is applied', () => {
  it('assembles Pi’s prompt in the hook, from what Pi says it put there', () => {
    expect(factory).toContain('assemblePrompt(');
    expect(factory).toContain('piecesOf(');
  });

  it('names this app’s own notes as the section that gives way', () => {
    expect(factory).toContain('options.contextNotes');
    expect(factory).toContain('required: false');
  });

  it('says how heavy the prompt was, whether or not anything gave way', () => {
    expect(factory).toContain("options.onEvent({ type: 'prompt-size', characters: put.characters });");
  });

  it('says what gave way once a sitting rather than once a turn', () => {
    expect(factory).toContain('if (put.saidSo !== null) {');
    expect(factory).toContain('if (already.has(id)) return;');
  });

  it('no longer cuts the assembled prompt at a character count', () => {
    expect(adapter).not.toContain('withinBudget(was');
  });
});
