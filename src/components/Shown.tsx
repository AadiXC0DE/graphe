import type { ImageCard } from '../agent/types';
import './Shown.css';

/**
 * A picture a step took, under the line that says it took one.
 *
 * The agent can look at a page in a browser or at the screen itself, and until
 * this existed it looked alone: the model saw the picture, the person saw a
 * line of text claiming one had been taken. A screenshot nobody can see is a
 * step nobody can check.
 *
 * Quiet on purpose. It sits in the icon column's shadow, never grows past a
 * third of the window, and is never blown up past its own size — the line above
 * already says what it is, so it says nothing itself.
 */
export function Shown({ picture, label }: { picture: ImageCard; label?: string }) {
  return (
    <img
      className="shown"
      src={`data:${picture.mimeType};base64,${picture.bytes}`}
      alt={label ?? 'What was on screen'}
    />
  );
}
