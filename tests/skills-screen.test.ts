// @vitest-environment jsdom
/** The skills library, and the one action it exists for.
 *
 * Reading a skill was never the hard part; using it was, because the handle
 * had to be remembered and typed back into the box. So what is guarded here is
 * the join: the rows are grouped the way the library is, the arrow keys move
 * through them in that order, and the press hands `@handle ` to the composer
 * and gets out of the way.
 */

import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import Skills, { SAYS, shortPath } from '../src/components/Skills';
import type { Skill, Workflow } from '../src/lib/ipc';

beforeAll(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

const hosts: HTMLElement[] = [];
afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
});

const skill = (id: string, source: Skill['source']): Skill => ({
  id,
  name: `The ${id} skill`,
  handle: id,
  description: `What ${id} is for`,
  source,
  path: `/Users/someone/.pi/skills/${id}/SKILL.md`,
});

const workflow: Workflow = {
  command: '/ship',
  name: 'ship',
  description: 'Cut a release',
  hint: null,
  source: 'project',
};

function open(props: Partial<Parameters<typeof Skills>[0]> = {}): HTMLElement {
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  act(() => {
    createRoot(host).render(
      createElement(Skills, {
        open: true,
        skills: [skill('drift', 'project'), skill('legible', 'global')],
        workflows: [workflow],
        onClose: () => {},
        onRefresh: () => {},
        onOpen: () => Promise.resolve('# Drift\n\nWhat it does.'),
        ...props,
      }),
    );
  });
  return host;
}

const text = (host: HTMLElement, selector: string): string[] =>
  [...host.querySelectorAll(selector)].map((one) => one.textContent ?? '');

const type = (host: HTMLElement, said: string): void => {
  const field = host.querySelector('.skills__find') as HTMLInputElement;
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      'value',
    )?.set;
    setter?.call(field, said);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  });
};

const press = (host: HTMLElement, says: string): HTMLButtonElement => {
  const found = [...host.querySelectorAll('button')].find((one) => one.textContent?.trim() === says);
  if (found === undefined) throw new Error(`no press called ${says}`);
  return found as HTMLButtonElement;
};

describe('the library', () => {
  it('groups the rows the way the library is arranged', () => {
    const host = open();
    expect(text(host, '.skills__grouphead')).toEqual([
      SAYS.groups.project,
      SAYS.groups.global,
      SAYS.groups.workflows,
    ]);
  });

  it('shows every row its handle, and a workflow its command', () => {
    const host = open();
    expect(text(host, '.skills__row code')).toEqual(['@drift', '@legible', '/ship']);
  });

  it('narrows to what was typed, and says so when nothing matches', () => {
    const host = open();
    type(host, 'legible');
    expect(text(host, '.skills__row strong')).toEqual(['The legible skill']);
    type(host, 'zzzz');
    expect(host.querySelector('.skills__none')?.textContent).toBe(SAYS.noneFound);
  });

  it('offers somewhere to go when there is nothing installed at all', () => {
    let asked = false;
    const host = open({ skills: [], workflows: [], onAddMore: () => (asked = true) });
    expect(host.querySelector('.skills__none')?.textContent).toContain(SAYS.none);
    act(() => press(host, SAYS.addMore).click());
    expect(asked).toBe(true);
  });
});

describe('reading one', () => {
  it('draws the name, the path and the instructions as markdown', async () => {
    const host = open();
    await act(async () => {
      host.querySelectorAll('button.skills__row')[0]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    expect(host.querySelector('.skills__name')?.textContent).toBe('The drift skill');
    expect(host.querySelector('.skills__path code')?.textContent).toBe('skills/drift/SKILL.md');
    // Markdown, not a <pre>: the heading in the file is a heading on screen.
    expect(host.querySelector('.skills__says .md__heading')?.textContent).toContain('Drift');
    expect(host.querySelector('.skills__says pre')).toBeNull();
  });

  /* Only with nothing to open. A list beside an empty half is a screen that has
     taught the hand there is nothing to read here, when there plainly is. */
  it('says nothing is selected only when there is nothing to select', () => {
    const bare = open({ skills: [], workflows: [] });
    expect(bare.querySelector('.skills__blank')?.textContent).toBe(SAYS.nothing);
  });

  it('opens on the first row there is, the project’s own before the computer’s', () => {
    const host = open();
    expect(host.querySelector('.skills__row--here strong')?.textContent).toBe('The drift skill');
  });

  /** The whole point of the screen. */
  it('hands the handle to the composer and closes', async () => {
    const put: string[] = [];
    let closed = false;
    const host = open({ onUse: (one) => put.push(one), onClose: () => (closed = true) });
    await act(async () => {
      host.querySelectorAll('button.skills__row')[1]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    act(() => press(host, SAYS.use).click());
    expect(put).toEqual(['@legible']);
    expect(closed).toBe(true);
  });

  it('runs a workflow rather than using it, and inserts the command', () => {
    const put: string[] = [];
    const host = open({ onUse: (one) => put.push(one) });
    act(() => {
      host.querySelectorAll('button.skills__row')[2]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    act(() => press(host, SAYS.run).click());
    expect(put).toEqual(['/ship']);
  });

  it('opens the file it is reading, by row rather than by path', async () => {
    const opened: string[] = [];
    const host = open({ onOpenFile: (one) => opened.push(one.id) });
    await act(async () => {
      host.querySelectorAll('button.skills__row')[0]!.dispatchEvent(
        new MouseEvent('click', { bubbles: true }),
      );
    });
    act(() => press(host, SAYS.openFile).click());
    expect(opened).toEqual(['drift']);
  });
});

describe('the keyboard', () => {
  const key = async (name: string): Promise<void> => {
    await act(async () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: name, bubbles: true }));
    });
  };

  it('moves down the whole list, skills then workflows', async () => {
    const host = open();
    // The first is already open, so the first press is the second row.
    expect(host.querySelector('.skills__row--here strong')?.textContent).toBe('The drift skill');
    await key('ArrowDown');
    expect(host.querySelector('.skills__row--here strong')?.textContent).toBe('The legible skill');
    await key('ArrowDown');
    expect(host.querySelector('.skills__row--here strong')?.textContent).toBe('ship');
  });

  it('uses the selected row on Enter', async () => {
    const put: string[] = [];
    open({ onUse: (one) => put.push(one) });
    await key('Enter');
    expect(put).toEqual(['@drift']);
    await key('ArrowDown');
    await key('Enter');
    expect(put).toEqual(['@drift', '@legible']);
  });

  it('closes on Escape', async () => {
    let closed = false;
    open({ onClose: () => (closed = true) });
    await key('Escape');
    expect(closed).toBe(true);
  });
});

describe('the path a person recognises', () => {
  it('shows the tail from the skills folder down', () => {
    expect(shortPath('/Users/x/.pi/skills/drift/SKILL.md')).toBe('skills/drift/SKILL.md');
    expect(shortPath('/somewhere/else/SKILL.md')).toBe('/somewhere/else/SKILL.md');
  });
});
