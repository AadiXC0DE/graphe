import type { ImageCard } from '../agent/types';
import './Shown.css';

/**
 * A picture a step took, under the line that says it took one.
 *
 * The agent can look at a page in a browser or at the screen itself, and until
 * this existed it looked alone: the model saw the picture, the person saw a
 * line of text claiming one had been taken. A screenshot nobody can see is a
 * step nobody can check, which is the opposite of what the feed is for.
 *
 * Quiet on purpose. It sits in the icon column's shadow rather than beside it,
 * it never grows past a third of the window, and the whole of it is always
 * visible — a picture cropped to fit is a picture that hides the thing somebody
 * wanted to look at.
 */
export function Shown({ picture, caption }: { picture: ImageCard; caption?: string }) {
  return (
    <figure className="shown">
      <img
        className="shown__image"
        src={`data:${picture.mimeType};base64,${picture.bytes}`}
        alt={caption ?? 'What was on screen'}
      />
      {caption === undefined ? null : <figcaption className="shown__caption">{caption}</figcaption>}
    </figure>
  );
}
