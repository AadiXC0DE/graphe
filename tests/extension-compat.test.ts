/** What this host does with each add-on operation the plan's phase 6 names.
 *
 * The fixtures in `tests/fixtures/extensions/` are real add-ons: each is
 * imported, handed the API the host actually binds, and then the hooks and
 * tools it registered are driven. A card read by the probe proves what an
 * add-on *will* do; these prove what happens when it does it.
 *
 * Four of the plan's operations are **not supported today**, and the fixtures
 * for them are here so the gap is a name rather than a rumour:
 *
 * - Custom TUI, custom editor/footer/header, terminal input. Plan: "Terminal
 *   compatibility mode ... Never serialize executable component factories to
 *   renderer or simulate success." The host refuses each call out loud and
 *   there is no terminal mode to hand off to (6.5 is not shipped).
 * - Provider registration. A provider Pi learns is not listed by this window's
 *   model picker, which reads its own catalogue.
 * - Slash commands. Plan: "Command registry item with extension origin ...
 *   Respect command context". An add-on's command is counted on its capability
 *   card and never reaches the composer's command picker, and no command
 *   context actions are bound.
 * - Shortcut conflicts. Plan: "Detect conflicts; reserve Stop and core
 *   navigation; show resolution". Pi computes the diagnostic; nothing in this
 *   app reads it.
 *
 * Where a row is a gap rather than a behaviour, the test says so in its own
 * name, so the matrix in `docs/handoffs/extension-compatibility.md` can point
 * at it honestly.
 */

import { spawnSync } from 'node:child_process';
import { cp, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { afterAll, afterEach, describe, expect, it } from 'vitest';

import { cachedProbe, probe } from '../src/agent/pi/extension-probe';
import {
  dialogsOver,
  uiContextOver,
  unsupportedTerminal,
  type AskTheWindow,
  type ExtensionAnswer,
  type ExtensionAsk,
} from '../src/agent/pi/extension-ui';
import { extensionTurnOf, translatePiEvent } from '../src/agent/pi/events';
import { eventsFromEntries } from '../src/agent/pi/history';
import {
  forgetOverruns,
  forgetRunning,
  hookStillRunning,
  withHookBudget,
  type Overrun,
} from '../src/agent/pi/hook-budget';

const at = (which: string): string =>
  fileURLToPath(new URL(`./fixtures/extensions/${which}/index.mjs`, import.meta.url));

const made: string[] = [];

afterEach(() => {
  forgetOverruns();
  forgetRunning();
});

afterAll(async () => {
  for (const one of made.splice(0)) await rm(one, { recursive: true, force: true });
});

async function scratch(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'graphe-compat-'));
  made.push(root);
  return root;
}

/** A fixture in a folder this test owns, whole — an add-on that is several
 *  files has to stay several files. */
async function copyOf(which: string): Promise<string> {
  const into = join(await scratch(), which);
  await cp(fileURLToPath(new URL(`./fixtures/extensions/${which}`, import.meta.url)), into, {
    recursive: true,
  });
  return join(into, 'index.mjs');
}

/* -------------------------------------------------------------------------- */
/* A host, shaped like the one in adapter.ts                                    */
/* -------------------------------------------------------------------------- */

type Handler = (...args: never[]) => unknown;

type ToolResult = { content?: readonly unknown[]; details?: unknown };

type Tool = {
  name: string;
  label?: string;
  description: string;
  parameters?: unknown;
  execute: (...args: unknown[]) => Promise<ToolResult>;
};

type Command = {
  name: string;
  options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> };
};

type Window = {
  ask: AskTheWindow;
  asked: ExtensionAsk[];
  /** Answer the question that is being held. */
  with: (one: ExtensionAnswer) => void;
};

/** Nobody answered. Pi has one shape per question, and this is the one that
 *  means "no answer" rather than "no". */
