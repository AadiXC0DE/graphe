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
 *  pieces, or call a tool. */
export type Step =
  | { says: readonly string[] }
  | { calls: { name: string; arguments: Record<string, unknown> } };

export type ScriptedModel = {
  /** Where the provider the app registers points. */
  url: string;
  /** What the model answers with, one step per turn it is asked for. */
  replies(steps: readonly Step[]): void;
  /** Everything the app sent, oldest first, for a test that needs to know what
   *  the model was actually told. */
  asked: readonly unknown[];
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
        for (const piece of step.says) {
          send({ type: 'text_delta', contentIndex: 0, delta: piece });
          const between = Promise.withResolvers<void>();
          setTimeout(between.resolve, BETWEEN_PIECES);
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
    asked,
    stop: () => {
      const closed = Promise.withResolvers<void>();
      server.close(() => closed.resolve());
      return closed.promise;
    },
  };
}
