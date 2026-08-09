import type { ReactNode } from 'react';
import './VersionRow.css';

type Props = {
  /** Plain title, in the user's words: "Made the header sticky". */
  title: string;
  /** Already relative, already rounded: "4 minutes ago", "Yesterday, 6:12pm". */
  time: string;
  /** A rendered thumbnail. Left off, a neutral frame placeholder stands in. */
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
 * consequence-free (notes/strategy/UI-DESIGN.md). So hovering moves nothing: the surface
 * changes tone over 120ms and that is all. A row that lifts, grows or slides
 * makes a list of forty of them feel like weather, and any hesitation here makes
 * people afraid to explore, which is the whole point of the feature.
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
        <span className="versionrow__thumb">
          {thumbnail ?? (
            <svg viewBox="0 0 56 38" className="versionrow__placeholder" aria-hidden="true">
              <rect x="7" y="9" width="24" height="3.4" rx="1.7" fill="currentColor" />
              <rect x="7" y="17" width="42" height="2.6" rx="1.3" fill="currentColor" />
              <rect x="7" y="23" width="34" height="2.6" rx="1.3" fill="currentColor" />
            </svg>
          )}
        </span>

        <span className="versionrow__text">
          <span className="versionrow__title">{title}</span>
          <span className="versionrow__time">{time}</span>
        </span>

        {current ? <span className="versionrow__badge">On screen</span> : null}
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
