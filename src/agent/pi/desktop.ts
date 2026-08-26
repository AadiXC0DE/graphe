/** The computer itself.
 *
 * The browser next door covers the web. This covers the rest: the design tool
 * installed on this machine, the mail app, the calendar.
 *
 * There is no outline of a native window worth reading, so the method is a
 * picture and a coordinate — which only works if the two agree. Every picture
 * is scaled to the screen's own point grid first, so a coordinate read off a
 * picture is a coordinate on the screen and nobody carries a scale factor.
 *
 * Two permissions, both asked by the computer rather than by us: one to see the
 * screen, one to point at it. Until they are given these say so and open the
 * right settings page. Pointing goes through the computer's own scripting.
 * Dragging is the one move it cannot make; `cliclick` covers it where it is
 * installed, and where it is not a drag says so rather than pretending.
 *
 * The Guard holds these rows: looking at a whole screen is not looking at the
 * project's own page, so it asks, and so does every move.
 */

import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// One line on purpose, like tools.ts: the boundary test reads the line that
// names Pi and expects `import type` on it.
import type { AgentToolResult, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { notHere, runHelper, type Ran } from '../../share/run';

type ToolResult = Promise<AgentToolResult<unknown>>;

/** One call out to the computer. Injected, so every sentence below is testable
 *  without a screen. */
export type DesktopHost = (
  tool: string,
  args: readonly string[],
  options: { patience?: number; signal?: AbortSignal },
) => Promise<Ran>;

/** Short: these are single system calls, and a wedged one holds up a turn. */
const PATIENCE_MS = 30_000;

/** A picture is paid for in every later turn that carries it, so it goes back
 *  at a size worth reading and no more. */
const PICTURE_QUALITY = 60;

/** Only where there is a screen we know how to read. Elsewhere these are not on
 *  the list at all, rather than four tools that answer "not here". */
export function desktopHere(platform: string = process.platform): boolean {
  return platform === 'darwin';
}

export const DESKTOP_WORDS = {
  cannotSee:
    'This computer has not been given permission to let me see the screen. I have opened the setting for you — switch Graphe on under the list for seeing the screen, then ask me again.',
  cannotPoint:
    'This computer has not been given permission to let me point at things on screen. I have opened the setting for you — switch Graphe on under the list for controlling the computer, then ask me again.',
  noPicture:
    'I could not get a picture of the screen, so I have not tried to do anything to it.',
  noDrag:
    'Dragging something across the screen needs a small helper this computer does not have, so I have left that step undone. Everything else here works without it.',
  nothingToDo: 'None of those is a move I can make, so I have done nothing.',
  stopped: 'That was stopped.',
} as const;

/* -------------------------------------------------------------------------- */
/* Permissions                                                                 */
/* -------------------------------------------------------------------------- */

/** The two settings pages, by the names the computer knows them under. */
const SETTINGS = {
  see: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  point: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
} as const;

/** What a refusal to let us point at things reads like, in every wording the
 *  computer uses for it. */
export function refusedPointing(said: string): boolean {
  return /assistive access|not authorized|-1743|-25211|osascript is not allowed/i.test(said);
}

/* -------------------------------------------------------------------------- */
/* Saying it in the computer's own language                                    */
/* -------------------------------------------------------------------------- */

/** A string, as the computer's scripting wants to read it. */
export function quoted(text: string): string {
  return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

/** The keys that have a number rather than a letter. */
const KEY_CODES: Readonly<Record<string, number>> = {
  enter: 36,
  return: 36,
  tab: 48,
  space: 49,
  delete: 51,
  backspace: 51,
  escape: 53,
  esc: 53,
  left: 123,
  right: 124,
  down: 125,
  up: 126,
  home: 115,
  end: 119,
  pageup: 116,
  pagedown: 121,
  forwarddelete: 117,
};

const MODIFIERS: Readonly<Record<string, string>> = {
  cmd: 'command down',
  command: 'command down',
  ctrl: 'control down',
  control: 'control down',
  alt: 'option down',
  option: 'option down',
  shift: 'shift down',
  fn: 'function down',
};

/** One key press, written the way people write shortcuts. Null when the words
 *  name no key, so a nonsense step is left undone rather than guessed at. */
export function keyLine(keys: string): string | null {
  const parts = keys
    .split('+')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '');
  if (parts.length === 0) return null;
  const last = parts[parts.length - 1] as string;
  const held = parts.slice(0, -1).map((part) => MODIFIERS[part]);
  if (held.some((one) => one === undefined)) return null;
  const using = held.length === 0 ? '' : ` using {${held.join(', ')}}`;
  const code = KEY_CODES[last];
  if (code !== undefined) return `key code ${String(code)}${using}`;
  const fn = /^f([1-9]|1[0-2])$/.exec(last);
  if (fn !== null) {
    const numbered = [122, 120, 99, 118, 96, 97, 98, 100, 101, 109, 103, 111];
    return `key code ${String(numbered[Number(fn[1]) - 1] ?? 122)}${using}`;
  }
  if (last.length !== 1) return null;
  return `keystroke ${quoted(last)}${using}`;
}

/** One thing to do to the screen. */
export type Doing = {
  do: string;
  x?: number;
  y?: number;
  toX?: number;
  toY?: number;
  text?: string;
  keys?: string;
  way?: string;
  amount?: number;
  ms?: number;
};

/** What one step turns into: a command to run, a step to skip, or a reason it
 *  cannot be done at all. */
export type Move =
  | { kind: 'script'; script: string; said: string }
  | { kind: 'drag'; args: string[]; said: string }
  | { kind: 'skip'; because: string | null };

function place(step: Doing): { x: number; y: number } | null {
  const x = Math.round(Number(step.x));
  const y = Math.round(Number(step.y));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x, y };
}

