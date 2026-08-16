/** Diagrams, drawn.
 *
 * The agent writes diagram text in ```mermaid fences; this module turns that
 * text into a picture. Same trust rule as the highlighter in highlight.ts:
 * the text goes in as a string and only the diagram engine's own sanitised
 * output (an SVG) ever reaches the page. Mermaid runs in strict mode, so
 * labels are drawn as text, click handlers are off, and an %%{init}%% block
 * inside the diagram cannot talk its way around the security settings.
 *
 * The engine is a large lazy import, exactly like Shiki: nothing waits on it
 * to load, and Vite splits it into its own chunk.
 */

export type DiagramColors = {
  /** The surface the picture sits on. */
  background?: string;
  /** The app's accent — nodes, arrows, the parts that mean "the thing". */
  primary?: string;
  /** Text that must sit on the accent. */
  primaryText?: string;
  /** Ordinary diagram text. */
  text?: string;
  /** Lines, edges, borders. */
  muted?: string;
  /** The border between one shape and the next. */
  border?: string;
};

/** The colours a diagram is drawn in, read from the theme that won on :root.
 *  Purely structural — the caller decides where the document comes from. */
export function diagramTheme(
  colors: DiagramColors,
  darkMode: boolean,
): Record<string, string | number | boolean> {
  const accent = colors.primary ?? (darkMode ? '#e0714d' : '#b8492c');
  const background = colors.background ?? (darkMode ? '#0e0e0d' : '#f2f2f0');
  const text = colors.text ?? (darkMode ? '#f2f2ef' : '#1a1a19');
  const muted = colors.muted ?? (darkMode ? '#87877f' : '#6e6e68');
  const border = colors.border ?? (darkMode ? '#2b2b28' : '#e4e4e1');
  return {
    darkMode,
    background,
    primaryColor: accent,
    primaryTextColor: colors.primaryText ?? (darkMode ? '#1a1a19' : '#ffffff'),
    primaryBorderColor: border,
    secondaryColor: accent,
    tertiaryColor: muted,
    lineColor: muted,
    textColor: text,
    fontSize: '14px',
  };
}

/** Is a background colour the dark theme? Used to pick dark diagram ink. */
export function isDarkBackground(background: string): boolean {
  const hex = background.trim().replace(/^#/, '');
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return false;
  const value = Number.parseInt(hex, 16);
  const r = (value >> 16) & 0xff;
  const g = (value >> 8) & 0xff;
  const b = value & 0xff;
  // Relative luminance, the rec. 709 weighting. 0.4 is the split between the
  // app's two pages, measured once and written down.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.4;
}

let engine: Promise<MermaidApi> | null = null;

/** The part of the engine we use. The package's types declare named exports but
 *  the runtime module hands the whole API over as its default export, so the
 *  loader accepts both shapes. */
type MermaidApi = {
  initialize(config: unknown): void;
  render(id: string, text: string): Promise<{ svg: string }>;
};

function load(): Promise<MermaidApi> {
  engine ??= import('mermaid').then(
    (m) => ((m as { default?: MermaidApi }).default ?? (m as unknown as MermaidApi)),
  );
  return engine;
}

let nextId = 0;

/** A unique per-page id. Mermaid ids are document-global — its arrowheads and
 *  gradients are named for them — so two diagrams on one screen must never
 *  collide. */
function freshId(): string {
  nextId += 1;
  return `graphe-mermaid-${nextId}`;
}

/** The colours as they resolve in this window. */
function themeFromDocument(): DiagramColors {
  const style = getComputedStyle(document.documentElement);
  const pick = (name: string): string | undefined => {
    const value = style.getPropertyValue(name).trim();
    return value === '' ? undefined : value;
  };
  return {
    background: pick('--bg-sunken'),
    primary: pick('--accent'),
    primaryText: pick('--accent-text'),
    text: pick('--text'),
    muted: pick('--text-muted'),
    border: pick('--border'),
  };
}

let initializedFor: string | null = null;
let ready: Promise<void> | null = null;

/** Configure the engine once, and again whenever the theme changes. */
function ensureInitialized(): Promise<void> {
  const colors = themeFromDocument();
  const background = colors.background ?? '';
  const signature = `${background}|${colors.primary ?? ''}|${colors.text ?? ''}`;
  if (initializedFor === signature) return ready ?? Promise.resolve();
  initializedFor = signature;
  ready = load().then((mermaid) => {
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: 'strict',
      theme: 'base',
      fontFamily:
        "ui-sans-serif, -apple-system, BlinkMacSystemFont, 'SF Pro Text', 'Segoe UI', system-ui, sans-serif",
      themeVariables: diagramTheme(colors, isDarkBackground(background)),
      flowchart: { curve: 'basis' },
    });
  });
  return ready;
}

/**
 * Draw a diagram. Returns the SVG markup, or null when the text is not a
 * diagram the engine can draw — the caller shows the plain code instead.
 */
export async function renderMermaid(code: string): Promise<string | null> {
  try {
    const mermaid = await load();
    await ensureInitialized();
    const { svg } = await mermaid.render(freshId(), code);
    return typeof svg === 'string' ? svg : null;
  } catch {
    return null;
  }
}
