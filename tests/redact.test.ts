/** What survives a turn, and what does not.
 *
 * The transcript outlives the conversation by months. These check that a key
 * read out of a file or echoed by a command does not go into it, and — just as
 * important — that ordinary output comes through unchanged, because a redactor
 * that eats the result is a redactor somebody turns off.
 */

import { describe, expect, it } from 'vitest';

import { mask, maskToolResult } from '../src/agent/pi/redact';

describe('a tool result on its way to the disk', () => {
  it('takes out a key the Guard would recognise, and says what it was', () => {
    const { text, found } = maskToolResult('OPENAI_API_KEY=sk-abcdefghijklmnop0123456789\n');
    expect(text).not.toContain('sk-abcdefghijklmnop0123456789');
    expect(text).toContain('OPENAI_API_KEY=');
    expect(text).toContain('hidden]');
    expect(found).toBe(1);
  });

  it('reads a whole .env the model printed', () => {
    const { text, found } = maskToolResult(
      ['DATABASE_URL=postgres://localhost/app', 'STRIPE_SECRET=sk_live_0123456789abcdef', 'AWS_ACCESS_KEY=AKIAIOSFODNN7EXAMPLE'].join('\n'),
    );
    expect(text).toContain('postgres://localhost/app');
    expect(text).not.toContain('sk_live_0123456789abcdef');
    expect(text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    expect(found).toBeGreaterThanOrEqual(2);
  });

  it('takes a private key out whole rather than line by line', () => {
    const key = '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\nabcdef\n-----END RSA PRIVATE KEY-----';
    const { text, found } = maskToolResult(`here it is:\n${key}\nand that is all`);
    expect(text).toContain('here it is:');
    expect(text).toContain('and that is all');
    expect(text).not.toContain('MIIEowIBAAKCAQEA');
    expect(text).toContain('[private key hidden]');
    expect(found).toBe(1);
  });

  it('catches a sign-in ticket and a code hosting key loose in the output', () => {
    const said = maskToolResult(
      'curl -H "x: ghp_0123456789abcdefghijklmnopqrstuvwxyz" and eyJhbGciOiJIUzI1.eyJzdWIiOiIxMjM0.dBjftJ',
    );
    expect(said.text).not.toContain('ghp_0123456789');
    expect(said.text).not.toContain('eyJhbGciOiJIUzI1');
    expect(said.found).toBeGreaterThanOrEqual(2);
  });

  it('leaves ordinary output exactly as it was', () => {
    for (const ordinary of [
      '42 tests passed in 3.2s',
      'export function formatBytes(n: number): string {',
      'tokensUsed=182400 cost=0.42',
      'fatal: not a git repository',
      '',
    ]) {
      const { text, found } = maskToolResult(ordinary);
      expect(text).toBe(ordinary);
      expect(found).toBe(0);
    }
  });

  it('does not go round again on what it already hid', () => {
    const once = maskToolResult('token: sk-abcdefghijklmnop0123456789');
    const twice = maskToolResult(once.text);
    expect(twice.text).toBe(once.text);
    expect(twice.found).toBe(0);
  });

  it('is the same masker the log writes through', () => {
    expect(mask('AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG')).not.toContain('wJalrXUtnFEMI');
  });
});