/** One step, as something the computer can be told to do. Pure, so which moves
 *  are possible and how they are worded is decided where a test can read it. */
export function asMove(step: Doing): Move {
  const kind = (step.do ?? '').trim().toLowerCase();
  const at = place(step);
  const clicking: Readonly<Record<string, string>> = {
    click: 'click',
    press: 'click',
    double: 'double click',
    doubleclick: 'double click',
    right: 'right click',
    rightclick: 'right click',
  };
  if (clicking[kind] !== undefined) {
    if (at === null) return { kind: 'skip', because: null };
    const how = clicking[kind] as string;
    return {
      kind: 'script',
      script: `${how} at {${String(at.x)}, ${String(at.y)}}`,
      said: `${how === 'click' ? 'Pressed' : how === 'double click' ? 'Double-pressed' : 'Right-pressed'} ${String(at.x)}, ${String(at.y)}`,
    };
  }
  if (kind === 'move' || kind === 'hover') {
    // The computer's own scripting cannot move the pointer without pressing, so
    // this is the one move that quietly does nothing rather than doing the
    // wrong thing. A press is a press; hovering is not worth a lie.
    return { kind: 'skip', because: null };
  }
  if (kind === 'drag') {
    const to = { x: Math.round(Number(step.toX)), y: Math.round(Number(step.toY)) };
    if (at === null || !Number.isFinite(to.x) || !Number.isFinite(to.y)) {
      return { kind: 'skip', because: null };
    }
    return {
      kind: 'drag',
      args: [`dd:${String(at.x)},${String(at.y)}`, `dm:${String(to.x)},${String(to.y)}`, `du:${String(to.x)},${String(to.y)}`],
      said: `Dragged ${String(at.x)}, ${String(at.y)} to ${String(to.x)}, ${String(to.y)}`,
    };
  }
  if (kind === 'type') {
    const text = step.text ?? '';
    if (text === '') return { kind: 'skip', because: null };
    return { kind: 'script', script: `keystroke ${quoted(text)}`, said: 'Typed it' };
  }
  if (kind === 'key' || kind === 'keys') {
    const line = keyLine(step.keys ?? step.text ?? '');
    if (line === null) return { kind: 'skip', because: null };
    return { kind: 'script', script: line, said: `Pressed ${(step.keys ?? step.text ?? '').trim()}` };
  }
  if (kind === 'scroll') {
    const way = (step.way ?? 'down').trim().toLowerCase();
    const code = way === 'up' ? 116 : 121;
    const many = Math.min(Math.max(Math.round(Number(step.amount ?? 1)) || 1, 1), 20);
    const line = `key code ${String(code)}`;
    return {
      kind: 'script',
      script: Array.from({ length: many }, () => line).join('\n  '),
      said: `Scrolled ${way === 'up' ? 'up' : 'down'} ${String(many)} screen${many === 1 ? '' : 's'}`,
    };
  }
  if (kind === 'wait') {
    const ms = Math.min(Math.max(Math.round(Number(step.ms ?? 500)) || 500, 50), 10_000);
    return {
      kind: 'script',
      script: `delay ${(ms / 1000).toFixed(2)}`,
      said: `Waited ${String(ms)}ms`,
    };
  }
  return { kind: 'skip', because: null };
}

