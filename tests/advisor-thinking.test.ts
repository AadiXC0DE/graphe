// @vitest-environment jsdom
/** How long the advisor thinks, and where that is set.
 *
 * The model doing the work has had a "Thinking time" row inside the model
 * picker since it was built. The advisor — chosen from inside that same picker,
 * and the one actually being paid to think hard — had none, so the only way to
 * change it was to open the addition's own settings file by hand.
 *
 * The row is the same grammar as the one above it. What is worth guarding is
 * that it is not offered when there is nothing behind it: nobody advising, or a
 * model with one speed.
 */

import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { advisorWords } from '../src/agent/advisor';
import ThinkingWith from '../src/components/ThinkingWith';
import type { ConnectionState, ModelChoice, ThinkingLevel } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: HTMLElement[] = [];
/* Unmounted, not merely removed: the menu is drawn at the window, so leaving a
   root alive leaves its menu in the document for the next test to find. */
const roots: Root[] = [];
afterEach(() => {
  act(() => {
    for (const one of roots.splice(0)) one.unmount();
  });
  for (const host of hosts.splice(0)) host.remove();
});

/** Take whatever is open down before opening another, so two menus are never in
 *  the document at once. */
function shut(): void {
  act(() => {
    for (const one of roots.splice(0)) one.unmount();
  });
  for (const host of hosts.splice(0)) host.remove();
}

const model = (id: string, label: string, rates: { input: number; output: number }, thinking: readonly ThinkingLevel[]) => ({
  id,
  label,
  available: true,
  rates,
  contextWindow: null,
  takesImages: true,
  thinking,
});

/** One account with a cheap model and a dear one, which is what makes a second
 *  opinion worth offering at all. */
const state = (advisorThinking: readonly ThinkingLevel[]): ConnectionState => ({
  chosen: { providerId: 'anthropic', modelId: 'haiku' },
  chosenThinking: 'off',
  providers: [
    {
      providerId: 'anthropic',
      name: 'Anthropic',
      methods: [],
      oauthLabel: null,
      apiKeyLabel: null,
      connected: true,
      available: true,
      subscription: false,
      models: [
        model('haiku', 'Haiku', { input: 0.8, output: 4 }, ['off', 'low', 'high']),
        model('opus', 'Opus', { input: 15, output: 75 }, advisorThinking),
      ],
    },
  ],
});

const OPUS: ModelChoice = { providerId: 'anthropic', modelId: 'opus' };

function open(props: Partial<Parameters<typeof ThinkingWith>[0]>): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const root = createRoot(host);
  roots.push(root);
  act(() => {
    root.render(
      createElement(ThinkingWith, {
        state: state(['off', 'low', 'high']),
        onSelect: () => {},
        onConnect: () => {},
        onAdvisor: () => {},
        onAdvisorThinking: () => {},
        ...props,
      }),
    );
  });
  // The chip, then the row that leads to the advisor. The menu is drawn at the
  // window rather than inside the chip, so it is the document that holds it.
  act(() => {
    (host.querySelector('.thinking__chip') as HTMLElement).click();
  });
  const rows = [...document.querySelectorAll('.thinking__tune')] as HTMLElement[];
  const toAdvisor = rows.find((one) => one.textContent?.startsWith(advisorWords.name));
  if (toAdvisor !== undefined) act(() => toAdvisor.click());
  return host;
}

const paceRow = (_host: HTMLElement): HTMLElement | undefined =>
  ([...document.querySelectorAll('.thinking__tune')] as HTMLElement[]).find((one) =>
    one.textContent?.startsWith(advisorWords.thinking),
  );

describe('the row inside the advisor', () => {
  it('is there once somebody is advising', () => {
    const host = open({ advisor: OPUS });
    expect(paceRow(host)?.textContent).toContain(advisorWords.thinking);
  });

  /** Nothing to set a pace for. The row would be a control over nobody. */
  it('is not there while the advisor is off', () => {
    expect(paceRow(open({ advisor: null }))).toBeUndefined();
  });

  it('is not there for a model that only answers straight away', () => {
    const host = open({ advisor: OPUS, state: state(['off']) });
    expect(paceRow(host)).toBeUndefined();
  });

  it('is not there when the window above has nowhere to write it', () => {
    const host = open({ advisor: OPUS, onAdvisorThinking: undefined });
    expect(paceRow(host)).toBeUndefined();
  });

  /** Until somebody answers, the advising model's own setting stands — naming
   *  a rung it may not be on would be a lie on the row. */
  it('says default until it has been set, and the level after', () => {
    expect(paceRow(open({ advisor: OPUS }))?.textContent).toContain(advisorWords.thinkingUnset);
    shut();
    expect(paceRow(open({ advisor: OPUS, advisorThinking: 'high' }))?.textContent).toContain('high');
  });
});

describe('behind the row', () => {
  it('offers only the levels that model accepts, and hands back which one', () => {
    let got: [ModelChoice, ThinkingLevel] | null = null;
    const host = open({
      advisor: OPUS,
      state: state(['off', 'medium', 'max']),
      onAdvisorThinking: (choice, level) => {
        got = [choice, level];
      },
    });
    act(() => {
      (paceRow(host) as HTMLElement).click();
    });

    const levels = [...document.querySelectorAll('.thinking__pace-level')] as HTMLElement[];
    expect(levels.map((one) => one.querySelector('.thinking__pace-name')?.textContent)).toEqual([
      'off',
      'medium',
      'max',
    ]);

    act(() => {
      (levels[2] as HTMLElement).click();
    });
    expect(got).toEqual([OPUS, 'max']);
  });

  it('names the model being set, not the one doing the work', () => {
    const host = open({ advisor: OPUS });
    act(() => {
      (paceRow(host) as HTMLElement).click();
    });
    expect(document.querySelector('.thinking__selectedmodel')?.textContent).toBe('Opus');
    // Back goes to the advisor it came from, not past it to the model list.
    expect(document.querySelector('.thinking__back')?.textContent).toContain(advisorWords.name);
  });
});
