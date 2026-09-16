/** Which folder the app keeps its files in, and who gets to move it.
 *
 * A test profile is only disposable if nothing in it can reach the real one:
 * the folder has to come from the environment or the command line, the app's
 * own folder has to stay untouched when nobody named one, and Pi's credential
 * folder — which is `~/.pi/agent` by default, a real person's sign-ins — has to
 * move with it. The module is plain data in and plain data out, so all of that
 * is asserted here without Electron.
 */

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  AGENT_DIR_ENV,
  AGENT_FOLDER,
  PROFILE_ENV,
  PROFILE_SWITCH,
  applyProfile,
  describeProfile,
  isDisposableProfile,
  profileRoot,
  resolveProfile,
} from '../../electron/profile';

/* ------------------------------------------------------------ scaffolding */

/** Stands in for the app: one path, remembered, and a note of having been told
 *  to change it. */
function host(userData: string) {
  const told: string[] = [];
  let at = userData;
  return {
    told,
    get at() {
      return at;
    },
    getPath: (_name: 'userData'): string => at,
    setPath: (_name: 'userData', path: string): void => {
      told.push(path);
      at = path;
    },
  };
}

/** Electron's argv as the shell really receives it: the app path first,
 *  Chromium's own switches wherever they were typed. */
function argvOf(...switches: string[]): string[] {
  return ['/Applications/Graphe.app/Contents/MacOS/Graphe', '.', ...switches];
}

const A_PLACE = join(tmpdir(), 'graphe-profile-named-by-nobody');

/* ------------------------------------------------------------------- tests */

describe('which folder the app uses', () => {
  it('takes the environment variable first, and everything follows it', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphe-profile-env-'));
    try {
      const profile = resolveProfile([], { [PROFILE_ENV]: root }, A_PLACE);
      expect(profile.root).toBe(root);
      expect(profile.source).toBe('env');
      expect(profile.agent).toBe(join(root, AGENT_FOLDER));
      expect(isDisposableProfile(profile)).toBe(true);
      expect(profileRoot([], { [PROFILE_ENV]: root }, A_PLACE)).toBe(root);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('takes the switch in both spellings', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphe-profile-argv-'));
    try {
      for (const args of [argvOf(`${PROFILE_SWITCH}=${root}`), argvOf(PROFILE_SWITCH, root)]) {
        const profile = resolveProfile(args, {}, A_PLACE);
        expect(profile.root).toBe(root);
        expect(profile.source).toBe('argv');
        expect(isDisposableProfile(profile)).toBe(true);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('lets the environment win over the switch', () => {
    const environmental = mkdtempSync(join(tmpdir(), 'graphe-profile-env-wins-'));
    const switched = mkdtempSync(join(tmpdir(), 'graphe-profile-argv-loses-'));
    try {
      const profile = resolveProfile(
        argvOf(`${PROFILE_SWITCH}=${switched}`),
        { [PROFILE_ENV]: environmental },
        A_PLACE,
      );
      expect(profile.root).toBe(environmental);
      expect(profile.source).toBe('env');
    } finally {
      rmSync(environmental, { recursive: true, force: true });
      rmSync(switched, { recursive: true, force: true });
    }
  });

  it('leaves the app its own folder when nobody named one', () => {
    const profile = resolveProfile(argvOf('--enable-logging'), {}, A_PLACE);
    expect(profile.root).toBe(A_PLACE);
    expect(profile.source).toBe('user-data');
    // Pi's own `~/.pi/agent` is left where it is: moving a real person's
    // credentials is not something an upgrade gets to do.
    expect(profile.agent).toBeNull();
    expect(isDisposableProfile(profile)).toBe(false);
    expect(applyProfile(host(A_PLACE), argvOf(), {})).toEqual(profile);
  });

  it('reads no name out of an empty one', () => {
    const switched = mkdtempSync(join(tmpdir(), 'graphe-profile-blank-env-'));
    try {
      // `GRAPHE_PROFILE=` is a variable somebody meant to fill in, not a folder
      // called nothing; the switch still holds.
      const profile = resolveProfile(
        argvOf(`${PROFILE_SWITCH}=${switched}`),
        { [PROFILE_ENV]: '  ' },
        A_PLACE,
      );
      expect(profile.root).toBe(switched);
      expect(profile.source).toBe('argv');

      // And with neither, the app's own folder.
      expect(resolveProfile(argvOf(PROFILE_SWITCH), {}, A_PLACE).root).toBe(A_PLACE);
      expect(resolveProfile(argvOf(`${PROFILE_SWITCH}=`), {}, A_PLACE).root).toBe(A_PLACE);
    } finally {
      rmSync(switched, { recursive: true, force: true });
    }
  });

  it('refuses a path that is not absolute rather than guessing where it is', () => {
    expect(() => resolveProfile([], { [PROFILE_ENV]: 'tmp/profile' }, A_PLACE)).toThrow(
      new RegExp(PROFILE_ENV),
    );
    expect(() => resolveProfile(argvOf(`${PROFILE_SWITCH}=tmp/profile`), {}, A_PLACE)).toThrow(
      new RegExp(PROFILE_SWITCH),
    );
    // The switch is read after the environment: a bad variable is still a bad
    // variable, and falling through to the switch would look like it worked.
    const switched = mkdtempSync(join(tmpdir(), 'graphe-profile-bad-env-'));
    try {
      expect(() =>
        resolveProfile(argvOf(`${PROFILE_SWITCH}=${switched}`), { [PROFILE_ENV]: 'tmp/x' }, A_PLACE),
      ).toThrow(new RegExp(PROFILE_ENV));
    } finally {
      rmSync(switched, { recursive: true, force: true });
    }
  });
});

describe('pointing the app at a profile', () => {
  it('moves the app, Pi credentials included, when one was named', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphe-profile-apply-'));
    rmSync(root, { recursive: true, force: true });
    try {
      const app = host(A_PLACE);
      const env: Record<string, string | undefined> = { [PROFILE_ENV]: root };
      const profile = applyProfile(app, argvOf(), env);

      expect(app.at).toBe(root);
      expect(app.told).toEqual([root]);
      // Pi creates its folder on sight, and the log is opened before ready.
      expect(existsSync(root)).toBe(true);
      expect(env[AGENT_DIR_ENV]).toBe(join(root, AGENT_FOLDER));
      expect(describeProfile(profile)).toContain(root);
      expect(describeProfile(profile)).toContain(PROFILE_ENV);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('leaves Pi alone when the credential folder was named separately', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphe-profile-pi-kept-'));
    try {
      const env: Record<string, string | undefined> = {
        [PROFILE_ENV]: root,
        [AGENT_DIR_ENV]: '/somewhere/else',
      };
      applyProfile(host(A_PLACE), argvOf(), env);
      expect(env[AGENT_DIR_ENV]).toBe('/somewhere/else');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('says which folder it is using, and who asked', () => {
    const root = mkdtempSync(join(tmpdir(), 'graphe-profile-words-'));
    try {
      expect(describeProfile(resolveProfile(argvOf(PROFILE_SWITCH, root), {}, A_PLACE))).toBe(
        `profile ${root} (from ${PROFILE_SWITCH})`,
      );
      expect(describeProfile(resolveProfile([], {}, A_PLACE))).toBe(
        `profile ${A_PLACE} (the app's own folder)`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
