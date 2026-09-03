/** Editing by anchor, with a fingerprint that catches stale edits.
 *
 * The usual edit tool makes the model retype the exact text it wants to
 * change — every line, every byte of whitespace — and when the file has moved
 * on underneath it, the retyped text simply fails to match and the model has
 * to guess why. This edit takes a different path when the model asks for it:
 * a file read out of this session carries a short fingerprint, and an edit can
 * say "lines 12–14 of the file with fingerprint AB12CD become these lines"
 * instead of retyping what is already there. The fingerprint is checked
 * against the file before anything is written, so a file that changed since it
 * was read is refused with a clear "re-read it" instead of silently corrupting
 * something.
 *
 * Edits without anchors behave exactly like the ordinary edit tool: the caller
 * hands this module a delegate that is Pi's own edit, and this module is only
 * the anchor path plus the routing between them. Pi-free apart from types, so
 * the fingerprint logic runs in tests without a Pi session in sight.
 */

import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

/* -------------------------------------------------------------------------- */
/* The fingerprint                                                            */
/* -------------------------------------------------------------------------- */

/** The text as the fingerprint sees it: line endings and trailing whitespace
 *  are accidents of the editor, not facts about the file. */
export function canonicalize(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/, ''))
    .join('\n');
}

/** A short, stable name for a file's exact contents. Four hex characters — a
 *  fingerprint, not a checksum: a mismatch only costs a re-read. */
export function fingerprint(text: string): string {
  return createHash('sha1').update(canonicalize(text)).digest('hex').slice(0, 4).toUpperCase();
}

/** The session's memory of what each file looked like when it was last read.
 *  Keyed by absolute path; the model never sees the snapshot, only the tag. */
const snapshots = new Map<string, { tag: string; text: string }>();

/** Remember a file's present state and answer with its fingerprint. */
export function refreshSnapshot(path: string, text: string): string {
  const tag = fingerprint(text);
  snapshots.set(path, { tag, text });
  return tag;
}

/** What we last saw of a file, if anything. */
export function snapshotOf(path: string): { tag: string; text: string } | null {
  return snapshots.get(path) ?? null;
}

/* -------------------------------------------------------------------------- */
/* The anchored edit, pure                                                    */
/* -------------------------------------------------------------------------- */

export type Anchor = {
  /** The fingerprint the file carried when it was read. Required. */
  tag: string;
  /** First line, 1-indexed and inclusive. */
  startLine: number;
  /** Last line, 1-indexed and inclusive; defaults to startLine. */
  endLine?: number;
  /** The lines that replace the range. */
  newText: string;
};

/** Apply one anchored edit to a file's lines, or say why it cannot be applied.
 *  Nothing is written here — the caller preflights every edit in a batch
 *  before any file changes, so a stale anchor mid-batch cannot land half an
 *  edit. */
export function applyAnchor(lines: readonly string[], anchor: Anchor): { lines: string[]; error: string | null } {
  const tag = fingerprint(lines.join('\n'));
  if (tag !== anchor.tag) {
    return {
      lines: [],
      error: `This file has changed since it was read (fingerprint ${tag} now, ${anchor.tag} then). Re-read it, then try again.`,
    };
  }
  const start = Math.floor(anchor.startLine);
  const end = anchor.endLine === undefined ? start : Math.floor(anchor.endLine);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 1 || end < start) {
    return { lines: [], error: 'The lines to change make no sense: they start after they end, or before line 1.' };
  }
  if (end > lines.length) {
    return { lines: [], error: `The file has ${lines.length} ${lines.length === 1 ? 'line' : 'lines'}, so lines ${start}–${end} are beyond it.` };
  }
  const replacement = anchor.newText.split('\n');
  return {
    lines: [...lines.slice(0, start - 1), ...replacement, ...lines.slice(end)],
    error: null,
  };
}

/* -------------------------------------------------------------------------- */
/* A patch worth keeping, without a diff library                              */
/* -------------------------------------------------------------------------- */

/** A unified patch for what changed, with a little context so it reads like a
 *  change and not a cipher. The model never sees this; it is the `details`
 *  shape the ordinary edit tool returns, kept so the two behave alike. */
