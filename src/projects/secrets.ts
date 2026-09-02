/** The credentials this computer holds on somebody's behalf.
 *
 * Next to `preferences.ts` and `recents.ts` because it is the same kind of
 * thing — one small file under the app's own data directory, read once at
 * startup, written whole and atomically, and never the source of an error a
 * designer has to read. The one difference is the one that matters: nothing in
 * here is ever written in the clear.
 *
 * ## Why the locking is an argument
 *
 * The lock is the operating system's own — the login keychain on a Mac, the
 * equivalent elsewhere — reached through Electron's `safeStorage`. Importing
 * Electron here would make this module unloadable outside a running app and
 * untestable without one, so the two methods it actually needs arrive as a
 * `Cipher` instead. The main process passes `safeStorage`; a test passes
 * something it can reason about.
 *
 * ## No plaintext fallback
 *
 * When the lock is unavailable, storing is refused. A key written in the clear
 * is a key that survives in a backup, a sync folder and a support bundle long
 * after anybody remembers putting it there, and "we tried our best" is not a
 * thing to say about somebody's account.
 */

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';

/** The two operations this needs from whatever holds the lock. `available` is
 *  asked every time, because a keychain can be locked after the app started. */
export type Cipher = {
  available(): boolean;
  encrypt(plain: string): Buffer;
  decrypt(sealed: Buffer): string;
};

/** What came of trying to keep something. A refusal carries the sentence to
 *  show, so no caller has to invent one. */
export type Kept = { ok: true } | { ok: false; why: string };

/** Plain language, and only as much of it as is true. */
const SAY = {
  noLock:
    'This computer will not let me lock a private key away, and I will not keep one lying around unlocked. Nothing has been saved.',
  notSaved:
    'I could not save that on this computer, so it will be gone when you quit. Nothing else has changed.',
  blank: 'There was nothing there to save.',
} as const;

type Stored = { version: 1; secrets: Record<string, string> };

function asSealed(value: unknown): Map<string, Buffer> {
  const sealed = new Map<string, Buffer>();
  if (typeof value !== 'object' || value === null) return sealed;
  const raw = (value as { secrets?: unknown }).secrets;
  if (typeof raw !== 'object' || raw === null) return sealed;
  for (const [name, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== 'string' || entry === '') continue;
    sealed.set(name, Buffer.from(entry, 'base64'));
  }
  return sealed;
}

export class SecretFile {
  /** Unlocked, and held only in memory. Whatever could not be unlocked is
   *  simply not here. */
  #values = new Map<string, string>();

  private constructor(
    private readonly file: string,
    private readonly cipher: Cipher,
  ) {}

  static async open(file: string, cipher: Cipher): Promise<SecretFile> {
    const secrets = new SecretFile(resolve(file), cipher);
    await secrets.#read();
    return secrets;
  }

  /** Can anything be kept at all? Worth asking before offering to. */
  canKeep(): boolean {
    return this.#lockWorks();
  }

  has(name: string): boolean {
    return this.#values.has(name);
  }

  get(name: string): string | null {
    return this.#values.get(name) ?? null;
  }

