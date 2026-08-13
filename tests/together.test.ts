/** Three helpers at once, rather than three helpers in a row.
 *
 *  Sending a team is the whole point of the helper tool, and whether a team was
 *  actually sent is a question about a clock, not about a flag. So this file
 *  drives Pi's own agent loop — the real `runAgentLoop`, read out of the
 *  installed SDK the same way "the interception point" in adapter.test.ts reads
 *  it — with a model that answers with a batch of tool calls, and it times the
 *  result. Every call spawns a real child process that does nothing for a known
 *  stretch, so the number at the end is wall-clock rather than an assertion
 *  about scheduling.
 *
 *  What it caught: Pi runs a whole batch one call after another the moment a
 *  *single* tool in that batch declares itself sequential. One web search
 *  alongside three helpers turned the fan-out into a queue, and nothing in the
 *  helper tool could have told you so.
 *
 *  The tools carry their real definitions — name, schema, and the execution mode
 *  under test. Only `execute` is swapped, for a child that sleeps: what a helper
 *  does inside its own process is subagent-runner.ts's business, not the batch
 *  scheduler's. */

import { spawn } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import { Confirmations, createGuardInterceptor } from '../src/agent/pi/adapter';
import { EventRelay } from '../src/agent/pi/events';
import { grapheTools, helperWorkingDirectory, taskTool, webfetchTool, websearchTool } from '../src/agent/pi/tools';
import type { AgentEvent } from '../src/agent/types';

/** Pi's loop, from the copy that is installed. An upgrade that moves it fails
 *  here rather than quietly stopping the measurement. */
const LOOP = new URL(
  '../node_modules/@earendil-works/pi-coding-agent/node_modules/@earendil-works/pi-agent-core/dist/agent-loop.js',
  import.meta.url,
);

type Loop = {
  runAgentLoop: (
    prompts: unknown[],
    context: unknown,
    config: unknown,
    emit: (event: unknown) => Promise<void>,
    signal: AbortSignal | undefined,
    streamFn: () => unknown,
  ) => Promise<unknown>;
};

const { runAgentLoop } = (await import(LOOP.href)) as Loop;

/** Long enough to measure past the noise of starting a process, short enough
 *  that a queue of four is still a quick test. */
const WORK_MS = 600;

type Batched = { id: string; name: string; args: Record<string, unknown> };

/** A real child that does nothing for a known stretch, so overlap is something
 *  the operating system did rather than something a promise pretended to. */
function sleepingChild(ms: number): Promise<void> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ['-e', `setTimeout(() => {}, ${String(ms)})`], {
      stdio: 'ignore',
    });
    child.on('exit', () => done());
  });
}

/** The real tool, with its work replaced by a wait of a known length. */
function timed(definition: { name: string }): unknown {
  return {
    ...definition,
    execute: async () => {
      await sleepingChild(WORK_MS);
      return { content: [{ type: 'text', text: 'done' }], details: {} };
    },
  };
}

function assistant(content: unknown[], stopReason: string): unknown {
  return {
    role: 'assistant',
    content,
    stopReason,
    timestamp: new Date().toISOString(),
    api: 'test',
    provider: 'test',
    model: 'test',
    usage: {},
  };
}

/** Pi reads the model's answer as a stream and then asks it for the finished
 *  message. Nothing streams here, so only the finished message matters. */
function saying(message: unknown): unknown {
  return {
    [Symbol.asyncIterator]: () => ({ next: async () => ({ done: true, value: undefined }) }),
    result: async () => message,
  };
}

/** One turn: the model answers with this batch of calls, the loop runs them,
 *  and the model then says it is finished. Answers how long that took. */