export function renderPatch(path: string, before: readonly string[], after: readonly string[]): string {
  const context = 3;
  const hunks: string[] = [];
  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    const changeStart = i;
    let changeEnd = i;
    while (changeEnd + 1 < before.length && before[changeEnd + 1] !== after[changeEnd + 1]) {
      changeEnd++;
    }
    const from = Math.max(0, changeStart - context);
    const to = Math.min(before.length, changeEnd + 1 + context);
    const oldCount = changeEnd - changeStart + 1;
    const newLines = after.slice(changeStart, changeEnd + 1).map((line) => `+${line}`);
    const head = `@@ -${changeStart + 1},${oldCount} +${changeStart + 1},${newLines.length} @@`;
    const body: string[] = [head];
    for (let j = from; j < changeStart; j++) body.push(` ${before[j] ?? ''}`);
    body.push(...newLines);
    for (let j = changeEnd + 1; j < to; j++) body.push(` ${before[j] ?? ''}`);
    hunks.push(body.join('\n'));
    i = changeEnd;
  }
  return hunks.length === 0
    ? ''
    : `--- a/${path}\n+++ b/${path}\n${hunks.join('\n')}\n`;
}

/* -------------------------------------------------------------------------- */
/* The tool                                                                    */
/* -------------------------------------------------------------------------- */

/** The ordinary edit, handed in by the adapter: Pi's own exact-match tool. */
export type EditDelegate = (
  params: { path: string; edits: readonly { oldText: string; newText: string }[] },
  signal: AbortSignal | undefined,
) => Promise<AgentToolResult<unknown>>;

function textResult(text: string, details: unknown): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details };
}
const ANCHOR_EDIT_SCHEMA = Type.Object({
  path: Type.String({ description: 'Path to the file to edit, relative to the project.' }),
  edits: Type.Array(
    Type.Object({
      newText: Type.String({ description: 'Replacement text for this edit.' }),
      oldText: Type.Optional(
        Type.String({
          description:
            'Exact text to replace, when editing by text. Must be unique in the file. Not needed when startLine and tag are given.',
        }),
      ),
      startLine: Type.Optional(Type.Number({ description: 'First line to change, 1-indexed, when editing by anchor.' })),
      endLine: Type.Optional(Type.Number({ description: 'Last line to change, 1-indexed, when editing by anchor.' })),
      tag: Type.Optional(
        Type.String({
          description:
            "The file's fingerprint from the last time it was read, when editing by anchor. A mismatch refuses the edit before anything is written.",
        }),
      ),
    }),
  ),
});

/** An edit that prefers anchors: line numbers plus a fingerprint from the last
 *  read. Called with lines alone it behaves exactly like the ordinary edit. */
export function anchorEditTool(opts: { cwd: string; delegate: EditDelegate }): ToolDefinition<typeof ANCHOR_EDIT_SCHEMA> {
  return {
    name: 'edit',
    label: 'Editing a file',
    description:
      'Make precise file edits. Either give the exact text to replace (edits[].oldText), or, when the file was read in this session and carries a fingerprint, give the line range and that fingerprint, and the change is made without retyping the old lines.',
    promptSnippet:
      'edit(path, edits): change a file by exact text, or by line numbers and the fingerprint from the last read',
    promptGuidelines: [
      'Use edit for precise changes. Each edits[].oldText must match exactly, including all whitespace.',
      'When you just read the file, its reply ends with a fingerprint like [src/app.ts#A1B2]. Use startLine, endLine and tag instead of retyping the old text; it takes fewer tokens and refuses cleanly if the file has changed.',
      'When changing multiple separate locations in one file, use one edit call with multiple entries.',
      'A stale fingerprint is refused with a message that says to re-read the file. Do that, then try again.',
    ],
    parameters: ANCHOR_EDIT_SCHEMA,
    executionMode: 'sequential',
    execute: async (_callId, params, signal) => {
      const anchored = params.edits.some((edit) => edit.tag !== undefined || edit.startLine !== undefined);
      if (!anchored) {
        if (params.edits.some((edit) => edit.oldText === undefined)) {
          return textResult(
            'Each edit needs either the exact text to replace, or a line range with the fingerprint from the last read.',
            {},
          );
        }
        try {
          return await opts.delegate(
            {
              path: params.path,
              edits: params.edits.map((edit) => ({ oldText: edit.oldText as string, newText: edit.newText })),
            },
            signal,
          );
        } catch (cause) {
          throw new Error(cause instanceof Error ? cause.message : 'The edit did not go through.');
        }
      }

      if (params.edits.some((edit) => edit.tag === undefined || edit.startLine === undefined)) {
        return textResult(
          'An edit by anchor needs the fingerprint (tag) and the first line (startLine) for every entry. Either give every edit both, or leave them all out and edit by exact text.',
          {},
        );
      }

      // One anchored change per call, by design: line numbers shift the moment
      // a change lands, and the reply carries the new fingerprint, so the model
      // chains by editing again rather than batching stale numbers together.
      // The reply's fingerprint is the target for the next edit.
      if (params.edits.length > 1) {
        return textResult(
          'Change one place per anchored edit call. The reply carries the file\'s new fingerprint, so make the next edit against that.',
          {},
        );
      }

      const edit = params.edits[0];
      if (edit === undefined) {
        return textResult('This edit had nothing in it.', {});
      }
      const absolute = resolve(opts.cwd, params.path);

      // Preflight in memory; nothing is written until the anchor has checked
      // out against the file as it is right now.
      let current: string;
      try {
        current = await readFile(absolute, 'utf8');
      } catch {
        return textResult(`I could not read ${params.path} to edit it. Is it still there?`, {});
      }
      const last = edit.endLine ?? edit.startLine;
      const outcome = applyAnchor(current.split('\n'), {
        tag: edit.tag as string,
        startLine: edit.startLine as number,
        endLine: last,
        newText: edit.newText,
      });
      if (outcome.error !== null) return textResult(outcome.error, {});
      if (outcome.lines.join('\n') === current) {
        return textResult('That edit would change nothing. The lines already say that.', {});
      }

      const written = outcome.lines.join('\n');
      const newTag = fingerprint(written);
      try {
        await writeFile(absolute, written);
        refreshSnapshot(absolute, written);
      } catch (cause) {
        throw new Error(cause instanceof Error ? cause.message : 'The file could not be written.');
      }

      const details = {
        diff: written.split('\n').slice(Math.max(0, (edit.startLine as number) - 4), (edit.startLine as number) + 4).join('\n'),
        patch: renderPatch(params.path, current.split('\n'), outcome.lines),
        firstChangedLine: edit.startLine as number,
      };
      return textResult(
        `Lines ${edit.startLine}–${last} of ${params.path} changed; its new fingerprint is [${params.path}#${newTag}].`,
        details,
      );
    },
  };
}

