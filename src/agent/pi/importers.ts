/** Accounts other tools have saved on this computer.
 *
 *  opencode and Codex each keep their own auth file, and each carries the
 *  accounts a person already owns — an Anthropic key they pasted once, a
 *  ChatGPT Plus sign-in, a DeepSeek key. Reading those files is the whole of
 *  the "extremely easier" promise: the accounts are already on the machine,
 *  and the connect screen's job is to notice them, not to make the person
 *  paste the same key a second time.
 *
 *  This module is deliberately boring and deliberately free of anything
 *  else: no Pi imports (it would only mean an upgrade could break the
 *  reading of two other tools' files), no secrets crossing any boundary
 *  until `importAccount` asks for the one it was told to carry. The window
 *  only ever sees `FoundAccount` — a name, a kind, a sentence of where it
 *  came from.
 */

import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/** The two files worth reading. */
export type FoundSource = 'opencode' | 'codex';

/** A provider the opencode or Codex files know a credential for, with the
 *  parts the window is allowed to see. */
export type FoundAccount = {
  /** The provider, spelled the way Pi spells it — see `toPiProviderId`. */
  providerId: string;
  /** 'api-key' — a key somebody pasted once. 'sign-in' — a token that came
   *  from a subscription login (ChatGPT Plus, Copilot). Both arrive at the
   *  same provider in the end; the window says different sentences about
   *  them, because a sign-in token is somebody else's promise and a key is
   *  the person's own. */
  kind: 'api-key' | 'sign-in';
  source: FoundSource;
};

/** The same, with the secret attached. Never leaves the main process, and
 *  never shows up in a `FoundAccount` that does. */
export type FoundCredential = FoundAccount & { secret: string };

/** opencode's provider ids are not always Pi's. `azure-openai` is the
 *  notable one; the rest are listed so a provider that stops matching is a
 *  visible omission rather than a silent pass-through. A provider absent
 *  from this table is one this app cannot carry yet — Copilot's OAuth
 *  session token is its own protocol, and a ChatGPT token is not an
 *  Anthropic key no matter which file it sits in. */
const TO_PI: Readonly<Record<string, string>> = {
  'amazon-bedrock': 'amazon-bedrock',
  anthropic: 'anthropic',
  'azure-openai': 'azure-openai-responses',
  baseten: 'baseten',
  cerebras: 'cerebras',
  'cloudflare-ai-gateway': 'cloudflare-ai-gateway',
  'cloudflare-workers-ai': 'cloudflare-workers-ai',
  deepseek: 'deepseek',
  fireworks: 'fireworks',
  google: 'google',
  'google-vertex': 'google-vertex',
  groq: 'groq',
  huggingface: 'huggingface',
  minimax: 'minimax',
  mistral: 'mistral',
  moonshotai: 'moonshotai',
  nvidia: 'nvidia',
  openai: 'openai',
  opencode: 'opencode',
  'opencode-go': 'opencode-go',
  openrouter: 'openrouter',
  together: 'together',
  'vercel-ai-gateway': 'vercel-ai-gateway',
  xai: 'xai',
  zai: 'zai',
};

export function toPiProviderId(provider: string): string | null {
  return TO_PI[provider] ?? null;
}

/** Where the files live on this computer. The real paths are worked out at
 *  read time and never cached: the person can install opencode while this
 *  app is open, and a list that only finds out on the next restart is a
 *  list that lies. */
export function credentialFiles(): readonly { source: FoundSource; path: string }[] {
  const home = homedir();
  const data = process.env.XDG_DATA_HOME ?? join(home, '.local', 'share');
  const config = process.env.XDG_CONFIG_HOME ?? join(home, '.config');
  const codexHome = process.env.CODEX_HOME ?? join(home, '.codex');
  return [
    { source: 'opencode', path: join(data, 'opencode', 'auth.json') },
    // Older opencode releases kept the file under the config directory.
    { source: 'opencode', path: join(config, 'opencode', 'auth.json') },
    { source: 'codex', path: join(codexHome, 'auth.json') },
  ];
}

/** Every credential both tools have saved, newest file first so a provider
 *  both of them know is represented by the file that was most recently
 *  written. Broken files are passed over — a file another tool left half
 *  written is not worth a sentence. */
