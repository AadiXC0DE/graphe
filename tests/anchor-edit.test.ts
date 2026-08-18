/** Editing by anchor, with fingerprints that catch stale edits.
 *
 *  The fingerprint logic is pure and runs here without a Pi session. The tool
 *  itself is exercised against real files in a scratch folder, with a stub
 *  standing in for Pi's ordinary edit so the exact-text path is decided in
 *  tests too. */

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  anchorEditTool,
  applyAnchor,
  canonicalize,
  fingerprint,
  renderPatch,
  type EditDelegate,
} from '../src/agent/pi/anchor-edit';

let dir: string;
let sent: { path: string; edits: readonly { oldText: string; newText: string }[] } | null = null;

const delegate: EditDelegate = async (params) => {
  sent = params;
  return {
    content: [{ type: 'text', text: `ordinary edit would run on ${params.path}` }],
    details: {},
  };
};

async function run(path: string, edits: unknown): Promise<{ text: string; details: unknown }> {
  const tool = anchorEditTool({ cwd: dir, delegate });
  const result = await tool.execute('call-1', { path, edits } as never, undefined, undefined, undefined as never);
  const text = result.content.find((entry) => entry.type === 'text')?.text ?? '';
  return { text, details: result.details };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'graphe-anchor-'));
  sent = null;
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('the fingerprint', () => {
  it('is stable under line endings and trailing spaces', () => {
    expect(fingerprint('a\nb\n')).toBe(fingerprint('a\r\nb\r\n'));
    expect(fingerprint('a  \nb ')).toBe(fingerprint('a\nb'));
  });

  it('changes when the words change', () => {
    expect(fingerprint('a\nb')).not.toBe(fingerprint('a\nc'));
  });
});

describe('applying an anchor', () => {
  it('replaces exactly the named lines', () => {
    const lines = ['one', 'two', 'three', 'four'];
    const tag = fingerprint(lines.join('\n'));
    const outcome = applyAnchor(lines, { tag, startLine: 2, endLine: 3, newText: 'x\ny' });
    expect(outcome.error).toBeNull();
    expect(outcome.lines).toEqual(['one', 'x', 'y', 'four']);
  });

  it('replaces a single line when no end is given', () => {
    const lines = ['one', 'two'];
    const tag = fingerprint(lines.join('\n'));
    const outcome = applyAnchor(lines, { tag, startLine: 1, newText: 'uno' });
    expect(outcome.lines).toEqual(['uno', 'two']);
  });

  it('refuses a stale fingerprint without touching anything', () => {
    const lines = ['one', 'two'];
    const outcome = applyAnchor(['one', 'CHANGED UNDERNEATH'], { tag: fingerprint(lines.join('\n')), startLine: 1, newText: 'x' });
    expect(outcome.error).toContain('changed since it was read');
    expect(outcome.error).toContain('Re-read');
  });

  it('refuses lines beyond the file', () => {
    const lines = ['one'];
    const outcome = applyAnchor(lines, { tag: fingerprint(lines.join('\n')), startLine: 5, newText: 'x' });
    expect(outcome.error).toContain('beyond it');
  });

  it('refuses an inverted range', () => {
    const lines = ['one', 'two'];
    const outcome = applyAnchor(lines, { tag: fingerprint(lines.join('\n')), startLine: 2, endLine: 1, newText: 'x' });
    expect(outcome.error).toBeTruthy();
  });
});

describe('the tool', () => {
  it('changes the named lines of a real file and reports the new fingerprint', async () => {
    const path = 'note.txt';
    writeFileSync(join(dir, path), 'one\ntwo\nthree\n');
    const tag = fingerprint('one\ntwo\nthree\n');
    const { text } = await run(path, [{ newText: 'two and a half', startLine: 2, endLine: 2, tag }]);
    expect(readFileSync(join(dir, path), 'utf8')).toBe('one\ntwo and a half\nthree\n');
    expect(text).toContain('Lines 2–2 of note.txt changed');
    expect(text).toMatch(/\[note\.txt#[0-9A-F]{4}\]/);
  });

  it('refuses a stale fingerprint and leaves the file alone', async () => {
    const path = 'note.txt';
    writeFileSync(join(dir, path), 'one\ntwo\n');
    const { text } = await run(path, [{ newText: 'x', startLine: 2, tag: 'DEAD' }]);
    expect(readFileSync(join(dir, path), 'utf8')).toBe('one\ntwo\n');
    expect(text).toContain('changed since it was read');
  });

  it('never writes anything when the anchor is bad', async () => {
    const path = 'note.txt';
    writeFileSync(join(dir, path), 'one\n');
    const before = readFileSync(join(dir, path), 'utf8');
    const { text } = await run(path, [{ newText: 'x', startLine: 9, tag: fingerprint('one\n') }]);
    expect(text).toContain('beyond it');
    expect(readFileSync(join(dir, path), 'utf8')).toBe(before);
  });

  it('hands edits without anchors to the ordinary edit, unchanged', async () => {
    const { text } = await run('a.txt', [{ oldText: 'old', newText: 'new' }]);
    expect(sent).toEqual({ path: 'a.txt', edits: [{ oldText: 'old', newText: 'new' }] });
    expect(text).toContain('ordinary edit would run');
  });

  it('asks for anchors on every edit, or none at all', async () => {
    const { text } = await run('a.txt', [
      { oldText: 'old', newText: 'new' },
      { newText: 'x', startLine: 1, tag: 'A1B2' },
    ]);
    expect(text).toContain('fingerprint (tag)');
  });

  it('asks for one anchored change per call, so line numbers stay honest', async () => {
    const { text } = await run('a.txt', [
      { newText: 'x', startLine: 1, tag: 'A1B2' },
      { newText: 'y', startLine: 3, tag: 'A1B2' },
    ]);
    expect(text).toContain('one place per anchored edit call');
  });
});

describe('the patch', () => {
  it('renders a change with context as a unified patch', () => {
    const patch = renderPatch('note.txt', ['a', 'old', 'b'], ['a', 'new', 'b']);
    expect(patch).toContain('--- a/note.txt');
    expect(patch).toContain('+++ b/note.txt');
    expect(patch).toContain('+new');
  });

  it('canonicalises without inventing or losing lines', () => {
    expect(canonicalize('a  \r\nb\t\n')).toBe('a\nb\n');
  });
});