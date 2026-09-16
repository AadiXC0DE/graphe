/** A step's own result, as the add-on that made it draws it in a terminal.
 *
 * Pi lets a tool bring `renderCall` / `renderResult`, and in a terminal that is
 * the whole of how the step looks. Here there is no terminal, so until now the
 * add-on's own drawing was never seen at all: the step fell back to one generic
 * line, which is honest but is not what the add-on wrote.
 *
 * The lines arrive already laid out, at eighty columns and with the colour
 * taken out (`src/agent/pi/tool-drawing.ts`). `<pre>` because the drawing's
 * whitespace is the drawing: re-flowing a box art panel to the window's width
 * turns it into a paragraph.
 *
 * The line above the panel is the app's, not the add-on's. An add-on's output
 * arriving unannounced in the conversation reads as something Graphe decided to
 * show, and nobody could tell which of the two wrote it.
 */

import './Drawn.css';

export function Drawn({ lines }: { lines: readonly string[] }) {
  return (
    <figure className="drawn">
      <figcaption className="drawn__said">
        Drawn as this add-on draws it in a terminal
      </figcaption>
      <pre className="drawn__sheet">{lines.join('\n')}</pre>
    </figure>
  );
}