function neverAnswered(one: ExtensionAsk): ExtensionAnswer {
  if (one.kind === 'confirm') return { kind: 'confirm', value: false };
  if (one.kind === 'input') return { kind: 'input', value: null };
  if (one.kind === 'editor') return { kind: 'editor', value: null };
  return { kind: 'select', value: null };
}

/** The person at the window: answering from a script, or holding the question
 *  until the test says what happened. */
function theWindow(how: { answers?: readonly ExtensionAnswer[]; hold?: boolean } = {}): Window {
  const answers = [...(how.answers ?? [])];
  const asked: ExtensionAsk[] = [];
  const waiting: ((one: ExtensionAnswer) => void)[] = [];
  return {
    asked,
    with: (one) => waiting.shift()?.(one),
    ask: (one) => {
      asked.push(one);
      if (how.hold === true) {
        const { promise, resolve } = Promise.withResolvers<ExtensionAnswer>();
        waiting.push(resolve);
        return promise;
      }
      return Promise.resolve(answers.shift() ?? neverAnswered(one));
    },
  };
}

type Harness = {
  tools: Tool[];
  commands: Command[];
  shortcuts: { keys: string; options: { description?: string } }[];
  providers: { name: string; config: unknown }[];
  messages: { message: Record<string, unknown>; options?: Record<string, unknown> }[];
  /** What the add-on caused the app to say. */
  said: string[];
  /** Terminal-only calls, as the host reported them. */
  refused: string[];
  /** Settles when the add-on sends something of its own, however late. */
  delivered: Promise<void>;
  ctx: Record<string, unknown>;
  handler: (event: string, at?: number) => Handler;
  hand: (event: string, ...args: unknown[]) => Promise<unknown>;
  runner: () => { extensions: { path: string; handlers: Map<string, Handler[]> }[] };
};

/** Import a fixture's factory and hand it the API this host binds.
 *
 * A dynamic import because the fixture is chosen at runtime, which is the one
 * thing Pi's extension loading is about. */
async function hosted(which: string, window: Window = theWindow()): Promise<Harness> {
  // A static import cannot name this: the module is whoever is installed, which
  // is the whole point of Pi's extension loading.
  const loaded = (await import(/* @vite-ignore */ pathToFileURL(at(which)).href)) as {
    default: (api: unknown) => void;
  };

  const tools: Tool[] = [];
  const commands: Command[] = [];
  const shortcuts: { keys: string; options: { description?: string } }[] = [];
  const providers: { name: string; config: unknown }[] = [];
  const messages: { message: Record<string, unknown>; options?: Record<string, unknown> }[] = [];
  const handlers = new Map<string, Handler[]>();
  const said: string[] = [];
  const refused: string[] = [];
  const delivered = Promise.withResolvers<void>();

  const api = {
    on: (event: string, handler: Handler) => {
      handlers.set(event, [...(handlers.get(event) ?? []), handler]);
    },
    registerTool: (tool: Tool) => tools.push(tool),
    registerCommand: (name: string, options: Command['options']) => commands.push({ name, options }),
    registerShortcut: (keys: string, options: { description?: string }) =>
      shortcuts.push({ keys, options }),
    registerProvider: (name: string, config: unknown) => providers.push({ name, config }),
    sendMessage: (message: Record<string, unknown>, options?: Record<string, unknown>) => {
      messages.push({ message, ...(options === undefined ? {} : { options }) });
      delivered.resolve();
    },
    sendUserMessage: (content: unknown, options?: Record<string, unknown>) => {
      messages.push({
        message: { customType: 'user-message', content, display: true },
        ...(options === undefined ? {} : { options }),
      });
      delivered.resolve();
    },
    appendEntry: () => undefined,
  };

  const ctx = {
    ui: uiContextOver({
      dialogs: dialogsOver(window.ask),
      terminal: unsupportedTerminal((what, method) => refused.push(`${what}:${method}`)),
      notify: (what: string) => said.push(what),
    }),
    mode: 'rpc',
    hasUI: true,
    cwd: process.cwd(),
    isIdle: () => true,
    waitForIdle: async () => undefined,
  };

  loaded.default(api);

  const handler = (event: string, where = 0): Handler => {
    const one = (handlers.get(event) ?? [])[where];
    if (one === undefined) throw new Error(`nothing registered for ${event}`);
    return one;
  };

  return {
    tools,
    commands,
    shortcuts,
    providers,
    messages,
    said,
    refused,
    delivered: delivered.promise,
    ctx,
    handler,
    hand: async (event, ...args) => {
      let last: unknown;
      for (const one of handlers.get(event) ?? []) {
        last = await (one as (...a: unknown[]) => unknown)(...args, ctx);
      }
      return last;
    },
    runner: () => ({ extensions: [{ path: at(which), handlers }] }),
  };
}

