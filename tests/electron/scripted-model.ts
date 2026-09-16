/** A model that answers from a script, for the real-window suite.
 *
 * The smoke suite runs the shipped shell in a real window on a disposable
 * profile, and until now no turn could happen in it: nothing was connected, so
 * every send stopped at "Connect a model" and no scenario that needs a turn —
 * a file written, a reply streaming — could be proven there.
 *
 * This is the smallest thing that makes a turn real. It is a local server that
 * speaks Pi's own message protocol (`pi-messages`, the one Pi's own docs
 * describe as usable by any backend), so the app reaches it through the
 * ordinary provider path — the session, the Guard, the tools, the event
 * translation — with only the model replaced. Nothing else in this repo
 * imports it, and the app registers the provider that points here only when
 * `GRAPHE_TEST_MODEL` is set on a run that is not a packaged app.
 */

import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/** One thing the model does when it is asked for a turn: say something, in
 *  pieces, or call a tool. A reply marked `byHand` waits for `next()` between
 *  its pieces instead of the clock, so a test can hold it mid-arrival for as
 *  long as it needs on any machine. */
export type Step =
  | { says: readonly string[]; byHand?: boolean }
  | { calls: { name: string; arguments: Record<string, unknown> } };

export type ScriptedModel = {
  /** Where the provider the app registers points. */
  url: string;
  /** What the model answers with, one step per turn it is asked for. */
  replies(steps: readonly Step[]): void;
  /** Release the next piece of a `byHand` reply. Doing nothing when no reply
   *  is held back is deliberate: a test that releases one piece too many
   *  should fail on what it sees, not on a thrown error. */
  next(): void;
  /** Everything the app sent, oldest first, for a test that needs to know what
   *  the model was actually told. */
  asked: readonly unknown[];
  /** True once the app closed a reply before the script had finished writing
   *  it — which is what stopping a run does to the far end of the wire. */
  cutOff(): boolean;
  stop(): Promise<void>;
};

/** What a reply costs, in the shape Pi's own converter expects. Free: this is
 *  not an account, and a spend figure here would be a number nobody paid. */
const USAGE = {
  input: 1,
  output: 1,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 2,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** How long each piece is held back. Long enough that a test watching the
 *  window sees a reply arrive rather than appear — the whole point of the
 *  streaming case — and short enough that three pieces still fit inside a
 *  step's own budget. */
const BETWEEN_PIECES = 500;

/** Said when a turn arrives that no test wrote an answer for. A turn beyond the
 *  script is a test that miscounted, and it should read like that rather than
 *  hang. */
const NOTHING_SCRIPTED = 'Nothing was scripted for this turn.';

/**
 * A server that answers Pi's message protocol from a list of steps.
 *
 * Refused outside the smoke run: this is a test seam, and a provider that
 * answers with whatever a test wrote is not something any other kind of run
 * should be able to start by importing a file.
 */
export async function scriptedModel(): Promise<ScriptedModel> {
  if (process.env['GRAPHE_ELECTRON_SMOKE'] !== '1') {
    throw new Error('The scripted model only runs inside the real-window suite.');
  }

  const steps: Step[] = [];
  const asked: unknown[] = [];
  let turns = 0;
  let cut = false;
  /** Set by `stop()`, so a `byHand` reply still waiting at a gate lets the
   *  turn finish instead of arming the next one. */
  let stopped = false;
  /** The gate a `byHand` reply is currently held at, or null when the clock is
   *  pacing it. */
  let release: (() => void) | null = null;

  const server = createServer((request, response) => {
    void (async () => {
      const where = new URL(request.url ?? '/', 'http://127.0.0.1');
      if (request.method !== 'POST' || where.pathname !== '/messages') {
        response.writeHead(404).end('not here');
        return;
      }

      let body = '';
      for await (const chunk of request) body += String(chunk);
      try {
        asked.push(JSON.parse(body));
      } catch {
        asked.push(body);
      }

      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      // The app went away before this reply was finished: a run that was
      // stopped ends at this end of the wire too.
      response.on('close', () => {
        if (!response.writableEnded) cut = true;
      });
      const send = (event: unknown): void => {
        response.write(`data: ${JSON.stringify(event)}\n\n`);
      };

      const step = steps.shift() ?? { says: [NOTHING_SCRIPTED] };
      send({ type: 'start' });
      if ('calls' in step) {
        // One delta holding the whole JSON: the wire allows the arguments to
        // arrive in pieces, and nothing here depends on them doing so.
        const id = `scripted-call-${String((turns += 1))}`;
        const arguments_ = step.calls.arguments;
        send({ type: 'toolcall_start', contentIndex: 0, id, toolName: step.calls.name });
        send({ type: 'toolcall_delta', contentIndex: 0, delta: JSON.stringify(arguments_) });
        send({
          type: 'toolcall_end',
          contentIndex: 0,
          toolCall: { type: 'toolCall', id, name: step.calls.name, arguments: arguments_ },
        });
        send({ type: 'done', reason: 'toolUse', usage: USAGE });
      } else {
        send({ type: 'text_start', contentIndex: 0 });
        for (const [at, piece] of step.says.entries()) {
          send({ type: 'text_delta', contentIndex: 0, delta: piece });
          const between = Promise.withResolvers<void>();
          if (step.byHand === true) {
            // Held back between pieces, never after the last: a gate nobody
            // releases would hang the turn it exists to pace. Armed after the
            // piece is sent, so the first `next()` releases the one after it
            // rather than the piece already on screen.
            if (at === step.says.length - 1 || stopped) break;
            release = between.resolve;
          } else {
            setTimeout(between.resolve, BETWEEN_PIECES);
          }
          await between.promise;
        }
        send({ type: 'text_end', contentIndex: 0, content: step.says.join('') });
        send({ type: 'done', reason: 'stop', usage: USAGE });
      }
      response.end();
    })().catch(() => {
      // A test that stopped watching has already failed on its own assertion.
      response.destroy();
    });
  });

  const listening = Promise.withResolvers<void>();
  server.listen(0, '127.0.0.1', () => listening.resolve());
  await listening.promise;
  const address = server.address() as AddressInfo | null;
  if (address === null) throw new Error('the scripted model has no port');

  return {
    url: `http://127.0.0.1:${String(address.port)}`,
    replies: (next) => {
      steps.splice(0, steps.length, ...next);
    },
    next: () => {
      release?.();
      release = null;
    },
    asked,
    cutOff: () => cut,
    stop: () => {
      // A reply still held at a gate keeps its connection open, so releasing
      // it and refusing the next are what let the server close at all.
      stopped = true;
      release?.();
      release = null;
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