export async function readFoundCredentials(
  files?: readonly { source: FoundSource; path: string }[],
): Promise<readonly FoundCredential[]> {
  const wanted = files ?? credentialFiles();
  const found: FoundCredential[] = [];
  for (const { source, path } of wanted) {
    let text: string;
    try {
      text = readFileSync(path, 'utf-8');
    } catch {
      continue;
    }
    found.push(...parseCredentials(text, source));
  }
  return found;
}

/** One account per provider — the one this app would actually use. When two
 *  files both know a provider, a key wins over a sign-in (a key is the
 *  person's own promise; a token is somebody else's), and opencode wins over
 *  Codex when the choice is otherwise even. */
export function collectAccounts(
  found: readonly FoundCredential[],
): readonly FoundAccount[] {
  const best = new Map<string, FoundCredential>();
  for (const one of found) {
    const kept = best.get(one.providerId);
    if (kept === undefined) {
      best.set(one.providerId, one);
      continue;
    }
    if (kept.kind === one.kind && kept.source === 'opencode') continue;
    if (kept.kind === 'api-key' && one.kind === 'sign-in') continue;
    best.set(one.providerId, one);
  }
  return [...best.values()].map(({ providerId, kind, source }) => ({
    providerId,
    kind,
    source,
  }));
}

/** The one credential that would carry `account`, or null when the file no
 *  longer has it. Re-read at import time rather than carried from discovery,
 *  so the window cannot ask for an account that was revoked a second ago
 *  and get the dead secret. */
export async function credentialFor(
  account: FoundAccount,
  files?: readonly { source: FoundSource; path: string }[],
): Promise<FoundCredential | null> {
  const wanted = files ?? credentialFiles();
  const all = await readFoundCredentials(wanted);
  const matches = all.filter(
    (one) =>
      one.providerId === account.providerId &&
      one.source === account.source &&
      one.kind === account.kind,
  );
  if (matches.length === 0) return null;
  // Newest file first (`readFoundCredentials` order) already gives us the
  // preferred one, but two files of the same source are possible (old and
  // new opencode locations) — the later entry in the file list is newer.
  return matches[matches.length - 1] ?? null;
}

/* -------------------------------------------------------------------------- */
/* The two files, each read leniently.                                         */
/* -------------------------------------------------------------------------- */

/** opencode's `auth.json`: one entry per provider, carrying either an API
 *  key (`type: "api"`) or a subscription token (`type: "Bearer"`), under
 *  `key` or `token` respectively. Anything that does not look like one of
 *  those — a `basic` username/password pair, a command substitution — is
 *  passed over, because a provider we cannot carry should not sit in the
 *  list pretending it could be carried. */
export function parseOpencodeAuth(text: string): readonly FoundCredential[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];

  const found: FoundCredential[] = [];
  for (const [provider, raw] of Object.entries(data as Record<string, unknown>)) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const entry = raw as Record<string, unknown>;
    const key = typeof entry.key === 'string' && entry.key !== '' ? entry.key : undefined;
    const token =
      typeof entry.token === 'string' && entry.token !== '' ? entry.token : undefined;
    if (key === undefined && token === undefined) continue;

    const providerId = toPiProviderId(provider);
    if (providerId === null) continue;

    if (key !== undefined) {
      found.push({ providerId, kind: 'api-key', source: 'opencode', secret: key });
      continue;
    }
    found.push({ providerId, kind: 'sign-in', source: 'opencode', secret: token as string });
  }
  return found;
}

/** Codex's `auth.json`: an `OPENAI_API_KEY` when somebody pasted a key. That
 *  is the only thing in it this app can carry.
 *
 *  Its `tokens` block holds a ChatGPT sign-in, which is not a key and cannot
 *  be sent to the same address a key goes to. Signing in with ChatGPT is a
 *  button on the connect screen and works properly; offering the sign-in here
 *  as well only ever produced a connection that failed on first use. */
export function parseCodexAuth(text: string): readonly FoundCredential[] {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return [];
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return [];

  const entry = data as Record<string, unknown>;
  if (typeof entry.OPENAI_API_KEY !== 'string' || entry.OPENAI_API_KEY === '') return [];
  return [
    {
      providerId: 'openai',
      kind: 'api-key',
      source: 'codex',
      secret: entry.OPENAI_API_KEY,
    },
  ];
}

function parseCredentials(text: string, source: FoundSource): readonly FoundCredential[] {
  return source === 'opencode' ? parseOpencodeAuth(text) : parseCodexAuth(text);
}
