/** Signing in to a tool that lives on somebody else's computer.
 *
 *  Nothing here reaches the network. What is worth holding is the shape of the
 *  thing: that the door only opens for the sign-in it started, that what comes
 *  back is locked before it is kept, and that a `redirectUrl` is a real address
 *  from the first moment anybody asks — which is not a detail. Returning
 *  nothing there is how the SDK is told this client cannot show anybody a page,
 *  and it then goes looking for a grant meant for machines and fails on a
 *  contract nobody broke. It cost an afternoon once. */

import { describe, expect, it } from 'vitest';

import { BrowserSignIn, TheDoor, type Keeps } from '../src/agent/pi/mcpauth';

/** A keychain that works, and remembers what it was given. */
function remembers(): Keeps & { held: Map<string, string> } {
  const held = new Map<string, string>();
  return {
    held,
    canKeep: () => true,
    get: (name) => held.get(name) ?? null,
    keep: async (name, value) => {
      held.set(name, value);
      return { ok: true };
    },
    forget: async (name) => {
      held.delete(name);
    },
  };
}

/** One that refuses, the way the real one does when the lock is unavailable. */
const refuses: Keeps = {
  canKeep: () => false,
  get: () => null,
  keep: async () => ({ ok: false, why: 'no lock' }),
  forget: async () => undefined,
};

const SERVER = 'https://example.test/mcp';

async function signIn(keeps: Keeps = remembers()): Promise<BrowserSignIn> {
  return BrowserSignIn.start(SERVER, keeps, () => undefined);
}

describe('the door the browser comes back to', () => {
  it('is a real address before anything is asked of it', async () => {
    const one = await signIn();
    expect(one.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    one.done();
  });

  it('is a different door every time, so two sign-ins never share one', async () => {
    const [a, b] = [await signIn(), await signIn()];
    expect(a.redirectUrl).not.toBe(b.redirectUrl);
    a.done();
    b.done();
  });

  it('registers without a port, because the next launch will have another', async () => {
    const one = await signIn();
    // Port-less, and the same pair the hosted document names: the operating
    // system picks a different port every launch.
    expect(one.clientMetadata.redirect_uris).toEqual([
      'http://127.0.0.1/callback',
      'http://localhost/callback',
    ]);
    expect(one.redirectUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/callback$/);
    one.done();
  });

  it('turns away a visit that does not carry the sign-in it started', async () => {
    const door = await TheDoor.open('the-real-one');
    // Watched before it is knocked on: the refusal lands while the fetch is in
    // flight, and a rejection nobody is holding yet is an unhandled one.
    const watching = expect(door.code()).rejects.toThrow(/was not the one I started/i);
    await fetch(`${door.redirectUrl}?code=abc&state=someone-elses`);
    await watching;
  });

  it('takes the code when the sign-in is the one it started', async () => {
    const door = await TheDoor.open('mine');
    const waiting = door.code();
    const page = await fetch(`${door.redirectUrl}?code=the-code&state=mine`);
    expect(await waiting).toBe('the-code');
    expect(await page.text()).toContain('Signed in');
  });

  it('says what went wrong rather than waiting on a sign-in that was refused', async () => {
    const door = await TheDoor.open('mine');
    const watching = expect(door.code()).rejects.toThrow(/access_denied/);
    await fetch(`${door.redirectUrl}?error=access_denied&error_description=Nope&state=mine`);
    await watching;
  });
});

describe('what comes back', () => {
  it('is kept under the address it belongs to, and nowhere else', async () => {
    const keeps = remembers();
    const one = await BrowserSignIn.start(SERVER, keeps, () => undefined);
    await one.saveTokens({ access_token: 'a', token_type: 'bearer' });
    expect([...keeps.held.keys()]).toEqual([`mcp:tokens:${SERVER}`]);
    one.done();
  });

  it('is read back for that address and no other', async () => {
    const keeps = remembers();
    const mine = await BrowserSignIn.start(SERVER, keeps, () => undefined);
    await mine.saveTokens({ access_token: 'a', token_type: 'bearer' });
    const somewhereElse = await BrowserSignIn.start('https://other.test/mcp', keeps, () => undefined);
    expect(mine.tokens()?.access_token).toBe('a');
    expect(somewhereElse.tokens()).toBeUndefined();
    mine.done();
    somewhereElse.done();
  });

  it('refuses rather than keep a sign-in the machine cannot lock', async () => {
    const one = await BrowserSignIn.start(SERVER, refuses, () => undefined);
    await expect(one.saveTokens({ access_token: 'a', token_type: 'bearer' })).rejects.toThrow();
    one.done();
  });

  it('is let go of when the server says it is no good', async () => {
    const keeps = remembers();
    const one = await BrowserSignIn.start(SERVER, keeps, () => undefined);
    await one.saveTokens({ access_token: 'a', token_type: 'bearer' });
    await one.saveClientInformation({ client_id: 'c' });
    await one.invalidateCredentials('all');
    expect(keeps.held.size).toBe(0);
    one.done();
  });

  it('is let go of when the tool is taken off the list', async () => {
    const keeps = remembers();
    const one = await BrowserSignIn.start(SERVER, keeps, () => undefined);
    await one.saveTokens({ access_token: 'a', token_type: 'bearer' });
    one.done();
    await BrowserSignIn.forget(SERVER, keeps);
    expect(keeps.held.size).toBe(0);
  });

  it('survives a file that has been scribbled in, rather than throwing', async () => {
    const keeps = remembers();
    keeps.held.set(`mcp:tokens:${SERVER}`, 'not json');
    const one = await BrowserSignIn.start(SERVER, keeps, () => undefined);
    expect(one.tokens()).toBeUndefined();
    expect(one.clientInformation()).toBeUndefined();
    one.done();
  });
});

describe('the page somebody is sent to', () => {
  it('is opened by whatever the shell handed us, and only when asked', async () => {
    const opened: URL[] = [];
    const one = await BrowserSignIn.start(SERVER, remembers(), (url) => {
      opened.push(url);
    });
    expect(opened).toEqual([]);
    await one.redirectToAuthorization(new URL('https://example.test/authorize?x=1'));
    expect(opened.map((u) => u.href)).toEqual(['https://example.test/authorize?x=1']);
    one.done();
  });

  it('carries a sign-in the door will recognise', async () => {
    const one = await signIn();
    expect(one.state()).toMatch(/[0-9a-f-]{36}/);
    one.done();
  });
});
