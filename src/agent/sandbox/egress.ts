/** Which addresses work is allowed to reach, and the one door it goes through.
 *
 * The boundary can refuse a port. It cannot read a name, so `reach: 'secure'`
 * meant "anything at all, as long as it is https" — which is the shape of every
 * quiet copy of a folder out to somebody else's machine.
 *
 * So the rule moves up one floor. A small listener is opened on this machine,
 * the bound command is pointed at it and allowed to reach nothing else, and the
 * listener is what reads the address. A connection is passed through only when
 * the name it asked for is on the list; anything else gets a refusal it can read
 * and no bytes at all. Nothing is decrypted on the way past — the connection is
 * carried through untouched once the name has been checked, so this never sees
 * what is inside it.
 *
 * Two audiences, as ever. Nobody has to know it is there: the list already
 * covers the places ordinary work reaches, and it is on by default. Somebody who
 * needs another address adds it — `GRAPHE_EGRESS_HOSTS=a.example.com,*.b.dev`,
 * or by handing hosts in.
 *
 * It fails towards saying so. If the door cannot be opened, the caller is told
 * in a sentence and gets no port — it is never left believing addresses are
 * being checked when they are not.
 */

import { createServer, connect, type Server, type Socket } from 'node:net';

/** The places the app itself reaches, and the ones ordinary work reaches on the
 *  way to getting anything done. Grouped so a missing one is easy to place. */
const KNOWN_HOSTS: readonly string[] = [
  // Where a model answers from.
  'api.anthropic.com',
  'api.openai.com',
  'openrouter.ai',
  'api.deepseek.com',
  'api.groq.com',
  'api.mistral.ai',
  'api.x.ai',
  'api.together.xyz',
  'api.cerebras.ai',
  'api.fireworks.ai',
  'api.moonshot.cn',
  'api.minimax.chat',
  'api.baseten.co',
  'api.z.ai',
  'api-inference.huggingface.co',
  'huggingface.co',
  'cdn-lfs.huggingface.co',
  'integrate.api.nvidia.com',
  'generativelanguage.googleapis.com',
  '*.googleapis.com',
  '*.openai.azure.com',
  '*.amazonaws.com',
  'gateway.ai.cloudflare.com',
  'api.cloudflare.com',
  'ai-gateway.vercel.sh',
  'models.dev',
  'opencode.ai',

  // Where a package comes from.
  'registry.npmjs.org',
  '*.npmjs.org',
  'registry.yarnpkg.com',
  'nodejs.org',
  'pypi.org',
  'files.pythonhosted.org',
  'crates.io',
  'static.crates.io',
  'index.crates.io',
  'proxy.golang.org',
  'sum.golang.org',
  'rubygems.org',
  '*.rubygems.org',
  'repo.maven.apache.org',
  'get.pnpm.io',
  'deno.land',
  'jsr.io',

  // Where code and its releases are kept.
  'github.com',
  'api.github.com',
  'codeload.github.com',
  'raw.githubusercontent.com',
  'objects.githubusercontent.com',
  '*.githubusercontent.com',
  'gitlab.com',
  'bitbucket.org',

  // What a page or a build asks for while it is being made.
  'cdn.jsdelivr.net',
  'unpkg.com',
  'esm.sh',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',

  // What the app already looks things up with.
  'html.duckduckgo.com',
  'lite.duckduckgo.com',
  'duckduckgo.com',
  'arxiv.org',
  'export.arxiv.org',
  'api.figma.com',
  'www.figma.com',
  'figma.com',
];

/** The addresses somebody on this computer has added by hand. */
function addedByHand(): string[] {
  return (process.env['GRAPHE_EGRESS_HOSTS'] ?? '')
    .split(/[,\s]+/)
    .map((host) => host.trim())
    .filter((host) => host !== '');
}

/** Every address work may reach: the ones the app knows, the ones this computer
 *  was told about, and whatever the caller adds. */
export function reachableHosts(extra: readonly string[] = []): string[] {
  const list: string[] = [];
  for (const host of [...KNOWN_HOSTS, ...addedByHand(), ...extra]) {
    const tidy = tidyHost(host);
    if (tidy !== null && !list.includes(tidy)) list.push(tidy);
  }
  return list;
}