async function timeBatch(
  tools: unknown[],
  calls: readonly Batched[],
  beforeToolCall?: (context: { toolCall: { id: string; name: string }; args: unknown }) => Promise<unknown>,
): Promise<number> {
  let turn = 0;
  const streamFn = (): unknown => {
    turn += 1;
    return saying(
      turn === 1
        ? assistant(
            calls.map((one) => ({
              type: 'toolCall',
              id: one.id,
              name: one.name,
              arguments: one.args,
            })),
            'toolUse',
          )
        : assistant([{ type: 'text', text: 'All three have reported back.' }], 'stop'),
    );
  };

  const started = Date.now();
  await runAgentLoop(
    [{ role: 'user', content: 'Send three helpers.', timestamp: new Date().toISOString() }],
    { systemPrompt: '', messages: [], tools },
    {
      model: { provider: 'test', id: 'test', api: 'test' },
      convertToLlm: (messages: unknown[]) => messages,
      ...(beforeToolCall === undefined ? {} : { beforeToolCall }),
    },
    async () => {},
    undefined,
    streamFn,
  );
  return Date.now() - started;
}

function helpers(howMany: number): Batched[] {
  return Array.from({ length: howMany }, (_unused, index) => ({
    id: `helper-${String(index + 1)}`,
    name: 'task',
    args: { task: `Piece of work ${String(index + 1)}` },
  }));
}

/* ------------------------------------------------------------ the clock */

describe('a team of helpers', () => {
  it('finishes three in the time of one, not three', async () => {
    const took = await timeBatch([timed(taskTool('/tmp/agent'))], helpers(3));

    expect(took).toBeGreaterThanOrEqual(WORK_MS);
    expect(took).toBeLessThan(WORK_MS * 2);
  }, 30_000);

  /* The regression this file exists for. One sequential tool anywhere in the
     batch makes Pi run every call in it one after another, so a search sent
     alongside the team used to cost each helper the one before it. */
  it('is not turned into a queue by a search in the same reply', async () => {
    const took = await timeBatch(
      [timed(taskTool('/tmp/agent')), timed(websearchTool), timed(webfetchTool)],
      [
        ...helpers(3),
        { id: 'search-1', name: 'websearch', args: { query: 'anything at all' } },
        { id: 'page-1', name: 'webfetch', args: { url: 'https://example.com' } },
      ],
    );

    expect(took).toBeGreaterThanOrEqual(WORK_MS);
    expect(took).toBeLessThan(WORK_MS * 2);
  }, 30_000);

  it('still runs them side by side with the Guard in front of every one', async () => {
    const asked: string[] = [];
    const confirmations = new Confirmations();
    const relay = new EventRelay((event: AgentEvent) => {
      if (event.type !== 'needs-confirmation') return;
      asked.push(event.call.id);
      // Said yes on the next tick, because the question is announced a line
      // before the Guard starts waiting for its answer.
      setTimeout(() => confirmations.answer(event.call.id, 'yes'), 0);
    });
    const review = createGuardInterceptor({
      facts: { projectRoot: process.cwd() },
      relay,
      confirmations,
    });

    const took = await timeBatch([timed(taskTool('/tmp/agent'))], helpers(3), async (context) =>
      (await review({
        id: context.toolCall.id,
        name: context.toolCall.name,
        input: { ...(context.args as Record<string, unknown>) },
      })) ?? undefined,
    );

    // The Guard really was in the path: it asked about every one of them.
    expect(asked).toEqual(['helper-1', 'helper-2', 'helper-3']);
    expect(took).toBeLessThan(WORK_MS * 2);
  }, 30_000);
});

/* ------------------------------------------------- what the tools declare */

describe('what Graphe adds to Pi', () => {
  it('always gives a helper the open project, not a path the model supplied', () => {
    expect(helperWorkingDirectory('/Users/mira/Projects/portfolio', '/Users/mira')).toBe(
      '/Users/mira/Projects/portfolio',
    );
  });

  it('leaves nothing in the batch that would hold the rest of it up', () => {
    const modes = grapheTools('/tmp/agent', 'a-figma-token').map((tool) => ({
      name: tool.name,
      executionMode: tool.executionMode,
    }));

    expect(modes.map((one) => one.name)).toContain('task');
    expect(modes.map((one) => one.name)).toContain('figma_read');
    for (const one of modes) expect(one.executionMode).not.toBe('sequential');
  });

  it('tells the model that several helpers belong in one reply', () => {
    const said = [taskTool('/tmp/agent').description, ...(taskTool('/tmp/agent').promptGuidelines ?? [])]
      .join(' ')
      .toLowerCase();

    expect(said).toContain('one reply');
    expect(said).toContain('at the same time');
  });
});
