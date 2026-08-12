import Versions from './Versions';
import type { GitSnapshot, PutBack, SavedVersion } from '../lib/ipc';
import './History.css';

type Props = {
  versions: readonly SavedVersion[];
  pictures?: Readonly<Record<string, string>>;
  kept?: readonly string[];
  putBack: PutBack | null;
  onPutBack: (versionId: string) => void;
  onName: (versionId: string, name: string) => void;
  onKeep?: (versionId: string, keep: boolean) => void;
  onDismissPutBack: () => void;
  /** Open the whole thing, drawn as lines, over the conversation. */
  onOpenGraph: () => void;
  busy?: boolean;
  showMe?: boolean;
  git: GitSnapshot | null;
};

export const SAYS = {
  heading: 'History',
  graph: 'See the lines',
  graphHint: 'Every moment, what came after what, and where two goes at the same thing joined.',
} as const;

/**
 * Everything the project has been, in the panel.
 *
 * Two readings of one thing. The pictures are here, where they fit: a card is
 * small and the panel is a column of them. The lines — what came after what,
 * which branch, which id — need the width of the work, so they open over it.
 */
export default function History({
  versions,
  pictures,
  kept,
  putBack,
  onPutBack,
  onName,
  onKeep,
  onDismissPutBack,
  onOpenGraph,
  busy,
  showMe,
  git,
}: Props) {
  return (
    <div className="history">
      <div className="history__top">
        <h2 className="history__title">{SAYS.heading}</h2>
        {git?.branch === null || git === null ? null : (
          <span className="history__line" title="The line of work this project is on">
            {git.branch}
          </span>
        )}
      </div>

      <Versions
        versions={versions}
        pictures={pictures}
        kept={kept}
        putBack={putBack}
        onPutBack={onPutBack}
        onName={onName}
        {...(onKeep === undefined ? {} : { onKeep })}
        onDismissPutBack={onDismissPutBack}
        busy={busy}
        showMe={showMe}
        bare
      />

      {versions.length === 0 ? null : (
        <button type="button" className="history__do" onClick={onOpenGraph}>
          {SAYS.graph}
        </button>
      )}
    </div>
  );
}