/**
 * Every address work may reach, given the providers this computer is signed in
 * to.
 *
 * The list above is kept by hand, so a provider somebody added themselves is a
 * provider whose model call is turned down with a sentence about the network —
 * which is the wrong sentence, in the one place a person cannot act on it. The
 * addresses the providers actually answer at are already written down in the
 * models file; this reads them from there rather than waiting to be told.
 */
export function hostsFor(providerBaseUrls: readonly string[]): readonly string[] {
  return reachableHosts(providerBaseUrls.flatMap(hostOf));
}

/** The name out of a base address, however it was written down. A bare host is
 *  taken as one; anything that is not an address at all is dropped. */
function hostOf(baseUrl: string): string[] {
  const said = baseUrl.trim();
  if (said === '') return [];
  for (const candidate of [said, `https://${said}`]) {
    try {
      const host = tidyHost(new URL(candidate).hostname);
      if (host !== null) return [host];
    } catch {
      /* try it as a bare name, then give up on it */
    }
  }
  return [];
}

/** One address, in the one spelling everything here compares. */
function tidyHost(candidate: string): string | null {
  const host = candidate.trim().toLowerCase().replace(/\.$/, '');
  if (host === '' || /[^a-z0-9.*:_-]/.test(host)) return null;
  return host;
}

/**
 * Is this address on the list?
 *
 * `*.example.com` covers anything under it and not the name itself, so an
 * address is never opened up by a pattern that was meant for what sits below it.
 */
export function hostAllowed(host: string, hosts: readonly string[]): boolean {
  const asked = tidyHost(host);
  if (asked === null) return false;
  for (const entry of hosts) {
    if (entry === asked) return true;
    if (entry.startsWith('*.') && asked.endsWith(entry.slice(1)) && asked.length > entry.length - 1) {
      return true;
    }
  }
  return false;
}

/** The door, once it is open, or the reason there is none. */
export type Doorway =
  | {
      open: true;
      /** On this machine, and only reachable from it. */
      port: number;
      hosts: readonly string[];
      /** Addresses that were asked for and turned down, newest last. */
      turnedAway: () => readonly string[];
      close: () => Promise<void>;
    }
  | {
      open: false;
      /** Plain enough to show somebody. */
      sentence: string;
      detail: string;
    };

export type DoorwayOptions = {
  /** Addresses to allow on top of the ones every run gets. */
  hosts?: readonly string[];
  /** Which ports may be asked for. Secure only, unless somebody says otherwise. */
  ports?: readonly number[];
  /** Long enough for a slow handshake, short enough that a wedged connection
   *  cannot hold a port open all day. */
  patienceMs?: number;
};

const CANNOT_OPEN =
  'I could not set up the check on which addresses this work may reach, so it is limited to secure addresses without me reading which ones. Only the Guard is watching what it asks for.';

/** How long a connection may sit before it is let go of. */
const PATIENCE_MS = 120_000;

/** As much of a request line as anything sane sends, so a client that sends
 *  nothing but header cannot be used to fill this process's memory. */
const MOST_HEADER = 16 * 1024;

/**
 * Open the door and answer with the port it is on.
 *
 * Only `CONNECT` is answered. Everything ordinary work does over https arrives
 * that way, and an address asked for in the clear is one the boundary was not
 * letting out anyway.
 */
export function openDoorway(options: DoorwayOptions = {}): Promise<Doorway> {
  const hosts = reachableHosts(options.hosts ?? []);
  const ports = options.ports ?? [443];
  const patience = options.patienceMs ?? PATIENCE_MS;
  const turnedAway: string[] = [];
  const live = new Set<Socket>();

  let server: Server;
  try {
    server = createServer();
  } catch (cause) {
    return Promise.resolve({ open: false, sentence: CANNOT_OPEN, detail: messageOf(cause) });
  }

  server.on('connection', (from) => {
    live.add(from);
    from.once('close', () => live.delete(from));
    from.setTimeout(patience, () => from.destroy());
    greet(from, hosts, ports, patience, turnedAway, live);
  });

  return new Promise<Doorway>((settled) => {
    const failed = (cause: unknown) => {
      server.close();
      settled({ open: false, sentence: CANNOT_OPEN, detail: messageOf(cause) });
    };
    server.once('error', failed);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (address === null || typeof address === 'string') {
        failed(new Error('the door came up with no port'));
        return;
      }
      server.removeListener('error', failed);
      // A door nobody is using must not keep the app alive.
      server.on('error', () => {});
      server.unref();
      settled({
        open: true,
        port: address.port,
        hosts,
        turnedAway: () => [...turnedAway],
        close: () =>
          new Promise<void>((done) => {
            for (const socket of live) socket.destroy();
            live.clear();
            server.close(() => done());
          }),
      });
    });
  });
}

