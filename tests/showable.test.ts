/** What belongs in the frame beside the conversation.
 *
 * Holding a port says nothing about whether there is anything to look at. An
 * API answers in JSON, a queue worker answers nothing, a type-checker in watch
 * mode never listens at all — and opening any of them shows somebody a wall of
 * braces or a blank frame where their work should be.
 *
 * So the question is never what was started. It is what the address answers
 * with, which is the only thing that stays true for a server nobody has thought
 * of yet.
 */

import { describe, expect, it } from 'vitest';

import { worthShowing } from '../src/lib/showable';

const answered = (status: number | null, type: string | null) => ({ status, type });

describe('what goes in the frame', () => {
  it('shows a page', () => {
    expect(worthShowing(answered(200, 'text/html; charset=utf-8'))).toBe(true);
    expect(worthShowing(answered(200, 'application/xhtml+xml'))).toBe(true);
  });

  /** The whole point. A backend is the commonest thing to have running beside
   *  a front end, and it is exactly what must not take over the frame. */
  it('does not show an API answering in JSON', () => {
    expect(worthShowing(answered(200, 'application/json'))).toBe(false);
    expect(worthShowing(answered(200, 'application/grpc'))).toBe(false);
    expect(worthShowing(answered(200, 'application/octet-stream'))).toBe(false);
  });

  it('shows the other things a browser draws', () => {
    for (const type of ['application/pdf', 'image/png', 'image/svg+xml', 'text/plain']) {
      expect(worthShowing(answered(200, type)), type).toBe(true);
    }
  });

  /** Silence is not a page: a worker, a watcher, or a server still starting. */
  it('shows nothing that did not answer at all', () => {
    expect(worthShowing(answered(null, null))).toBe(false);
    expect(worthShowing(answered(null, 'text/html'))).toBe(false);
  });

  /** A 404 from your own site is a thing to fix, not a thing to hide. */
  it('still shows a page that answered with a refusal', () => {
    expect(worthShowing(answered(404, 'text/html'))).toBe(true);
    expect(worthShowing(answered(401, 'text/html'))).toBe(true);
  });

  it('does not show a server that is failing outright', () => {
    expect(worthShowing(answered(500, 'text/html'))).toBe(false);
    expect(worthShowing(answered(503, null))).toBe(false);
  });

  /** A plain static server often sends no content-type. Being wrong here costs
   *  a frame somebody closes; being wrong the other way hides their work. */
  it('shows something that answered without saying what it sent', () => {
    expect(worthShowing(answered(200, null))).toBe(true);
  });

  it('does not care how the type was capitalised', () => {
    expect(worthShowing(answered(200, 'TEXT/HTML'))).toBe(true);
    expect(worthShowing(answered(200, 'Application/JSON'))).toBe(false);
  });
});
