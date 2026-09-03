import ProjectPicker from './ProjectPicker';
import type { RecentProject } from '../lib/ipc';
import { showMeCopy } from '../lib/showme';
import './ProjectMenu.css';

type Props = {
  projects: readonly RecentProject[];
  openPath: string | null;
  onOpen: (project: RecentProject) => void;
  onForget: (project: RecentProject) => void;
  onBrowse: () => void;

  /** The name of the editor installed on this machine, or null when there is
   *  none to offer. Never a guess: the shell looked. */
  editor: string | null;
  onOpenInEditor: () => void;
  onRevealFolder: () => void;

  /** Get the project ready and open it — the same thing the floating pill
   *  does, kept here too for the people who live in this menu. */
  onPreview: () => void;
  /** Open the connect screen, where the account and the model are chosen. */
  onAccount: () => void;
  /** Open the screen where more can be added to Graphe. */
  onAddMore: () => void;

  showMe: boolean;
  onShowMe: (on: boolean) => void;

  /** Whether everything the project holds is on screen beside the
   *  conversation. Stays as it was left, so this is a state and not an
   *  action. */
  showFiles: boolean;
  onShowFiles: (on: boolean) => void;
};

/**
 * Everything about *this project* that is not the conversation.
 *
 * ## Why all three of these live in one menu
 *
 * The escape hatches (BACKLOG D2) and the "Show me" switch (D1) are the same
 * promise from two directions: **the agent manages everything by default, and
 * anyone who wants the wheel can have it.** One says "here is the real folder,
 * go and look"; the other says "here is the real name of what I just did".
 * Somebody who wants either almost always wants both, and they are answers to
 * the same question — *what is actually going on underneath this?*
 *
 * ## Why they are behind the project's name, and not in the strip
 *
 * The strip along the top is 38 pixels of furniture holding two things: which
 * project this is, and the button that shows it to you. Three more permanent
 * controls in there would make the furniture louder than the work, and they
 * would be loudest for the people who will never press them — which is most
 * people, by design.
 *
 * The project's name is already the affordance for "this project": it is how you
 * switch between them, and people who have more than one folder click it every
 * session. Hanging "open this project's folder" and "open this project in your
 * editor" under it puts them exactly where somebody would look for them, one
 * click from anywhere in the app, with nothing to discover and no settings
 * screen to find. They are never conditional, never hidden behind a mode, and
 * never further away than they are right now.
 *
 * The one thing this menu must not become is a preferences window. It holds the
 * things that are true of a project, plus the single switch that changes how the
 * app talks. If a fourth setting ever wants to live here, that is the moment to
 * ask whether it should exist at all.
 */
export default function ProjectMenu({
  projects,
  openPath,
  onOpen,
  onForget,
  onBrowse,
  editor,
  onOpenInEditor,
  onRevealFolder,
  onPreview,
  onAccount,
  onAddMore,
  showMe,
  onShowMe,
  showFiles,
  onShowFiles,
}: Props) {
  return (
    <div className="projectmenu">
      <ProjectPicker
        projects={projects}
        openPath={openPath}
        onOpen={onOpen}
        onForget={onForget}
        onBrowse={onBrowse}
        compact
      />

      {/* Only once there is a folder. An escape hatch out of nowhere leads
          nowhere, and a button that explains why it cannot work is worse than
          no button. */}
      {openPath === null ? null : (
        <div className="projectmenu__hatches">
          <button type="button" className="projectmenu__hatch" onClick={onPreview}>
            Show the preview
          </button>
          {editor === null ? null : (
            <button type="button" className="projectmenu__hatch" onClick={onOpenInEditor}>
              Open in {editor}
            </button>
          )}
          <button type="button" className="projectmenu__hatch" onClick={onRevealFolder}>
            Show the folder
          </button>
          {/* A state rather than a place to go: it stays as it is left, so the
              row says which way it is. */}
          <button
            type="button"
            className="projectmenu__hatch projectmenu__hatch--state"
            aria-pressed={showFiles}
            onClick={() => onShowFiles(!showFiles)}
            title="Everything in this project, beside the conversation"
          >
            Project files
            <span className="projectmenu__mark" aria-hidden="true">
              {showFiles ? (
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none">
                  <path
                    d="m3.5 8.5 3 3 6-7"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
          </button>
        </div>
      )}

      <div className="projectmenu__hatches">
        <button type="button" className="projectmenu__hatch" onClick={onAddMore}>
          Add more to Graphe
        </button>
        <button type="button" className="projectmenu__hatch" onClick={onAccount}>
          Account &amp; model
        </button>
      </div>

      <div className="projectmenu__showme">
        <button
          type="button"
          role="switch"
          aria-checked={showMe}
          className="switch"
          onClick={() => onShowMe(!showMe)}
          id="show-me"
        >
          <span className="switch__track" aria-hidden="true">
            <span className="switch__knob" />
          </span>
          <span className="switch__text">
            <span className="switch__label">{showMeCopy.label}</span>
            <span className="switch__hint">{showMeCopy.hint}</span>
          </span>
        </button>
      </div>
    </div>
  );
}