/** One tool result as Pi's stream reports it, which is what the window and the
 *  transcript both have to read. */
const ended = (toolName: string, result: unknown, id = 'call-1'): unknown => ({
  type: 'tool_execution_end',
  toolCallId: id,
  toolName,
  result,
});

/* -------------------------------------------------------------------------- */

describe('a tool whose name nothing here recognises', () => {
  it('is called what its add-on called it, and becomes an ordinary step', async () => {
    const addon = await hosted('unknown-tools');
    expect(addon.tools.map((one) => one.name)).toEqual(['wobble_the_page', 'mcp__ledger__post']);

    const result = await addon.tools[0]?.execute('call-1', { amount: 3 });
    expect(translatePiEvent(ended('wobble_the_page', result))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
    });
  });

  it('is described by the probe on the evidence, not by the name on the folder', async () => {
    const card = await probe(at('unknown-tools'));
    expect(card?.tools).toEqual(['wobble_the_page', 'mcp__ledger__post']);
    expect(card?.orchestrating).toBe(false);
  });
});

describe('two third-party helpers with different schemas (T36)', () => {
  it('are read as ordinary tools, each with its own parameters intact', async () => {
    const brief = await hosted('agent-brief');
    const tally = await hosted('agent-tally');

    expect(brief.tools[0]?.parameters).toMatchObject({
      properties: { goal: { type: 'string' }, files: { type: 'array' } },
    });
    expect(tally.tools[0]?.parameters).toMatchObject({
      properties: {
        target: { type: 'string' },
        depth: { type: 'integer' },
        dry: { type: 'boolean' },
      },
    });
  });

  it('produce the same shape of step as any other tool, with nothing bespoke for either', async () => {
    const brief = await hosted('agent-brief');
    const tally = await hosted('agent-tally');

    const one = await brief.tools[0]?.execute('call-1', { goal: 'sell it', files: ['a.ts', 'b.ts'] });
    const two = await tally.tools[0]?.execute('call-2', { target: 'src', depth: 2 });

    expect(translatePiEvent(ended('brief_the_writer', one))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
      detail: '2 files read',
    });
    expect(translatePiEvent(ended('tally_the_woodwork', two, 'call-2'))).toEqual({
      type: 'tool-end',
      id: 'call-2',
      ok: true,
      detail: '12 under src',
    });
  });

  it('replay from the record as a tool record too, whatever the add-on was called', () => {
    const [step] = eventsFromEntries([
      {
        type: 'message',
        message: {
          role: 'toolResult',
          toolCallId: 'call-1',
          isError: false,
          content: [{ type: 'text', text: '{"target":"src","depth":2,"count":12}' }],
          details: { note: '12 under src' },
        },
      },
    ]);
    expect(step).toMatchObject({ type: 'tool-end', id: 'call-1', ok: true, detail: '12 under src' });
    // What a line has no room for is named and kept rather than dropped.
    expect(step?.type === 'tool-end' ? step.kept : []).toEqual([
      { what: 'what it printed (37 characters)', where: 'call:call-1' },
    ]);
  });
});

