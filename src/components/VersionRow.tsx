import type { ReactNode } from 'react';
import './VersionRow.css';

type Props = {
  /** Plain title, in the user's words: "Made the header sticky". */
  title: string;
  /** Already relative, already rounded: "4 minutes ago", "Yesterday, 6:12pm". */
  time: string;
  /** A rendered thumbnail of what the project looked like. Left off, the row
   *  shows its place on the timeline instead — see the note below. */
  thumbnail?: ReactNode;
  /** The version currently on screen. It gets a marker, not a restore button. */
  current?: boolean;
  /** Show this version in the preview. Hovering the row should already do it. */
  onOpen?: () => void;
  onRestore?: () => void;
};

/** One entry in the version timeline.
 *
 * Scrubbing has to feel like Figma's version history — immediate, weightless,
 * consequence-free (notes/strategy/UI-DESIGN.md). So hovering moves nothing: the
 * surface changes tone over 120ms and that is all. A row that lifts, grows or
 * slides makes a list of forty of them feel like weather, and any hesitation
 * here makes people afraid to explore, which is the whole point of the feature.
 *
 * ## Why there is no grey rectangle any more
 *
 * Every row used to draw a 56×38 frame with three grey bars in it, standing in
 * for a thumbnail nothing has rendered yet. Five of those down a rail is
 * indistinguishable from a skeleton screen that never finished loading — the
 * exact tell UI-DESIGN.md lists as an anti-pattern — and it cost a third of the
 * rail's width to say nothing. A real thumbnail still gets drawn when there is
 * one. With none, the row shows the honest thing instead: where this moment sits
 * on the timeline, as a node on a line.
 *
 * Restore is a real, permanently visible button rather than something that
 * materialises on hover — hidden-until-hover controls do not exist for a
 * keyboard or a trackpad-free user. It is simply quiet until you go near it. */
export default function VersionRow({ title, time, thumbnail, current, onOpen, onRestore }: Props) {
  return (
    <li className={`versionrow ${current ? 'versionrow--current' : ''}`}>
      <button
        type="button"
        className="versionrow__open"
        onClick={onOpen}
        aria-current={current ? 'true' : undefined}
      >
        {thumbnail ? (
          <span className="versionrow__thumb">{thumbnail}</span>
        ) : (
          <span className="versionrow__node" aria-hidden="true" />
        )}

        <span className="versionrow__text">
          <span className="versionrow__title">{title}</span>
          <span className="versionrow__meta">
            <span className="versionrow__time">{time}</span>
            {current ? <span className="versionrow__badge">On screen</span> : null}
          </span>
        </span>
      </button>

      {!current && onRestore ? (
        <button
          type="button"
          className="versionrow__restore"
          onClick={onRestore}
          aria-label={`Put back: ${title}`}
        >
          Put back
        </button>
      ) : null}
    </li>
  );
}