/** Read the first request off a connection and decide what happens to it. */
function greet(
  from: Socket,
  hosts: readonly string[],
  ports: readonly number[],
  patience: number,
  turnedAway: string[],
  live: Set<Socket>,
): void {
  let header = '';
  const read = (chunk: Buffer) => {
    header += chunk.toString('latin1');
    const end = header.indexOf('\r\n\r\n');
    if (end === -1) {
      if (header.length > MOST_HEADER) {
        from.removeListener('data', read);
        refuse(from, 'that request was longer than anything here answers');
      }
      return;
    }
    from.removeListener('data', read);
    const line = header.slice(0, header.indexOf('\r\n'));
    const asked = connectTarget(line, ports);
    if (asked === null) {
      refuse(from, 'only a secure connection to a named address goes through here');
      return;
    }
    if (!hostAllowed(asked.host, hosts)) {
      turnedAway.push(asked.host);
      refuse(from, `${asked.host} is not on the list of addresses this work may reach`);
      return;
    }
    carry(from, asked, patience, live);
  };
  from.on('data', read);
  from.on('error', () => from.destroy());
}

/** The address a `CONNECT` line asked for, when it asked for one we would ever
 *  open: a name, and the secure port. */
function connectTarget(line: string, ports: readonly number[]): { host: string; port: number } | null {
  const parts = /^CONNECT\s+(\S+)\s+HTTP\/1\.[01]$/i.exec(line.trim());
  const target = parts?.[1];
  if (target === undefined) return null;
  const split = target.lastIndexOf(':');
  if (split <= 0) return null;
  const host = target.slice(0, split);
  const port = Number(target.slice(split + 1));
  if (!ports.includes(port)) return null;
  const tidy = tidyHost(host);
  return tidy === null ? null : { host: tidy, port };
}

/** Pass the bytes through, having read nothing but the name. */
function carry(
  from: Socket,
  asked: { host: string; port: number },
  patience: number,
  live: Set<Socket>,
): void {
  const onward = connect({ host: asked.host, port: asked.port });
  live.add(onward);
  onward.once('close', () => live.delete(onward));
  onward.setTimeout(patience, () => onward.destroy());
  onward.once('error', () => {
    refuse(from, `${asked.host} could not be reached`);
    onward.destroy();
  });
  onward.once('connect', () => {
    from.write('HTTP/1.1 200 Connection Established\r\n\r\n');
    from.pipe(onward);
    onward.pipe(from);
  });
  from.once('error', () => onward.destroy());
  from.once('close', () => onward.destroy());
}

/** Turn a connection down in words the command asking can print. */
function refuse(from: Socket, because: string): void {
  const body = `${because}. Add it with GRAPHE_EGRESS_HOSTS if it belongs here.\n`;
  const bytes = Buffer.byteLength(body);
  from.end(
    `HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: ${String(bytes)}\r\nConnection: close\r\n\r\n${body}`,
  );
}

/**
 * What a command has to be told for it to use the door.
 *
 * Every one of these spellings is read by something: the lower-case pair by curl
 * and git, the upper-case pair by most of the rest, and the node one by a script
 * that reaches out with the runtime's own fetch, which ignores the others.
 */
export function doorwayEnvironment(port: number): Record<string, string> {
  const address = `http://127.0.0.1:${String(port)}`;
  return {
    HTTP_PROXY: address,
    http_proxy: address,
    HTTPS_PROXY: address,
    https_proxy: address,
    ALL_PROXY: address,
    all_proxy: address,
    NO_PROXY: 'localhost,127.0.0.1,::1',
    no_proxy: 'localhost,127.0.0.1,::1',
    NODE_USE_ENV_PROXY: '1',
    npm_config_proxy: address,
    npm_config_https_proxy: address,
  };
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message !== '' ? cause.message : 'the door could not be opened';
}
