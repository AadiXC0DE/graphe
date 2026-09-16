// @vitest-environment jsdom
/** The command is shown beside the description, never inside it.
 *
 * The fallback used to read "/tidy — a way of working…" and the list stripped
 * that prefix back off by matching the exact separator, so changing the
 * separator in one file put the prefix on screen from the other.
 */

import { act, createElement, type ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Composer from '../src/components/Composer';
import { readWorkflow } from '../src/work/workflows';

beforeAll(() => {
  const runtime = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean; ResizeObserver?: unknown };
  runtime.IS_REACT_ACT_ENVIRONMENT = true;
  runtime.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const NOTHING = (): void => undefined;

function draw(element: ReactElement): HTMLDivElement {
  host = document.createElement('div');
  host.className = 'app';
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(element);
  });
  return host;
}

function boxIn(where: HTMLElement): HTMLTextAreaElement {
  const field = where.querySelector('textarea');
  if (field === null) throw new Error('the composer drew no box');
  return field as HTMLTextAreaElement;
}

/** Typing, the way React hears it. */
function type(field: HTMLTextAreaElement, text: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  if (setter === undefined) throw new Error('no value setter on a textarea');
  act(() => {
    setter.call(field, text);
    field.selectionStart = text.length;
    field.selectionEnd = text.length;
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const DESCRIPTION = '/tidy — a way of working this project added.';

describe('a workflow with no description of its own', () => {
  it('does not put the command inside the sentence', () => {
    const read = readWorkflow({ name: 'tidy.md', body: 'Tidy the thing.' }, 'project');
    expect(read.ok).toBe(true);
    if (!read.ok) return;

    // The sentence a person reads on the row, with no "/tidy — " in front of it.
    expect(read.workflow.description).toBe('A way of working this project added.');
    expect(read.workflow.description).not.toContain(read.workflow.command);
  });

  it('is shown as written, with nothing stripped off the front', () => {
    const host = draw(
      createElement(Composer, {
        onSend: NOTHING,
        workflows: [
          {
            command: '/tidy',
            name: 'tidy',
            description: DESCRIPTION,
            hint: null,
            source: 'project' as const,
          },
        ],
      }),
    );

    type(boxIn(host), '/');

    const row = host.querySelector('.composer__skills button');
    expect(row?.querySelector('strong')?.textContent).toBe('/tidy');
    expect(row?.querySelector('small')?.textContent).toBe(DESCRIPTION);
  });
});
