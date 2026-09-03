/** Where a tab sits is the person's to decide.
 *
 * The row is spatial memory, which is why the selected tab is never brought to
 * the front. It also has to be arrangeable, or the order is whatever order the
 * conversations happened to be opened in and nobody can put the two they are
 * working between next to each other.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { moveThread, noDesks, openDesk, showThread, threadsIn, type Desks } from '../src/lib/projects';

const tabs = readFileSync(
  fileURLToPath(new URL('../src/components/Tabs.tsx', import.meta.url)),
  'utf8',
);

const project = '/work/site';

/** A project with three conversations open, in the order they were opened. */
function three(): Desks {
  const held = openDesk(noDesks, { path: project, name: 'site' });
  const desk = held.byPath[project];
  if (desk === undefined) throw new Error('no desk');
  return {
    ...held,
    byPath: {
      ...held.byPath,
      [project]: {
        ...desk,
        address: '/a',
        parked: { '/b': { turns: [] }, '/c': { turns: [] } },
        order: ['/a', '/b', '/c'],
      },
    },
  };
}

const order = (held: Desks): readonly string[] =>
  threadsIn(held.byPath[project]!).map((one) => one.address);

describe('rearranging the row', () => {
  it('moves one tab to the front', () => {
    expect(order(moveThread(three(), project, '/c', 0))).toEqual(['/c', '/a', '/b']);
  });

  it('moves one tab to the end', () => {
    expect(order(moveThread(three(), project, '/a', 2))).toEqual(['/b', '/c', '/a']);
  });

  it('leaves the row alone when nothing moved', () => {
    const before = three();
    expect(moveThread(before, project, '/b', 1)).toBe(before);
  });

  /* A drag that ends off the end of the strip means the end of the strip. */
  it('clamps rather than losing the tab off either end', () => {
    expect(order(moveThread(three(), project, '/a', 99))).toEqual(['/b', '/c', '/a']);
    expect(order(moveThread(three(), project, '/c', -4))).toEqual(['/c', '/a', '/b']);
  });

  it('says nothing about a conversation this project does not have', () => {
    const before = three();
    expect(moveThread(before, project, '/gone', 0)).toBe(before);
  });

  it('keeps the conversation in front where it was', () => {
    const moved = moveThread(three(), project, '/c', 0);
    expect(moved.byPath[project]?.address).toBe('/a');
    expect(order(showThread(moved, project, '/b'))).toEqual(['/c', '/a', '/b']);
  });
});

describe('the row itself', () => {
  it('is draggable only where there is somewhere for a tab to go', () => {
    expect(tabs).toContain('draggable={onReorder !== undefined}');
  });

  it('draws the place a tab would land rather than shuffling under the pointer', () => {
    expect(tabs).toContain('tabs__tab--landing');
    expect(tabs).toContain("event.dataTransfer.dropEffect = 'move';");
  });
});