/** A run of moves, as one script. Each is followed by a short settle: a window
 *  still redrawing is a window the next press lands in the wrong place on. */
export function asScript(lines: readonly string[]): string {
  const body = lines.map((line) => `  ${line}\n  delay 0.15`).join('\n');
  return `tell application "System Events"\n${body}\nend tell`;
}

/* -------------------------------------------------------------------------- */
/* The screen                                                                  */
/* -------------------------------------------------------------------------- */

/** The screen's own point grid, which is the grid every coordinate here is in. */
export function readBounds(said: string): { width: number; height: number } | null {
  const numbers = said.match(/-?\d+/g);
  if (numbers === null || numbers.length < 4) return null;
  const [left, top, right, bottom] = numbers.slice(0, 4).map(Number) as [number, number, number, number];
  const width = right - left;
  const height = bottom - top;
  if (width <= 0 || height <= 0) return null;
  return { width, height };
}

/* -------------------------------------------------------------------------- */
/* The tools                                                                   */
/* -------------------------------------------------------------------------- */

function say(text: string): AgentToolResult<unknown> {
  return { content: [{ type: 'text', text }], details: {} };
}

/**
 * The four tools that work the computer itself.
 *
 * Four and not seventeen: everything a person does with a mouse and a keyboard
 * fits in these, and a run of moves in one call is what keeps a twenty-step job
 * from being twenty questions.
 */
