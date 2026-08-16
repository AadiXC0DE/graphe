/** Conventional naming: the type a piece of work is, from its own title.
 *
 * Pure — a title in, a type or a subject out — so the classifier is held to
 * account in tests rather than on the day's branch list. */

import { describe, expect, it } from 'vitest';

import {
  commitSubject,
  conventionalType,
  stripType,
} from '../src/lib/conventional';

describe('what kind of work a title is', () => {
  it('reads a fix from a title about fixing', () => {
    expect(conventionalType('Fixed the nav alignment')).toBe('fix');
    expect(conventionalType('Repair the broken checkout')).toBe('fix');
    expect(conventionalType('Guard against the empty state')).toBe('fix');
  });

  it('reads new work when the title is about adding or making', () => {
    expect(conventionalType('Made the header sticky')).toBe('feat');
    expect(conventionalType('Add a contact form')).toBe('feat');
    expect(conventionalType('Gave the pricing cards more room')).toBe('feat');
  });

  it('reads a refactor from tidying, renaming or removing', () => {
    expect(conventionalType('Tidy the layout files')).toBe('refactor');
    expect(conventionalType('Rename the button labels')).toBe('refactor');
    expect(conventionalType('Remove the old sidebar')).toBe('refactor');
  });

  it('reads docs and chores when the words say so', () => {
    expect(conventionalType('Document the colour tokens')).toBe('docs');
    expect(conventionalType('Bump the dependencies')).toBe('chore');
  });

  it('never guesses from the tool, only from the words', () => {
    expect(conventionalType('Turn off the lights')).toBe('feat');
    expect(conventionalType('')).toBe('feat');
  });
});

describe('the commit subject', () => {
  it('carries the type in front of the work’s own words', () => {
    expect(commitSubject('Made the header sticky')).toBe('feat: Made the header sticky');
    expect(commitSubject('Fixed the nav')).toBe('fix: Fixed the nav');
  });

  it('strips a known type back off, for the plain surface', () => {
    expect(stripType('feat: Made the header sticky')).toBe('Made the header sticky');
    expect(stripType('fix: Fixed the nav')).toBe('Fixed the nav');
    expect(stripType('chore: Bump the dependencies')).toBe('Bump the dependencies');
    // A type somebody else's tool wrote comes off too.
    expect(stripType('perf: Cache the images')).toBe('Cache the images');
    // No type, no change.
    expect(stripType('Made the header sticky')).toBe('Made the header sticky');
  });
});