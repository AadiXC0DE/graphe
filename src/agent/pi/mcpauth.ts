/** Signing in to a tool that lives on somebody else's computer.
 *
 * A server we start ourselves needs no credentials — it is already running as
 * the person who started it. A server at an address usually does, and the ones
 * worth reaching (Figma, Linear, Notion) all ask the same way: OAuth, in a
 * browser, once.
 *
 * The SDK does the protocol. What it does not have, and cannot have, is the
 * three things that are particular to a desktop app:
 *
 *   * somewhere for the browser to come back to — a loopback address on a port
 *     nobody else has, which is what RFC 8252 says a native app should use;
 *   * somewhere to keep what comes back, which on this machine means the login
 *     keychain and never a file in the clear;
 *   * a way to open the browser at all, which lives in the shell.
 *
 * All three arrive as arguments. Nothing here imports Electron, for the same
 * reason src/projects/secrets.ts does not: a module that needs a running app to
 * load is a module nobody can test.
 */

import { createServer, type Server } from 'node:http';
import { randomUUID } from 'node:crypto';
import { AddressInfo } from 'node:net';

import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';

/** Whatever is holding the keychain. `SecretFile` is one of these; a test can
 *  be another. Nothing is written that this cannot lock. */
export type Keeps = {
  canKeep(): boolean;
  get(name: string): string | null;
  keep(name: string, value: string): Promise<{ ok: boolean; why?: string }>;
  forget(name: string): Promise<void>;
};

/** What the shell does that this cannot: put a page in front of somebody. */
export type OpensPages = (url: URL) => void | Promise<void>;

/** Where the hosted document saying who Graphe is would be found.
 *
 *  Undefined, and deliberately, until graphe.xyz actually serves it: a server
 *  that supports this fetches the URL and uses it as the client id, so pointing
 *  at a name that does not answer is worse than not offering one at all. The
 *  document is written and sitting in site/oauth/client.json; the moment the
 *  domain serves it, this becomes that address and the registration round trip
 *  below stops happening.
 *
 *  Until then every server registers us itself, which is what the three we
 *  tried against do anyway. */
const WHO_WE_ARE: string | undefined = undefined;

/** How long somebody has to finish signing in before the door closes. Long
 *  enough to find the right account and a password manager; short enough that
 *  a forgotten tab is not a port held open all afternoon. */
const PATIENCE_MS = 5 * 60_000;

/** What the door heard. Never a rejection, so nothing is unhandled while the
 *  caller is still on its way to asking. */
type Returned = { ok: true; code: string } | { ok: false; why: string };

export const SAYS = {
  noLock:
    'This computer will not let me lock a sign-in away, and I will not keep one lying around unlocked. Nothing has been saved.',
  gaveUp: 'Nobody finished signing in, so I have stopped waiting.',
  refused: 'The sign-in came back refused.',
  noPort: 'I could not open a door for the browser to come back to.',
  notMine: 'The sign-in that came back was not the one I started.',
  nothingBack: 'No sign-in came back.',
} as const;

/* -------------------------------------------------------------------------- */
/* The door the browser comes back to                                          */
/* -------------------------------------------------------------------------- */

/** A loopback listener, open for one visit.
 *
 *  Started before the browser is, because the address it ends up on is part of
 *  what gets signed — the authorisation server is told where to come back, and
 *  it will refuse anywhere else. Port 0 so the operating system picks one that
 *  is free rather than us guessing and colliding with whatever else is running.
 */
export class TheDoor {
  private constructor(
    private readonly server: Server,
    readonly redirectUrl: string,
    private readonly arrived: Promise<Returned>,
  ) {}