describe('a step that says what it is doing while it does it', () => {
  it('arrives as progress in pieces, and then as one finished step', async () => {
    const addon = await hosted('streamed');
    const updates: unknown[] = [];
    const result = await addon.tools[0]?.execute('call-1', { count: 3 }, undefined, (partial: unknown) =>
      updates.push(
        translatePiEvent({
          type: 'tool_execution_update',
          toolCallId: 'call-1',
          toolName: 'crawl_the_pages',
          partialResult: partial,
        }),
      ),
    );

    expect(updates).toEqual([
      { type: 'tool-progress', id: 'call-1', text: 'page 1' },
      { type: 'tool-progress', id: 'call-1', text: 'page 1\npage 2' },
      { type: 'tool-progress', id: 'call-1', text: 'page 1\npage 2\npage 3' },
    ]);
    expect(translatePiEvent(ended('crawl_the_pages', result))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
      detail: '3 pages',
    });
  });
});

describe('a picture and a file handed back', () => {
  it('draws the picture on the step, live', async () => {
    const addon = await hosted('media');
    const shot = await addon.tools[0]?.execute('call-1', {});
    expect(translatePiEvent(ended('shoot_the_page', shot))).toMatchObject({
      type: 'tool-end',
      ok: true,
      shown: { mimeType: 'image/png' },
    });
  });

  it('shows no picture for a result that is only a file, live', async () => {
    const addon = await hosted('media');
    const file = await addon.tools[1]?.execute('call-1', {});
    // The live reader takes text and pictures; a file has nowhere to go here,
    // and the record below is where it is named instead of silently lost.
    expect(translatePiEvent(ended('hand_back_the_log', file))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
    });
  });

  it('names the file when the conversation is read back, so nothing is silently gone', () => {
    expect(
      eventsFromEntries([
        {
          type: 'message',
          message: {
            role: 'toolResult',
            toolCallId: 'call-1',
            isError: false,
            content: [
              { type: 'resource', resource: { uri: 'file:///tmp/build.log', name: 'build.log' } },
            ],
          },
        },
      ])[0],
    ).toMatchObject({
      type: 'tool-end',
      id: 'call-1',
      kept: [{ what: 'a file it handed back: build.log', where: 'file:///tmp/build.log' }],
    });
  });
});

describe('a message an add-on sent', () => {
  it('travels with the add-on’s name and the payload it carried', async () => {
    const addon = await hosted('messages');
    const visible = addon.messages[0];
    const hidden = addon.messages[1];
    expect(visible?.message).toMatchObject({ customType: 'field-notes', display: true });
    expect(hidden?.message).toMatchObject({ customType: 'private-notes', display: false });

    const [read] = eventsFromEntries([
      { type: 'custom_message', ...(visible?.message ?? {}) },
    ]);
    expect(read).toMatchObject({ type: 'extension-said', from: 'field-notes' });
    expect(read?.type === 'extension-said' ? read.text : '').toBe(
      'The first four buttons are re-drawn.',
    );
  });

  it('keeps a message it asked to hide out of the conversation', () => {
    expect(
      eventsFromEntries([
        {
          type: 'custom_message',
          customType: 'private-notes',
          display: false,
          content: [{ type: 'text', text: 'not for the screen' }],
        },
      ]),
    ).toEqual([]);
  });

  it('asks for a turn of its own, which is what its card says it will do', async () => {
    const addon = await hosted('messages');
    expect(addon.messages[2]?.message).toMatchObject({ customType: 'user-message' });
    const card = await probe(at('messages'));
    expect(card?.startsTurns).toBe(true);
  });

  it('is announced as the add-on’s turn when it starts one', () => {
    expect(
      extensionTurnOf({
        type: 'message_start',
        message: {
          role: 'user',
          customType: 'field-notes',
          content: [{ type: 'text', text: 'The first four buttons are re-drawn.' }],
        },
      }),
    ).toEqual({
      type: 'extension-turn',
      from: 'field-notes',
      text: 'The first four buttons are re-drawn.',
    });
  });
});