  /** Every value being held, for the Guard's list of the user's own keys. The
   *  Guard needs the values themselves to spot one being echoed somewhere it
   *  should not go. */
  values(): string[] {
    return [...this.#values.values()];
  }

  /** What is being held, by name only. Reading a group of them — every provider
   *  sign-in, say — needs the names and nothing else. */
  names(): string[] {
    return [...this.#values.keys()];
  }

  async keep(name: string, value: string): Promise<Kept> {
    const secret = value.trim();
    if (secret === '') return { ok: false, why: SAY.blank };
    if (!this.#lockWorks()) return { ok: false, why: SAY.noLock };

    const before = this.#values.get(name);
    this.#values.set(name, secret);
    if (await this.#write()) return { ok: true };

    // Held for this run either way, but say so rather than let a person believe
    // it was put somewhere.
    if (before === undefined) this.#values.delete(name);
    else this.#values.set(name, before);
    return { ok: false, why: SAY.notSaved };
  }

  /** Letting go never needs the lock, so it always works. */
  async forget(name: string): Promise<void> {
    if (!this.#values.delete(name)) return;
    await this.#write();
  }

  #lockWorks(): boolean {
    try {
      return this.cipher.available();
    } catch {
      return false;
    }
  }

  async #read(): Promise<void> {
    let sealed: Map<string, Buffer>;
    try {
      sealed = asSealed(JSON.parse(await readFile(this.file, 'utf8')));
    } catch {
      return;
    }
    if (!this.#lockWorks()) return;
    for (const [name, entry] of sealed) {
      try {
        const value = this.cipher.decrypt(entry);
        if (value !== '') this.#values.set(name, value);
      } catch {
        // Locked by a different machine or a different login. Not ours to read.
      }
    }
  }

  /** True when the file on disk now says what memory says. */
  async #write(): Promise<boolean> {
    const secrets: Record<string, string> = {};
    try {
      for (const [name, value] of this.#values) {
        secrets[name] = this.cipher.encrypt(value).toString('base64');
      }
    } catch {
      return false;
    }

    const stored: Stored = { version: 1, secrets };
    const temporary = join(dirname(this.file), `.${basename(this.file)}.writing`);
    try {
      await mkdir(dirname(this.file), { recursive: true });
      // Locked already; readable by this login only is the belt to that brace.
      await writeFile(temporary, `${JSON.stringify(stored, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporary, this.file);
      return true;
    } catch {
      return false;
    }
  }
}

/* -------------------------------------------------------------------------- */
/* Provider sign-ins                                                           */
/* -------------------------------------------------------------------------- */

/**
 * The keys that pay for the work, kept the same way as everything else here.
 *
 * The agent runtime keeps its own `auth.json` — user-only, but in the clear —
 * and that is where an OAuth refresh token and an API key sit today. Mirrored
 * here they are behind the login keychain like every other credential this app
 * holds, and `writeProviderAuth` hands the runtime a file it can read for the
 * length of a launch.
 *
 * The name is the provider's own id, because that is the key the runtime looks
 * the credential up by and a translation table between the two would be one
 * more thing to get wrong.
 */
const PROVIDER = 'provider:';

export function providerKey(provider: string): string {
  return `${PROVIDER}${provider}`;
}

/** What this needs of the store. `SecretFile` is one; a test is another. */
export type HoldsProviders = {
  canKeep(): boolean;
  get(name: string): string | null;
  keep(name: string, value: string): Promise<Kept>;
  forget(name: string): Promise<void>;
  names(): string[];
};

/** Keep one provider's credential, exactly as the runtime wrote it. */
export async function keepProviderCredential(
  secrets: HoldsProviders,
  provider: string,
  credential: unknown,
): Promise<Kept> {
  return secrets.keep(providerKey(provider), JSON.stringify(credential));
}

export async function forgetProviderCredential(secrets: HoldsProviders, provider: string): Promise<void> {
  await secrets.forget(providerKey(provider));
}

/** Every provider sign-in being held, in the shape `auth.json` is read in.
 *  Anything that will not parse is left out rather than written back as text a
 *  runtime would choke on. */
export function providerCredentials(secrets: HoldsProviders): Record<string, unknown> {
  const all: Record<string, unknown> = {};
  for (const name of secrets.names()) {
    if (!name.startsWith(PROVIDER)) continue;
    const kept = secrets.get(name);
    if (kept === null) continue;
    try {
      all[name.slice(PROVIDER.length)] = JSON.parse(kept);
    } catch {
      /* not ours to repair */
    }
  }
  return all;
}

/** Where the runtime is pointed at, when there is anything to point it at. */
export function authPathIn(userData: string): string {
  return join(userData, 'pi', 'auth.json');
}

/**
 * Write the runtime its credentials at launch, and answer with the path.
 *
 * Null when nothing is mirrored yet, which is the signal to leave the runtime
 * on its own default — an empty file handed over would read as "signed out of
 * everything" and lose somebody their account for the length of a session.
 */
export async function writeProviderAuth(
  userData: string,
  secrets: HoldsProviders,
): Promise<string | null> {
  const all = providerCredentials(secrets);
  if (Object.keys(all).length === 0) return null;

  const file = authPathIn(userData);
  const temporary = join(dirname(file), `.${basename(file)}.writing`);
  try {
    await mkdir(dirname(file), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(all, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    await rename(temporary, file);
    return file;
  } catch {
    return null;
  }
}