  static async open(expectedState: string): Promise<TheDoor> {
    // Resolved either way, never rejected. Somebody can knock before anybody is
    // waiting — a stray request, or a refusal that beats the caller to it — and
    // a rejection with nothing attached to it yet is an unhandled one.
    let settle: (what: Returned) => void;
    const arrived = new Promise<Returned>((yes) => {
      settle = yes;
    });

    const server = createServer((request, response) => {
      const here = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (here.pathname !== '/callback') {
        response.writeHead(404).end();
        return;
      }
      const said = (title: string, body: string): void => {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(page(title, body));
      };
      const trouble = here.searchParams.get('error');
      if (trouble !== null) {
        said('That did not go through', here.searchParams.get('error_description') ?? trouble);
        settle({ ok: false, why: `${SAYS.refused} ${trouble}` });
        return;
      }
      // The state is the only thing standing between this port and any page on
      // the machine posting a code to it.
      if (here.searchParams.get('state') !== expectedState) {
        said('That did not go through', SAYS.notMine);
        settle({ ok: false, why: SAYS.notMine });
        return;
      }
      const code = here.searchParams.get('code');
      if (code === null || code === '') {
        said('That did not go through', SAYS.nothingBack);
        settle({ ok: false, why: SAYS.nothingBack });
        return;
      }
      said('Signed in', 'You can close this tab and go back to Graphe.');
      settle({ ok: true, code });
    });

    await new Promise<void>((ready, no) => {
      server.once('error', no);
      server.listen(0, '127.0.0.1', ready);
    });
    const port = (server.address() as AddressInfo | null)?.port;
    if (port === undefined) {
      server.close();
      throw new Error(SAYS.noPort);
    }
    return new TheDoor(server, `http://127.0.0.1:${String(port)}/callback`, arrived);
  }

  /** The code, or a sentence. Closes either way — one visit is all it is for. */
  async code(): Promise<string> {
    try {
      const what = await Promise.race([
        this.arrived,
        new Promise<Returned>((yes) => {
          setTimeout(() => yes({ ok: false, why: SAYS.gaveUp }), PATIENCE_MS).unref();
        }),
      ]);
      if (!what.ok) throw new Error(what.why);
      return what.code;
    } finally {
      this.close();
    }
  }

  close(): void {
    // On the next turn, so the page written a moment ago actually reaches the
    // browser rather than arriving as a reset connection.
    setTimeout(() => {
      this.server.close();
      this.server.closeAllConnections?.();
    }, 0).unref();
  }
}

/** The page somebody is left looking at. No stylesheet to fetch and nothing to
 *  click: it exists to say the tab is finished with. */