/* -------------------------------------------------------------------------- */
/* Reading with a fingerprint                                                 */
/* -------------------------------------------------------------------------- */

/** The ordinary read, handed in by the adapter: Pi's own read tool. */
export type ReadDelegate = (
  params: { path: string; offset?: number; limit?: number },
  signal: AbortSignal | undefined,
) => Promise<AgentToolResult<unknown>>;

/** Files big enough to make a fingerprint useless are left alone. */
const MAX_TAGGED_BYTES = 1_000_000;

const READ_SCHEMA = Type.Object({
  path: Type.String({ description: 'Path to the file to read.' }),
  offset: Type.Optional(Type.Number({ description: 'First line, 1-indexed.' })),
  limit: Type.Optional(Type.Number({ description: 'How many lines to read.' })),
});

/** A read whose reply ends with the file's fingerprint, which the anchored
 *  edit then uses. The fingerprint is a fact about the file, not a decoration:
 *  without it the model cannot say which version of the file it means. */
export function taggedReadTool(opts: {
  cwd: string;
  delegate: ReadDelegate;
}): ToolDefinition<typeof READ_SCHEMA> {
  return {
    name: 'read',
    label: 'Reading a file',
    description:
      'Read file contents. The reply ends with the file\'s current fingerprint when the file is text. Keep it, and an edit can name lines instead of retyping them.',
    promptSnippet: 'read(path): read a file; its reply carries the fingerprint edit can target',
    promptGuidelines: [
      'Use read to examine files instead of cat or sed.',
      'The fingerprint at the end of the reply (like [src/app.ts#A1B2]) names the version you read. Give it to edit along with line numbers when you want to change those lines.',
    ],
    parameters: READ_SCHEMA,
    executionMode: 'sequential',
    execute: async (_callId, params, signal) => {
      const result = await opts.delegate(params, signal);
      const content = result.content;
      const textIndex = content.findIndex((entry) => entry.type === 'text');
      if (textIndex < 0) return result;
      const textEntry = content[textIndex];
      if (textEntry === undefined || textEntry.type !== 'text' || !textEntry.text) return result;

      // The fingerprint belongs to the whole file, so it is minted from disk
      // rather than from whatever portion of it was read.
      try {
        const absolute = resolve(opts.cwd, params.path);
        const file = await readFile(absolute, 'utf8');
        if (file.length > MAX_TAGGED_BYTES) return result;
        const tag = refreshSnapshot(absolute, file);
        const withTag = content.map((entry, index) =>
          index === textIndex && entry.type === 'text'
            ? { ...entry, text: `${entry.text}\n\n[${params.path}#${tag}]` }
            : entry,
        );
        return { ...result, content: withTag };
      } catch {
        return result;
      }
    },
  };
}