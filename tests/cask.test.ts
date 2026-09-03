/** The cask beside the source is a template, and a template with real numbers
 *  in it is a trap.
 *
 * A version and a checksum committed here go stale the next time anything is
 * built, and a cask carrying one version's name over another version's bytes is
 * the one thing a cask must never do. The release workflow writes both from the
 * zips it just made; this is the guard that they are still its to write.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const cask = readFileSync(fileURLToPath(new URL('../Casks/graphe.rb', import.meta.url)), 'utf8');
const workflow = readFileSync(
  fileURLToPath(new URL('../.github/workflows/release.yml', import.meta.url)),
  'utf8',
);

const PLACEHOLDER = 'REPLACED_BY_RELEASE_WORKFLOW';

/** The cask itself, without the instructions above it. Those are for whoever
 *  edits this file and never reach the tap. */
const body = cask.slice(cask.indexOf('cask "graphe" do'));

/** The only part of the file somebody installing this ever reads. */
const caveats = body.slice(body.indexOf('caveats'));

describe('the cask template', () => {
  it('names no version of its own', () => {
    expect(cask).toContain(`version "${PLACEHOLDER}"`);
  });

  it('says nothing to a person with an em dash in it', () => {
    expect(caveats).not.toContain('\u2014');
  });

  it('carries no checksum of its own, for either architecture', () => {
    expect(cask).toContain(`sha256 arm:   "${PLACEHOLDER}",`);
    expect(cask).toContain(`intel: "${PLACEHOLDER}"`);
    // Nothing that looks like a real one anywhere else in the file.
    expect(cask).not.toMatch(/"[0-9a-f]{64}"/);
  });

  it('is copied from the cask itself, so the instructions above it stay here', () => {
    expect(workflow).toContain(`sed -n '/^cask "graphe" do/,$p' Casks/graphe.rb`);
  });

  it('has every placeholder written by the workflow, and none left behind', () => {
    for (const line of cask.split('\n')) {
      if (!line.includes(PLACEHOLDER)) continue;
      const field = /^\s*(version|sha256 arm:|intel:)/.exec(line)?.[1];
      expect(field, `nothing fills in: ${line.trim()}`).toBeDefined();
    }
    expect(workflow).toContain('s/^  version \\".*\\"/  version \\"$VERSION\\"/');
    expect(workflow).toContain('s/^  sha256 arm:   \\".*\\",/  sha256 arm:   \\"$arm\\",/');
    expect(workflow).toContain('s/^         intel: \\".*\\"/         intel: \\"$intel\\"/');
  });

  it('never disarms Gatekeeper on somebody else’s behalf', () => {
    expect(body).not.toContain('no_quarantine');
    expect(body).not.toContain('xattr');
  });
});