function page(title: string, body: string): string {
  const safe = (text: string): string =>
    text.replace(/[&<>"]/g, (one) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[one] ?? one);
  return `<!doctype html><meta charset="utf-8"><title>${safe(title)}</title>
<body style="font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;display:grid;place-items:center;min-height:100vh;background:#fbfbfa;color:#1c1c1b">
<main style="max-width:28rem;padding:2rem;text-align:center">
<h1 style="font-size:1.25rem;font-weight:520;margin:0 0 .5rem">${safe(title)}</h1>
<p style="margin:0;color:#6b6b68">${safe(body)}</p></main>`;
}

/* -------------------------------------------------------------------------- */
/* The client the servers are told about                                       */
/* -------------------------------------------------------------------------- */

/** One entry per server, so signing in to one is never signing in to another.
 *  The address is the identity: the same server at two addresses is two
 *  sign-ins, which is the safe way round. */
function keyFor(server: string, what: 'tokens' | 'client'): string {
  return `mcp:${what}:${new URL(server).href}`;
}

/**
 * The sign-in for one server.
 *
 * Made fresh for each attempt to connect, because the door it carries is good
 * for one visit. What it has already learned — the registration, the tokens —
 * outlives it in the keychain.
 */
export class BrowserSignIn {
  #verifier: string | null = null;

  private constructor(
    private readonly server: string,
    private readonly keeps: Keeps,
    private readonly opens: OpensPages,
    private readonly door: TheDoor,
    /** The same value the door is watching for. One thing, in two places, on
     *  purpose: it is what tells a real return apart from anything else on this
     *  machine that finds the port. */
    private readonly theState: string,
  ) {}

  /** The door opens first, before anything is asked of this.
   *
   *  Not lazily, tempting as that is. `redirectUrl` returning undefined is how
   *  the SDK is told this client cannot show anybody a page — it then goes
   *  looking for a machine-to-machine grant and fails on a contract nobody
   *  broke. A port held for the length of one connect is the cheaper mistake. */
  static async start(server: string, keeps: Keeps, opens: OpensPages): Promise<BrowserSignIn> {
    const state = randomUUID();
    const door = await TheDoor.open(state);
    return new BrowserSignIn(server, keeps, opens, door, state);
  }

  get redirectUrl(): string {
    return this.door.redirectUrl;
  }

  /** Who Graphe is, said once and hosted, rather than registered afresh on
   *  every machine. A server that supports it fetches this and uses the URL as
   *  the client id — so there is one Graphe, which an operator can recognise,
   *  instead of a stranger asking to be let in from each laptop. Servers that
   *  do not support it fall back to registering us, which still works.
   *
   *  It only applies to a loopback `/callback`, which is why the door is at
   *  that path and not one of our choosing. */
  readonly clientMetadataUrl = WHO_WE_ARE;

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: 'Graphe',
      client_uri: 'https://graphe.xyz',
      // No port, deliberately, and the same pair the hosted document names. The
      // operating system gives us a different one every launch; RFC 8252 §7.3
      // has the server accept whichever the request carries.
      redirect_uris: ['http://127.0.0.1/callback', 'http://localhost/callback'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    };
  }

  /** Which server the token is meant for, always said (RFC 8707).
   *
   *  The SDK drops it when a server publishes no resource metadata, and a token
   *  with no audience is one another server will accept — the confused deputy
   *  the parameter exists to prevent. Saying it costs nothing where it is
   *  ignored. */
  async validateResourceURL(serverUrl: string | URL): Promise<URL | undefined> {
    const where = new URL(String(serverUrl));
    where.hash = '';
    return where;
  }

  state(): string {
    return this.theState;
  }

  clientInformation(): OAuthClientInformationMixed | undefined {
    const kept = this.keeps.get(keyFor(this.server, 'client'));
    if (kept === null) return undefined;
    try {
      return JSON.parse(kept) as OAuthClientInformationMixed;
    } catch {
      return undefined;
    }
  }

  async saveClientInformation(information: OAuthClientInformationMixed): Promise<void> {
    await this.keeps.keep(keyFor(this.server, 'client'), JSON.stringify(information));
  }

  tokens(): OAuthTokens | undefined {
    const kept = this.keeps.get(keyFor(this.server, 'tokens'));
    if (kept === null) return undefined;
    try {
      return JSON.parse(kept) as OAuthTokens;
    } catch {
      return undefined;
    }
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const kept = await this.keeps.keep(keyFor(this.server, 'tokens'), JSON.stringify(tokens));
    if (!kept.ok) throw new Error(kept.why ?? SAYS.noLock);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    await this.opens(url);
  }

  saveCodeVerifier(verifier: string): void {
    this.#verifier = verifier;
  }

  codeVerifier(): string {
    if (this.#verifier === null) throw new Error('There is no sign-in in progress.');
    return this.#verifier;
  }

  /** Told by the SDK when the server says what it holds is no good. Forgetting
   *  is what turns "it stopped working" into one more trip to the browser. */
  async invalidateCredentials(scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery'): Promise<void> {
    if (scope === 'all' || scope === 'tokens') await this.keeps.forget(keyFor(this.server, 'tokens'));
    if (scope === 'all' || scope === 'client') await this.keeps.forget(keyFor(this.server, 'client'));
    if (scope === 'all' || scope === 'verifier') this.#verifier = null;
  }

  /** Waits for the browser. Only ever called after the SDK has sent somebody
   *  there, so a door that was never opened is a mistake worth saying out loud. */
  async waitForCode(): Promise<string> {
    return this.door.code();
  }

  /** Nothing is held open by an attempt that came to nothing. */
  done(): void {
    this.door.close();
  }

  /** Everything this machine holds for one server, gone. */
  static async forget(server: string, keeps: Keeps): Promise<void> {
    await keeps.forget(keyFor(server, 'tokens'));
    await keeps.forget(keyFor(server, 'client'));
  }

  /** Whether signing in is even possible here. Asked before offering to. */
  static canSignIn(keeps: Keeps): boolean {
    return keeps.canKeep();
  }
}