describe('notifications and status', () => {
  it('says all three severities, with the severity in the words', async () => {
    const addon = await hosted('notices');
    await addon.hand('session_start', { type: 'session_start' });

    expect(addon.said).toEqual([
      'The button row is re-drawn.',
      'warning: Two pages are missing a heading.',
      'error: The build file would not parse.',
    ]);
  });

  it('does not pretend to have a footer to put a status line in', async () => {
    const addon = await hosted('notices');
    await addon.hand('session_start', { type: 'session_start' });

    // Setting the line and clearing it are the same single refusal: there is no
    // status surface here for either to act on. Two add-ons sharing a key is
    // therefore not a namespacing problem yet — nothing is kept to clash.
    expect(addon.refused).toEqual(['terminal:setStatus']);
  });

  it('accepts the working message and draws it nowhere, without claiming otherwise', async () => {
    const addon = await hosted('notices');
    await addon.hand('session_start', { type: 'session_start' });
    expect(addon.said.some((one) => one.includes('tidying the pages'))).toBe(false);
    expect(addon.refused).not.toContain('terminal:setWorkingMessage');
  });
});

describe('the four questions', () => {
  const answers: ExtensionAnswer[] = [
    { kind: 'select', value: 'nav.css' },
    { kind: 'confirm', value: true },
    { kind: 'input', value: 'the new heading' },
    { kind: 'editor', value: 'A better paragraph.' },
  ];

  it('reach the person as the add-on wrote them, and the answers reach the add-on', async () => {
    const window = theWindow({ answers });
    const addon = await hosted('asks', window);
    await addon.commands[0]?.options.handler('', addon.ctx);

    expect(window.asked).toEqual([
      {
        kind: 'select',
        title: 'Which file should I change?',
        options: [
          { label: 'hero.css', value: 'hero.css' },
          { label: 'nav.css', value: 'nav.css' },
        ],
        timeoutMs: null,
      },
      {
        kind: 'confirm',
        title: 'Overwrite it?',
        message: 'There is already a file there.',
        timeoutMs: null,
      },
      { kind: 'input', title: 'What should it say?', placeholder: 'a heading', timeoutMs: null },
      { kind: 'editor', title: 'Rewrite the paragraph', prefill: 'The old one.' },
    ]);
    expect(addon.said).toEqual([
      'chosen nav.css',
      'overwriting it',
      'typed the new heading',
      'edited to A better paragraph.',
    ]);
  });

  it('come back as an answer nobody gave, never as a made-up yes', async () => {
    const addon = await hosted('asks', theWindow({ answers: [] }));
    await addon.commands[0]?.options.handler('', addon.ctx);

    expect(addon.said).toEqual([
      'the file question went unanswered',
      'left alone',
      'nothing was typed',
      'the editor was closed',
    ]);
  });
});

describe('a question an add-on wants to take back', () => {
  it('is settled by an answer when somebody answers it', async () => {
    const window = theWindow({ hold: true });
    const addon = await hosted('abortable', window);
    const asking = addon.hand('session_start', { type: 'session_start' });

    expect(window.asked).toHaveLength(1);
    window.with({ kind: 'input', value: 'prod-a' });
    await asking;
    expect(addon.said).toEqual(['deploying to prod-a']);
  });

  it('is not settled by the add-on’s own abort today — the signal is not carried', async () => {
    const window = theWindow({ hold: true });
    const addon = await hosted('abortable', window);
    const asking = addon.hand('session_start', { type: 'session_start' });
    let done = false;
    void asking.then(() => {
      done = true;
    });

    await addon.hand('agent_end', { type: 'agent_end' });

    // Plan 6.3 asks for abort to be honoured ("Honor abort/timeout"). What
    // crosses the wire is a timeout and no signal, so an add-on that aborts its
    // own question is still waiting: it is settled when the window answers or
    // the run stops, and by nothing else. The matrix records this as a gap.
    expect(done).toBe(false);
    expect(addon.said).toEqual([]);
    expect(window.asked).toHaveLength(1);
  });
});