export function desktopTools(projectRoot?: string, host?: DesktopHost): ToolDefinition[] {
  const folder = projectRoot ?? tmpdir();
  const run: DesktopHost =
    host ?? ((tool, args, options) => runHelper(tool, args, { folder, ...options }));

  /** Whether the small dragging helper is here. Worked out once. */
  let dragger: Promise<boolean> | null = null;
  const canDrag = async (): Promise<boolean> => {
    dragger ??= run('cliclick', ['-V'], { patience: 10_000 }).then((ran) => !notHere(ran));
    return dragger;
  };

  const script = async (body: string, signal?: AbortSignal): Promise<Ran> =>
    run('osascript', ['-e', body], {
      patience: PATIENCE_MS,
      ...(signal === undefined ? {} : { signal }),
    });

  /** Open the settings page for whichever permission is missing, and say so. */
  const askFor = async (which: 'see' | 'point'): Promise<AgentToolResult<unknown>> => {
    await run('open', [SETTINGS[which]], { patience: 10_000 }).catch(() => undefined);
    return say(which === 'see' ? DESKTOP_WORDS.cannotSee : DESKTOP_WORDS.cannotPoint);
  };

  const screenSize = async (signal?: AbortSignal): Promise<{ width: number; height: number }> => {
    const ran = await script('tell application "Finder" to get bounds of window of desktop', signal);
    return readBounds(ran.out) ?? { width: 1440, height: 900 };
  };

  const frontmost = async (signal?: AbortSignal): Promise<string | null> => {
    const ran = await script(
      'tell application "System Events" to get name of first application process whose frontmost is true',
      signal,
    );
    const name = ran.out.trim();
    return ran.code === 0 && name !== '' ? name : null;
  };

  /** A picture of the screen, in the screen's own point grid. */
  const picture = async (
    signal?: AbortSignal,
  ): Promise<{ bytes: string; width: number; height: number } | null> => {
    const size = await screenSize(signal);
    const where = await mkdtemp(join(tmpdir(), 'graphe-screen-'));
    const raw = join(where, 'screen.jpg');
    const sized = join(where, 'sized.jpg');
    try {
      const shot = await run('screencapture', ['-x', '-t', 'jpg', raw], {
        patience: PATIENCE_MS,
        ...(signal === undefined ? {} : { signal }),
      });
      if (shot.code !== 0) return null;
      const big = await stat(raw).catch(() => null);
      if (big === null || big.size === 0) return null;
      // Scaled to points, so a coordinate in the picture is a coordinate on the
      // screen and nobody has to carry a scale factor around.
      const scaled = await run(
        'sips',
        [
          '-s', 'format', 'jpeg',
          '-s', 'formatOptions', String(PICTURE_QUALITY),
          '--resampleWidth', String(size.width),
          raw,
          '-o', sized,
        ],
        { patience: PATIENCE_MS },
      );
      const bytes = await readFile(scaled.code === 0 ? sized : raw).catch(() => null);
      if (bytes === null) return null;
      return { bytes: bytes.toString('base64'), width: size.width, height: size.height };
    } finally {
      await rm(where, { recursive: true, force: true }).catch(() => undefined);
    }
  };

  const shown = async (signal?: AbortSignal): Promise<AgentToolResult<unknown>> => {
    const shot = await picture(signal);
    if (shot === null) return askFor('see');
    const front = await frontmost(signal);
    const where = front === null ? '' : ` ${front} is in front.`;
    return {
      content: [
        {
          type: 'text',
          text: `The screen is ${String(shot.width)} across and ${String(shot.height)} down, and so is this picture — point at it in these numbers.${where}`,
        },
        { type: 'image', data: shot.bytes, mimeType: 'image/jpeg' },
      ],
      details: {},
    };
  };

  return [
    {
      name: 'desktop_picture',
      label: 'Taking a picture of the screen',
      description:
        'Take a picture of this computer\'s screen, and say how big it is and which application is in front. The picture is the only way to see a program that is not a website, so take one before pointing at anything and again after every run of moves. Coordinates are the picture\'s own pixels, counted from its top left.',
      promptSnippet: 'desktop_picture(app?) — a picture of the screen, and what is in front of it',
      promptGuidelines: [
        'Always take a picture before pointing at the screen, and another after moving, rather than assuming where things ended up.',
        'The picture is the same size as the screen, so a coordinate you read off it is the coordinate to point at.',
      ],
      parameters: Type.Object({
        app: Type.Optional(
          Type.String({ description: 'Bring this application to the front first, by its name.' }),
        ),
      }),
      executionMode: 'sequential',
      execute: async (_callId, params: { app?: string }, signal): ToolResult => {
        const wanted = (params.app ?? '').trim();
        if (wanted !== '') {
          const ran = await script(`tell application ${quoted(wanted)} to activate`, signal);
          if (ran.code !== 0 && refusedPointing(ran.said)) return askFor('point');
        }
        return shown(signal);
      },
    },
    {
      name: 'desktop_do',
      label: 'Working the computer',
      description:
        'Do a run of things to whatever is on screen: press somewhere, double-press, right-press, drag, type, press keys, scroll, wait. Give the whole run in one call rather than one call each — it is faster, and it is what keeps a long job from being a long line of questions. A picture of the screen comes back at the end, so you can see where it got to.',
      promptSnippet: 'desktop_do(steps) — press, type and scroll on this computer, then see the result',
      promptGuidelines: [
        'Take a picture first. Coordinates guessed from memory land on the wrong thing.',
        'Keep runs short enough to check — five or six moves, then look at the picture that comes back.',
        'Never type a password or a key into a program this way.',
      ],
      parameters: Type.Object({
        steps: Type.Array(
          Type.Object({
            do: Type.String({
              description:
                "'click', 'double', 'right', 'drag', 'type', 'key', 'scroll' or 'wait'.",
              minLength: 1,
            }),
            x: Type.Optional(Type.Number({ description: 'Across, in the picture\'s own pixels.' })),
            y: Type.Optional(Type.Number({ description: 'Down, in the picture\'s own pixels.' })),
            toX: Type.Optional(Type.Number({ description: 'For drag: where it ends up, across.' })),
            toY: Type.Optional(Type.Number({ description: 'For drag: where it ends up, down.' })),
            text: Type.Optional(Type.String({ description: 'For type: the words.' })),
            keys: Type.Optional(
              Type.String({ description: "For key: written the way people write shortcuts, such as 'cmd+s', 'Enter' or 'shift+tab'." }),
            ),
            way: Type.Optional(Type.String({ description: "For scroll: 'down' or 'up'." })),
            amount: Type.Optional(Type.Number({ description: 'For scroll: how many screens. One by default.' })),
            ms: Type.Optional(Type.Number({ description: 'For wait: how long, in milliseconds.' })),
          }),
          { description: 'The moves, in order.', minItems: 1 },
        ),
      }),
      executionMode: 'sequential',
      execute: async (_callId, params: { steps: readonly Doing[] }, signal): ToolResult => {
        const moves = params.steps.map(asMove);
        const done: string[] = [];
        const missed: string[] = [];
        let pending: string[] = [];

        const flush = async (): Promise<AgentToolResult<unknown> | null> => {
          if (pending.length === 0) return null;
          const ran = await script(asScript(pending), signal);
          pending = [];
          if (ran.code === 0) return null;
          return refusedPointing(ran.said) ? await askFor('point') : say(ran.said.trim());
        };

        for (const move of moves) {
          if (move.kind === 'script') {
            pending.push(move.script);
            done.push(move.said);
            continue;
          }
          if (move.kind === 'drag') {
            const stopped = await flush();
            if (stopped !== null) return stopped;
            if (!(await canDrag())) {
              missed.push(DESKTOP_WORDS.noDrag);
              continue;
            }
            const ran = await run('cliclick', move.args, {
              patience: PATIENCE_MS,
              ...(signal === undefined ? {} : { signal }),
            });
            if (ran.code !== 0) return say(ran.said.trim());
            done.push(move.said);
            continue;
          }
          missed.push('One of those is not a move I can make, so I left it out.');
        }
        const stopped = await flush();
        if (stopped !== null) return stopped;
        if (done.length === 0) {
          return say(missed.length === 0 ? DESKTOP_WORDS.nothingToDo : missed.join('\n'));
        }

        const after = await shown(signal);
        const note = [...done, ...new Set(missed)].join('\n');
        return { ...after, content: [{ type: 'text', text: note }, ...after.content] };
      },
    },
    {
      name: 'desktop_apps',
      label: 'Looking at what is open',
      description:
        'What is open on this computer right now, which one is in front, and what its windows are called. Use it to find out whether the program you need is already running before opening it, and to name a window you are about to work in.',
      promptSnippet: 'desktop_apps() — what is open on this computer and what is in front',
      parameters: Type.Object({}),
      executionMode: 'sequential',
      execute: async (_callId, _params, signal): ToolResult => {
        const all = await script(
          'tell application "System Events" to get name of every application process whose background only is false',
          signal,
        );
        if (all.code !== 0) {
          return refusedPointing(all.said) ? askFor('point') : say(all.said.trim());
        }
        const front = await frontmost(signal);
        const windows = await script(
          'tell application "System Events" to tell (first application process whose frontmost is true) to get name of every window',
          signal,
        );
        const named = windows.code === 0 ? windows.out.trim() : '';
        const parts = [`Open: ${all.out.trim()}`];
        if (front !== null) parts.push(`In front: ${front}`);
        if (named !== '') parts.push(`Its windows: ${named}`);
        return say(parts.join('\n'));
      },
    },
    {
      name: 'desktop_open',
      label: 'Opening something on the computer',
      description:
        "Open a program on this computer by its name, or bring it to the front if it is already open. Use it before working in something that is not a website — a design tool, a mail app, a calendar. A picture of the screen comes back, so you can see it arrive.",
      promptSnippet: 'desktop_open(app) — open a program on this computer, or bring it to the front',
      parameters: Type.Object({
        app: Type.String({ description: 'What the program is called on this computer.', minLength: 1 }),
      }),
      executionMode: 'sequential',
      execute: async (_callId, params: { app: string }, signal): ToolResult => {
        const wanted = params.app.trim();
        const opened = await run('open', ['-a', wanted], {
          patience: PATIENCE_MS,
          ...(signal === undefined ? {} : { signal }),
        });
        if (opened.code !== 0) {
          return say(`I could not find a program called ${wanted} on this computer.`);
        }
        // Give it a moment to draw itself before the picture is taken, or the
        // picture is of the screen it was covering.
        await script(`delay 1.5\ntell application ${quoted(wanted)} to activate`, signal);
        return shown(signal);
      },
    },
  ];
}
