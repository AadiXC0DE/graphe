/** A door of its own for every copy of the project.
 *
 * The failure this guards against is four pieces of background work all running
 * `npm run dev`, all asking for 5173, and three of them looking as though they
 * failed for no reason. What is checked here is that the answer is stable —
 * the same copy comes back to the same address — and that it never quietly
 * hands two copies the same one.
 */

import { describe, expect, it } from 'vitest';

import { FIRST_PORT, LAST_PORT, PORT_WORDS, Ports, portEnv, portFor } from '../src/work/ports';

describe('the port one copy gets', () => {
  it('is the same every time it is asked for', () => {
    const folder = '/Users/you/Library/copies/paper-street/work-1';
    expect(portFor(folder)).toBe(portFor(folder));
    // And still the same in a fresh register, which is what makes a preview
    // somebody left open still work after a restart.
    expect(new Ports().claim(folder)).toBe(portFor(folder));
  });

  it('is different for different copies', () => {
    const ports = new Set(
      ['work-1', 'work-2', 'work-3', 'work-4'].map((one) => portFor(`/copies/site/${one}`)),
    );
    expect(ports.size).toBe(4);
  });

  it('stays inside the range it was given', () => {
    for (let at = 0; at < 500; at += 1) {
      const port = portFor(`/copies/site/work-${String(at)}`);
      expect(port).not.toBeNull();
      expect(port ?? 0).toBeGreaterThanOrEqual(FIRST_PORT);
      expect(port ?? 0).toBeLessThanOrEqual(LAST_PORT);
    }
  });

  it('moves along rather than landing on one already taken', () => {
    const folder = '/copies/site/work-1';
    const wanted = portFor(folder);
    expect(wanted).not.toBeNull();
    const next = portFor(folder, new Set([wanted ?? 0]));
    expect(next).not.toBe(wanted);
    expect(next).not.toBeNull();
  });

  /* A hundred copies at once is not a thing to paper over: saying so is the
     honest answer, and the caller falls back to the ordinary port. */
  it('says there is no room rather than doubling up', () => {
    const every = new Set<number>();
    for (let port = FIRST_PORT; port <= LAST_PORT; port += 1) every.add(port);
    expect(portFor('/copies/site/work-1', every)).toBeNull();
  });
});

describe('the register', () => {
  it('never hands two folders the same port', () => {
    const ports = new Ports();
    const given = new Set<number>();
    for (let at = 0; at < 150; at += 1) {
      const port = ports.claim(`/copies/site/work-${String(at)}`);
      expect(port).not.toBeNull();
      expect(given.has(port ?? 0)).toBe(false);
      given.add(port ?? 0);
    }
  });

  it('keeps a folder on its port until it is let go', () => {
    const ports = new Ports();
    const folder = '/copies/site/work-1';
    const first = ports.claim(folder);
    expect(ports.claim(folder)).toBe(first);
    expect(ports.at(folder)).toBe(first);

    ports.release(folder);
    expect(ports.at(folder)).toBeNull();
    // And the same folder asked again gets the same number back, because the
    // number comes from the folder rather than from a counter.
    expect(ports.claim(folder)).toBe(first);
  });

  it('lets a released port go to somebody else', () => {
    const ports = new Ports();
    const mine = ports.claim('/copies/site/work-1');
    expect(ports.held).toHaveLength(1);
    ports.release('/copies/site/work-1');
    expect(ports.held).toHaveLength(0);
    expect(mine).not.toBeNull();
  });
});

describe('what the process is told', () => {
  it('uses the names the tools in this audience actually read', () => {
    const said = portEnv(5201);
    expect(said.PORT).toBe('5201');
    expect(said.VITE_PORT).toBe('5201');
    expect(said.GRAPHE_PORT).toBe('5201');
  });

  it('says where it is in words, without naming the machinery twice', () => {
    expect(PORT_WORDS.servingAt(5201)).toContain('5201');
    expect(PORT_WORDS.noRoom).toMatch(/[.!]$/);
  });

  it('names what a second copy on its own port will break, in the words those settings use', () => {
    const said = PORT_WORDS.secondCopy;
    expect(said).toMatch(/port of its own/);
    expect(said).toMatch(/trusted origins/);
    expect(said).toMatch(/CORS/);
    // One sentence. A paragraph above a link does not get read.
    expect(said.split('. ').length).toBe(1);
  });
});