describe('an add-on written for a terminal', () => {
  it('has every terminal-only call refused out loud, once each', async () => {
    const addon = await hosted('custom-tui');
    await addon.hand('session_start', { type: 'session_start' });

    expect(addon.refused).toEqual([
      'terminal:setWidget',
      'terminal:setFooter',
      'terminal:setHeader',
      'terminal:setEditorComponent',
      'terminal:onTerminalInput',
      'terminal:setTheme',
      'terminal:getAllThemes',
      'terminal:pasteToEditor',
      'terminal:setEditorText',
      'terminal:addAutocompleteProvider',
    ]);
    expect(addon.said).toEqual([]);
  });

  it('is refused the component it asked to draw, rather than handed a fake one', async () => {
    const addon = await hosted('custom-tui');
    const draw = addon.handler('turn_end');
    await expect(
      (draw as (...args: unknown[]) => Promise<unknown>)({ type: 'turn_end' }, addon.ctx),
    ).rejects.toThrow(/needs a terminal/);
  });

  it('is refused a theme it would otherwise draw with', async () => {
    const addon = await hosted('custom-tui');
    const read = addon.handler('agent_end');
    expect(() =>
      (read as (...args: unknown[]) => unknown)({ type: 'agent_end' }, addon.ctx),
    ).toThrow(/terminal theme/);
  });
});

describe('commands, shortcuts and providers', () => {
  it('counts an add-on’s command on its card, and registers none in the picker', async () => {
    const addon = await hosted('slash');
    expect(addon.commands.map((one) => one.name)).toEqual(['tally']);

    const card = await probe(at('slash'));
    expect(card?.commands).toEqual(['tally']);
  });

  it('records a shortcut claim twice over, and Pi is where a conflict is worked out', async () => {
    const addon = await hosted('shortcuts');
    // Two claims on one key, and one on a key Pi keeps for its own navigation.
    // Nothing in this app detects either: the fixture is the case the plan asks
    // to be detected (6.3, "Detect conflicts"), and it is not detected here.
    expect(addon.shortcuts.map((one) => one.keys)).toEqual([
      'ctrl+k',
      'ctrl+k',
      'app.model.select',
    ]);
  });

  it('lets a provider registration reach Pi, where the window’s own list does not read it', async () => {
    const addon = await hosted('providers');
    expect(addon.providers).toEqual([
      {
        name: 'cinder',
        config: {
          name: 'Cinder',
          baseUrl: 'https://models.invalid/cinder',
          api: 'pi-messages',
          models: [
            { id: 'cinder-small', name: 'Cinder Small', contextWindow: 32_000, maxTokens: 4_096 },
          ],
        },
      },
    ]);
  });
});

