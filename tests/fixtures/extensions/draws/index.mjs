/** Tools an add-on draws itself, the way it draws them in a terminal.
 *
 * `renderCall` and `renderResult` return a pi-tui `Component` — anything with
 * `render(width: number): string[]` — so the add-on owns the layout and this
 * window only has to give it a width. The lines here carry ANSI colour, which
 * is what a terminal add-on will actually emit and what the window has to take
 * out before it puts them in a `<pre>`.
 *
 * `breaks_when_drawn` is the other half: a renderer that throws. Pi's own TUI
 * catches that and falls back to a plain component, and so must this window —
 * an add-on's drawing bug is not a reason to lose the step.
 */
function panel(title, rows) {
  return {
    render(width) {
      const inner = Math.max(0, width - 4);
      const line = (text) => `│ ${text.padEnd(inner)} │`;
      return [
        `┌${'─'.repeat(inner + 2)}┐`,
        line(`\u001b[1;36m${title}\u001b[0m`),
        ...rows.map((row) => line(row)),
        `└${'─'.repeat(inner + 2)}┘`,
      ];
    },
    invalidate() {},
  };
}

export default function draws(api) {
  api.registerTool({
    name: 'draw_the_report',
    label: 'Draw the report',
    description: 'Draws the report as the add-on draws it in a terminal.',
    parameters: { type: 'object', properties: { subjects: { type: 'number' } } },
    renderCall(args, _theme, _context) {
      return panel('Drawing the report', [`subjects: ${String(args.subjects ?? 'all')}`]);
    },
    renderResult(result, _options, _theme, _context) {
      const said = result.content.find((one) => one.type === 'text')?.text ?? '';
      return panel('Report', [
        '\u001b[32mdrawn\u001b[0m',
        ...said.split('\n').slice(0, 3),
      ]);
    },
    execute: async (_id, params) => ({
      content: [{ type: 'text', text: `${String(params.subjects ?? 0)} subjects drawn` }],
      details: {},
    }),
  });

  api.registerTool({
    name: 'breaks_when_drawn',
    label: 'Breaks when drawn',
    description: 'A tool whose own renderer throws.',
    parameters: { type: 'object', properties: {} },
    renderResult() {
      throw new Error('this add-on cannot draw its own result');
    },
    execute: async () => ({
      content: [{ type: 'text', text: 'the work itself was fine' }],
      details: {},
    }),
  });
}
