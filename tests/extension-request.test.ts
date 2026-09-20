// @vitest-environment jsdom
/** The card an add-on's question is drawn on.
 *
 * The thing worth asserting is that every question has a way to say "nobody
 * answered", distinguishable from "no", because the default interface this
 * replaces answered everything itself and the add-on could not tell.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import ExtensionRequest, { SAYS } from '../src/components/ExtensionRequest';
import type { ExtensionAnswer, ExtensionRequest as Request } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const where = { project: '/work/site', conversation: 'one', requestId: 'addon-1' };

function draw(request: Partial<Request> & { kind: Request['kind'] }): {
  at: HTMLDivElement;
  answers: ExtensionAnswer[];
} {
  const answers: ExtensionAnswer[] = [];
  const full = { title: 'What shall it do?', ...where, ...request } as Request;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      createElement(ExtensionRequest, {
        request: full,
        onAnswer: (answer: ExtensionAnswer) => answers.push(answer),
      }),
    ),
  );
  return { at: host, answers };
}

describe('a choice', () => {
  it('offers every option the add-on gave, and answers with its value', () => {
    const { at, answers } = draw({
      kind: 'select',
      options: [
        { label: 'The first thing', value: 'one' },
        { label: 'The second thing', value: 'two' },
      ],
    } as Partial<Request> & { kind: Request['kind'] });
    const buttons = [...at.querySelectorAll('.addonask__choice')].map((one) => one.textContent);
    expect(buttons).toEqual(['The first thing', 'The second thing']);
    act(() => at.querySelectorAll<HTMLButtonElement>('.addonask__choice')[1]?.click());
    expect(answers).toEqual([{ kind: 'select', value: 'two' }]);
  });

  it('can be left unanswered, which is not the same as choosing nothing', () => {
    const { at, answers } = draw({
      kind: 'select',
      options: [{ label: 'Only', value: 'only' }],
    } as Partial<Request> & { kind: Request['kind'] });
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--keep')?.click());
    expect(answers).toEqual([{ kind: 'select', value: null }]);
  });
});

describe('a confirmation', () => {
  it('shows the add-on’s own sentence', () => {
    const { at } = draw({ kind: 'confirm', message: 'It will delete the old files.' });
    expect(at.textContent).toContain('It will delete the old files.');
  });

  it('answers yes only when yes was pressed', () => {
    const { at, answers } = draw({ kind: 'confirm', message: '' });
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--go')?.click());
    expect(answers).toEqual([{ kind: 'confirm', value: true }]);
  });

  it('answers no when it is declined, and no when it is closed', () => {
    const declined = draw({ kind: 'confirm', message: '' });
    act(() => declined.at.querySelector<HTMLButtonElement>('.addonask__button--keep')?.click());
    expect(declined.answers).toEqual([{ kind: 'confirm', value: false }]);
    expect(SAYS.decline).toBe('No');
  });
});

describe('something typed', () => {
  it('sends what was typed, and sends an empty answer as empty', () => {
    const { at, answers } = draw({ kind: 'input', placeholder: 'a name' });
    const field = at.querySelector<HTMLInputElement>('.addonask__field');
    expect(field?.placeholder).toBe('a name');
    act(() => {
      if (field === null) return;
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )?.set;
      setter?.call(field, 'index');
      field.dispatchEvent(new Event('input', { bubbles: true }));
    });
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--go')?.click());
    expect(answers).toEqual([{ kind: 'input', value: 'index' }]);
  });

  it('sends nothing when it is cancelled', () => {
    const { at, answers } = draw({ kind: 'input', placeholder: null });
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--keep')?.click());
    expect(answers).toEqual([{ kind: 'input', value: null }]);
  });
});

describe('an editor', () => {
  it('opens with what the add-on wrote, and sends it back edited', () => {
    const { at, answers } = draw({ kind: 'editor', prefill: 'the first draft' });
    const box = at.querySelector<HTMLTextAreaElement>('.addonask__editor');
    expect(box?.value).toBe('the first draft');
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--go')?.click());
    expect(answers).toEqual([{ kind: 'editor', value: 'the first draft' }]);
  });

  it('closes without sending when it is cancelled', () => {
    const { at, answers } = draw({ kind: 'editor', prefill: 'the first draft' });
    act(() => at.querySelector<HTMLButtonElement>('.addonask__button--keep')?.click());
    expect(answers).toEqual([{ kind: 'editor', value: null }]);
  });
});

describe('nothing asked', () => {
  it('draws nothing at all', () => {
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() =>
      root?.render(createElement(ExtensionRequest, { request: null, onAnswer: vi.fn() })),
    );
    expect(host.textContent).toBe('');
  });
});