describe('hooks that fail, and hooks that never answer', () => {
  it('lets a throwing hook through to Pi’s own reporting rather than swallowing it', async () => {
    const addon = await hosted('hook-throws');
    const overruns: Overrun[] = [];
    const runner = withHookBudget(addon.runner(), (one) => overruns.push(one), 50);

    await expect(runner.extensions[0]?.handlers.get('turn_end')?.[0]?.()).rejects.toThrow(
      'the tally blew up',
    );
    // A failure inside the budget is a failure, not an overrun: the add-on
    // broke rather than hung, and the adapter's `onError` is what tells the
    // person which add-on it was.
    expect(overruns).toEqual([]);
  });

  it('lets go of a hook that never answers, and keeps saying it is still going', async () => {
    const addon = await hosted('hook-never');
    const overruns: Overrun[] = [];
    const runner = withHookBudget(addon.runner(), (one) => overruns.push(one), 20);

    expect(await runner.extensions[0]?.handlers.get('turn_end')?.[0]?.()).toBeUndefined();
    expect(overruns[0]).toMatchObject({
      extension: 'hook-never',
      event: 'turn_end',
      abandoned: true,
      stopped: false,
    });
    expect(hookStillRunning('hook-never', 'turn_end')).toBe(true);
  });

  it('does not keep a turn waiting for a result the add-on delivers later (T39)', async () => {
    const addon = await hosted('async-results');
    const overruns: Overrun[] = [];
    const runner = withHookBudget(addon.runner(), (one) => overruns.push(one), 20);

    expect(await runner.extensions[0]?.handlers.get('agent_end')?.[0]?.()).toBeUndefined();
    expect(addon.messages).toEqual([]);
    expect(hookStillRunning('async-results', 'agent_end')).toBe(true);

    // The work finishes anyway, on the add-on's own terms: the host stopped
    // waiting for it, it did not lose it.
    await addon.delivered;
    expect(addon.messages[0]?.message).toMatchObject({
      customType: 'crawl-result',
      display: true,
    });
    expect(addon.messages[0]?.options).toEqual({ triggerTurn: true });

    // The record clears once the handler has actually stopped, which is a step
    // after it sent anything. Nothing here is on a clock.
    for (let at = 0; at < 6; at += 1) await Promise.resolve();
    expect(hookStillRunning('async-results', 'agent_end')).toBe(false);
  });
});

describe('an add-on that cannot be installed or read', () => {
  it('fails its own install step, which is the failure the shelf has to report', () => {
    const ran = spawnSync(process.execPath, [
      fileURLToPath(
        new URL('./fixtures/extensions/install-fails/fail-install.mjs', import.meta.url),
      ),
    ]);
    expect(ran.status).toBe(1);
  });

  it('is never a card, so it is never marked active', async () => {
    await expect(probe(at('install-fails'))).resolves.toBeNull();
  });
});

describe('trust follows the files that actually run', () => {
  it('is read from the whole folder: the module beside the entry decides what it registers', async () => {
    const one = await copyOf('transitive');
    const other = await copyOf('transitive');
    await writeFile(join(other, '..', 'words.mjs'), 'export const THING = "bolt";\n');

    expect((await probe(one))?.tools).toEqual(['tidy_the_sprocket']);
    expect((await probe(other))?.tools).toEqual(['tidy_the_bolt']);
  });

  it('is asked again when a module the entry imports changes, not just the entry', async () => {
    const cache = await scratch();
    const entry = await copyOf('transitive');
    await cachedProbe(entry, cache);

    const before = JSON.parse(await readFile(join(cache, 'cards.json'), 'utf8')) as Record<
      string,
      { fingerprint: string }
    >;

    // A file the entry does not name in its own bytes. The folder is the thing
    // somebody agreed to, so this is a different add-on now — and an answer
    // kept for the old one is not an answer about this one.
    await writeFile(join(entry, '..', 'words.mjs'), 'export const THING = "bolt";\n');
    await cachedProbe(entry, cache);

    const after = JSON.parse(await readFile(join(cache, 'cards.json'), 'utf8')) as Record<
      string,
      { fingerprint: string }
    >;
    expect(after[entry]?.fingerprint).not.toBe(before[entry]?.fingerprint);
  });
});

describe('a tool running while its add-on is taken away', () => {
  it('finishes the call that is already out, and is gone from the next look', async () => {
    const entry = await copyOf('removed-midrun');
    const addon = await hosted('removed-midrun');
    const running = addon.tools[0]?.execute('call-1', {});

    await rm(join(entry, '..'), { recursive: true, force: true });
    const result = await running;

    expect(translatePiEvent(ended('long_haul', result))).toEqual({
      type: 'tool-end',
      id: 'call-1',
      ok: true,
      detail: 'finished after it was removed',
    });
    // Removal is a boundary, not a kill: the next discovery finds nothing.
    await expect(probe(entry)).resolves.toBeNull();
  });
});
