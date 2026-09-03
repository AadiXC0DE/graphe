// @vitest-environment jsdom
/** Settings as pages you can search, and the controls that had nowhere else.
 *
 * `work/settingspages.ts` says what every preference is and which page it lives
 * on; this is the screen that draws it. What is worth guarding is the join: a
 * row in the model that the screen has no control for is a row somebody presses
 * and nothing happens, and that is exactly the failure the pages were meant to
 * end.
 *
 * The rest is the three controls that moved off the model chip: the advisor's
 * two gates, and how much of an add-on runs.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { advisorSwitchWords } from '../src/agent/advisor';
import { defaultAppearance } from '../src/design/appearance';
import { policyWords } from '../src/agent/pi/extension-policy';
import Settings from '../src/components/Settings';
import { ACTIONS } from '../src/lib/actions';
import { PAGES, ROWS, pageWords, rowsOn, settingsWords } from '../src/work/settingspages';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom has no media queries; the theme row asks which way the computer is
  // running so it can name it.
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as typeof window.matchMedia;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

function open(props: Partial<Parameters<typeof Settings>[0]> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => {
    createRoot(host).render(
      createElement(Settings, {
        open: true,
        onClose: () => {},
        showMe: false,
        showFiles: false,
        holdBack: false,
        keepLogins: false,
        always: null,
        theme: 'system',
        onTheme: () => {},
        onToggleShowMe: () => {},
        onToggleShowFiles: () => {},
        onToggleHoldBack: () => {},
        onToggleKeepLogins: () => {},
        onGo: () => {},
        ...props,
      }),
    );
  });
  return host;
}

const names = (host: HTMLElement): string[] =>
  [...host.querySelectorAll('.settings__name')].map((one) => one.textContent ?? '');

const pageButton = (host: HTMLElement, name: string): HTMLElement =>
  ([...host.querySelectorAll('.settings__page')] as HTMLElement[]).find(
    (one) => one.textContent === name,
  ) as HTMLElement;

const type = (host: HTMLElement, text: string): void => {
  const field = host.querySelector('.settings__search') as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

describe('the pages', () => {
  it('are all offered, and one is open', () => {
    const host = open();
    expect([...host.querySelectorAll('.settings__page')].map((one) => one.textContent)).toEqual(
      PAGES.map((one) => pageWords[one].name),
    );
    expect(host.querySelector('.settings__page--on')?.textContent).toBe(pageWords.appearance.name);
  });

  /* The whole point of the model: a row it files on a page and the screen has
     no control for is a row nobody can use. */
  it('draw a control for every row the model files on them', () => {
    for (const page of PAGES) {
      const host = open();
      act(() => {
        pageButton(host, pageWords[page].name).click();
      });
      for (const row of rowsOn(page)) {
        expect(names(host), `${page}/${row.id}`).toContain(row.name);
      }
    }
  });

  it('open on the page holding a row asked for by name', () => {
    const host = open({ startAt: 'keep-logins' });
    expect(host.querySelector('.settings__page--on')?.textContent).toBe(pageWords.privacy.name);
    expect(names(host)).toContain('Stay signed in while I browse');
  });
});

describe('searching', () => {
  it('finds a row on another page, and says which page it came from', () => {
    const host = open();
    type(host, 'cookies');
    expect(names(host)).toContain('Stay signed in while I browse');
    expect(host.querySelector('.settings__from')?.textContent).toBe(settingsWords.on('privacy'));
    // The sidebar follows the answer rather than the last press.
    expect(host.querySelector('.settings__page--on')?.textContent).toBe(pageWords.privacy.name);
  });

  it('says nothing rather than everything for a word that is not here', () => {
    const host = open();
    type(host, 'kubernetes');
    expect(host.querySelector('.settings__empty')?.textContent).toBe(settingsWords.nothing);
    expect(names(host)).toEqual([]);
  });
});

describe('the advisor gates, which used to be on the chip', () => {
  it('are two switches on Models, off unless somebody turned one on', () => {
    const host = open({
      advisorGates: { completionGate: true, loopGate: false },
      onAdvisorGate: () => {},
    });
    act(() => {
      pageButton(host, pageWords.models.name).click();
    });
    expect(names(host)).toContain(advisorSwitchWords.completionGate.label);
    expect(names(host)).toContain(advisorSwitchWords.loopGate.label);

    const switches = [...host.querySelectorAll('[role="switch"]')] as HTMLElement[];
    const gate = switches.find(
      (one) => one.getAttribute('aria-label') === advisorSwitchWords.completionGate.label,
    );
    expect(gate?.getAttribute('aria-checked')).toBe('true');
  });

  it('hand back which one was flipped', () => {
    const got: [string, boolean][] = [];
    const host = open({
      advisorGates: { completionGate: false, loopGate: false },
      onAdvisorGate: (which, on) => got.push([which, on]),
    });
    act(() => {
      pageButton(host, pageWords.models.name).click();
    });
    const gate = ([...host.querySelectorAll('[role="switch"]')] as HTMLElement[]).find(
      (one) => one.getAttribute('aria-label') === advisorSwitchWords.loopGate.label,
    ) as HTMLElement;
    act(() => gate.click());
    expect(got).toEqual([['loopGate', true]]);
  });

  /* Without somewhere to write them the rows are not drawn: a switch over
     nothing is worse than no switch. */
  it('are not drawn where nothing can be written', () => {
    const host = open();
    act(() => {
      pageButton(host, pageWords.models.name).click();
    });
    expect(names(host)).not.toContain(advisorSwitchWords.loopGate.label);
  });
});

