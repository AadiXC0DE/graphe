/** An add-on's tool, drawn by the add-on itself, at a width this window picks.
 *
 * Pi's extension API lets a tool bring its own `renderCall` / `renderResult`,
 * and in a terminal that is the whole of how the step looks. Here there is no
 * terminal, so the add-on's own drawing has never been seen at all: the step
 * falls back to the generic line, which is honest but is not what the add-on
 * wrote.
 *
 * What crosses the boundary is narrow on purpose. A pi-tui `Component` is
 * anything with `render(width: number): string[]` and an `invalidate()`, so
 * this file hands the component a width and takes back lines of text. No Pi
 * object comes out, nothing is stored, and the component is not kept alive
 * afterwards — the lines are, and they are strings.
 *
 * Two things are refused by construction rather than caught late:
 *
 *  - A renderer that throws. Pi's own TUI catches it and falls back to a plain
 *    text component (`tool-execution.js:236-246`), because an add-on with a
 *    drawing bug should not lose the step. So does this: null means "draw it
 *    the ordinary way", never an error the caller has to handle.
 *  - ANSI colour. A terminal add-on writes escape codes into its own lines,
 *    and the window draws text. Stripping here rather than in the renderer
 *    keeps the `<pre>` free of codes that would land in a copied line.
 */

/** A pi-tui component, as much of it as drawing one needs. */
export type Drawable = {
  render(width: number): string[];
  invalidate?(): void;
};

/** The piece of a tool definition this reads. Everything else on it — the
 *  parameters, the executor — is Pi's business and is never touched. */
export type Renderable = {
  renderCall?: unknown;
  renderResult?: unknown;
};

/** What a renderer is given that a headless call can honestly supply. The rest
 *  of Pi's `ToolRenderContext` describes a terminal: a cwd, an expanded flag,
 *  a last component to diff against. A renderer that needs one of those gets
 *  the safe reading rather than a lie about a window that does not exist. */
export type DrawContext = {
  args: unknown;
  toolCallId: string;
  isError: boolean;
  expanded: boolean;
  isPartial: boolean;
};

/**
 * The theme a renderer colours with, as a stub that colours nothing.
 *
 * Every colour a renderer adds is stripped before the lines are drawn, so a
 * theme whose methods return their text unchanged is not a shortcut — it is
 * exactly as much of a theme as the result can carry. A proxy rather than a
 * list of methods: an add-on may reach for one this file has never heard of,
 * and a missing method is a crash in somebody else's code.
 */
function flatTheme(): unknown {
  const identity = (text: unknown): unknown => text;
  return new Proxy(
    {},
    {
      get: (_target, key) =>
        key === 'getColorMode'
          ? () => 'truecolor'
          : key === 'getFgAnsi' || key === 'getBgAnsi'
            ? () => ''
            : identity,
    },
  );
}

/** The context Pi would hand a renderer, with the terminal parts left empty. */
function contextFor(call: DrawContext, invalidate: () => void): unknown {
  return {
    args: call.args,
    toolCallId: call.toolCallId,
    invalidate,
    lastComponent: undefined,
    state: undefined,
    cwd: '',
    executionStarted: true,
    argsComplete: true,
    isPartial: call.isPartial,
    expanded: call.expanded,
    showImages: false,
    isError: call.isError,
  };
}

/** Everything that is not a colour code, with the line breaks a terminal would
 *  have drawn kept. CSI covers the colours and cursor moves; OSC covers the
 *  window-title and hyperlink forms, which end with BEL or ST rather than a
 *  final byte. The control characters are the whole point of the pattern. */
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g;

/** What a terminal add-on wrote, as text a window can draw. */
export function plainLines(lines: readonly string[]): string[] {
  const plain: string[] = [];
  for (const line of lines) {
    // A line that was nothing but colour is nothing, and a `<pre>` full of
    // blank rows is a card that looks broken.
    const stripped = line.replace(ANSI, '').replace(/\s+$/, '');
    if (stripped !== '') plain.push(stripped);
  }
  return plain;
}

/** Whether a renderer handed back something this can actually draw. */
function componentIn(value: unknown): Drawable | null {
  if (value === null || typeof value !== 'object') return null;
  const held = value as { render?: unknown };
  return typeof held.render === 'function' ? (held as Drawable) : null;
}

/**
 * One call to a renderer, with everything that can go wrong inside this file.
 *
 * Null for every failure — a renderer that throws, one that returns something
 * that is not a component, one that returns nothing at all, and one whose
 * `render` throws. The caller draws the ordinary card in every one of those
 * cases, which is what Pi's own TUI does and what a person expects: the step
 * happened, whatever the add-on's drawing did.
 */
/** A renderer, as much of its signature as calling one needs. The real one is
 *  Pi's own typed function; nothing here can name it, and its arguments are the
 *  add-on's business. */
type AnyRenderer = (...args: unknown[]) => unknown;

function draw(
  renderer: unknown,
  width: number,
  invoke: (render: AnyRenderer) => unknown,
): string[] | null {
  if (typeof renderer !== 'function') return null;
  const component = componentIn(invoke(renderer as AnyRenderer));
  if (component === null) return null;
  try {
    const lines = component.render(width);
    if (!Array.isArray(lines)) return null;
    return plainLines(lines.filter((one): one is string => typeof one === 'string'));
  } catch {
    return null;
  }
}
/** How wide the add-on is told to draw. A terminal is eighty columns by habit,
 *  and every renderer written for Pi was written against one. */
export const DRAW_WIDTH = 80;

/**
 * What the add-on drew for the call itself, before it ran.
 *
 * `renderCall` is optional and a definition without one is the ordinary case,
 * so null here is not a failure — it is a tool that has nothing to say until it
 * has done the work.
 */
export function drawnCall(
  definition: Renderable,
  call: DrawContext,
  width: number = DRAW_WIDTH,
): string[] | null {
  return draw(definition.renderCall, width, (render) =>
    render(call.args, flatTheme(), contextFor(call, () => undefined)),
  );
}

/**
 * What the add-on drew for the result — the one a person actually reads.
 *
 * `result` is Pi's own `AgentToolResult` shape, handed over as the fields a
 * renderer reads rather than as the object itself, so no Pi result crosses this
 * seam even though only the add-on ever sees it.
 */
export function drawnResult(
  definition: Renderable,
  call: DrawContext,
  result: { content: unknown; details: unknown },
  width: number = DRAW_WIDTH,
): string[] | null {
  return draw(definition.renderResult, width, (render) =>
    render(
      { content: result.content, details: result.details },
      { expanded: call.expanded, isPartial: call.isPartial },
      flatTheme(),
      contextFor(call, () => undefined),
    ),
  );
}