describe('how much of an add-on runs', () => {
  const openAddons = (props: Partial<Parameters<typeof Settings>[0]>): HTMLElement => {
    const host = open(props);
    act(() => {
      pageButton(host, pageWords['add-ons'].name).click();
    });
    return host;
  };

  it('is three choices, with the one in force ticked', () => {
    const host = openAddons({ addons: 'tools-only', onAddons: () => {} });
    const choices = [...host.querySelectorAll('[role="radio"]')] as HTMLElement[];
    expect(choices.map((one) => one.textContent)).toEqual([
      policyWords.on,
      policyWords.toolsOnly,
      policyWords.off,
    ]);
    expect(choices.map((one) => one.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
    ]);
  });

  it('hands back the one pressed, including off', () => {
    const got: string[] = [];
    const host = openAddons({ addons: 'on', onAddons: (choice) => got.push(choice) });
    const choices = [...host.querySelectorAll('[role="radio"]')] as HTMLElement[];
    act(() => (choices[2] as HTMLElement).click());
    expect(got).toEqual(['off']);
  });

  it('names each add-on loaded here and what it will do', () => {
    const host = openAddons({
      addons: 'on',
      onAddons: () => {},
      addonsHere: [
        {
          name: 'storybook',
          says: 'starts turns on its own',
          policy: 'tools-only',
          startsTurns: true,
          runsBackgroundWork: false,
          rewritesSystemPrompt: false,
        },
      ],
    });
    expect(names(host)).toContain('storybook');
    expect(host.textContent).toContain('starts turns on its own');
    expect(host.textContent).toContain('Runs tools only');
  });
});

describe('the keys', () => {
  it('read out every action and the chord it answers to', () => {
    const host = open({ onMac: true });
    act(() => {
      pageButton(host, pageWords.keys.name).click();
    });
    const row = ([...host.querySelectorAll('.settings__row')] as HTMLElement[]).find(
      (one) => one.textContent?.startsWith('Keyboard shortcuts') === true,
    ) as HTMLElement;
    expect(row.getAttribute('aria-expanded')).toBe('false');
    act(() => row.click());

    const said = [...host.querySelectorAll('.settings__chordlist li')].map(
      (one) => one.textContent ?? '',
    );
    expect(said).toHaveLength(ACTIONS.length);
    expect(said.some((one) => one.startsWith('Ask for anything') && one.endsWith('⌘K'))).toBe(true);
    // An action with no key of its own says so rather than showing a gap.
    expect(said.some((one) => one.endsWith('No key'))).toBe(true);
  });

  it('lead to the command palette rather than describing it', () => {
    const went: string[] = [];
    const host = open({ onGo: (link) => went.push(link) });
    act(() => {
      pageButton(host, pageWords.keys.name).click();
    });
    const row = ([...host.querySelectorAll('.settings__row')] as HTMLElement[]).find(
      (one) => one.textContent?.startsWith('The command palette') === true,
    ) as HTMLElement;
    act(() => row.click());
    expect(went).toEqual(['palette']);
  });
});

describe('what the screen must not lose', () => {
  it('still reaches every screen the old sheet led to', () => {
    for (const [id, page] of [
      ['skills', 'add-ons'],
      ['connected', 'add-ons'],
      ['add-more', 'add-ons'],
      ['usage', 'models'],
      ['folder', 'storage'],
      ['editor', 'advanced'],
    ] as const) {
      const went: string[] = [];
      const host = open({ onGo: (link) => went.push(link) });
      act(() => {
        pageButton(host, pageWords[page].name).click();
      });
      const name = ROWS.find((one) => one.id === id)?.name ?? '';
      const row = ([...host.querySelectorAll('.settings__row')] as HTMLElement[]).find(
        (one) => one.textContent?.startsWith(name) === true,
      ) as HTMLElement;
      act(() => row.click());
      expect(went, id).toEqual([id]);
    }
  });

  it('still carries the theme picker and the appearance band', () => {
    const host = open({ appearance: defaultAppearance, onAppearance: () => {} });
    expect(host.querySelectorAll('.settings__theme').length).toBeGreaterThan(1);
    expect(host.querySelector('.settings__system')).not.toBeNull();
    expect(host.querySelector('.appearance')).not.toBeNull();
  });
});
