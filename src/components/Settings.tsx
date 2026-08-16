import { useEffect } from 'react';
import './Settings.css';

export type SettingsLink =
  | 'skills'
  | 'add-more'
  | 'usage'
  | 'show-me'
  | 'files'
  | 'folder'
  | 'editor';

type Props = {
  open: boolean;
  onClose: () => void;
  showMe: boolean;
  showFiles: boolean;
  /** Work in a copy and ask before anything lands in the project. */
  holdBack: boolean;
  onToggleShowMe: () => void;
  onToggleShowFiles: () => void;
  onToggleHoldBack: () => void;
  onGo: (link: SettingsLink) => void;
};

/** Each row knows its own kind and its own id, so a switch row and a link row
 *  are told apart by the union, not by a string field that could disagree. */
const LINKS: readonly (
  | { id: SettingsLink; name: string; note: string; kind: 'go' }
  | { id: 'show-me'; name: string; note: string; kind: 'show-me' }
  | { id: 'files'; name: string; note: string; kind: 'files' }
  | { id: 'hold-back'; name: string; note: string; kind: 'hold-back' }
)[] = [
  {
    id: 'skills',
    name: 'Skills',
    note: 'Craft you can call up with @ in a message.',
    kind: 'go',
  },
  {
    id: 'add-more',
    name: 'Add more to Graphe',
    note: 'Give it new things it can do for you.',
    kind: 'go',
  },
  {
    id: 'usage',
    name: 'What this cost',
    note: 'Spend, what was reused from earlier, and the work that needed another try.',
    kind: 'go',
  },
  {
    id: 'show-me',
    name: 'Show me the real thing',
    note: 'Commands, paths and model names under the plain sentences.',
    kind: 'show-me',
  },
  {
    id: 'files',
    name: 'Everything in this project',
    note: 'The folder as a tree you can walk, beside the conversation.',
    kind: 'files',
  },
  {
    id: 'hold-back',
    name: 'Work in a copy first',
    note: 'Changes are made in a copy and shown to you before anything reaches your files. Off, your files change as the work happens and every moment is one press from undone.',
    kind: 'hold-back',
  },
  {
    id: 'folder',
    name: 'Reveal the folder',
    note: 'Open it where this computer keeps files.',
    kind: 'go',
  },
  {
    id: 'editor',
    name: 'Open in your editor',
    note: 'Hand the project to the place you already write code.',
    kind: 'go',
  },
];

/**
 * The quieter controls, in one place.
 *
 * Things somebody reaches for a few times a week, not every message — skills,
 * spend, whether the machinery is named. They used to be buttons competing
 * with the work; here they sit behind one word and leave the shelf alone.
 */
export default function Settings({
  open,
  onClose,
  showMe,
  showFiles,
  holdBack,
  onToggleShowMe,
  onToggleShowFiles,
  onToggleHoldBack,
  onGo,
}: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <section className="settings" aria-label="Settings" role="dialog" aria-modal="true">
      <header className="settings__top">
        <div>
          <p className="settings__eyebrow">Graphe</p>
          <h1>Settings</h1>
          <p>Things you change once in a while, not every message.</p>
        </div>
        <button type="button" className="settings__close" onClick={onClose}>
          Close <kbd>Esc</kbd>
        </button>
      </header>

      <ul className="settings__list">
        {LINKS.map((one) => {
          if (one.kind === 'show-me') {
            return (
              <li key={one.id}>
                <label className="settings__row settings__row--switch">
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={showMe}
                    onChange={onToggleShowMe}
                  />
                </label>
              </li>
            );
          }
          if (one.kind === 'hold-back') {
            return (
              <li key={one.id}>
                <label className="settings__row settings__row--switch">
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={holdBack}
                    onChange={onToggleHoldBack}
                  />
                </label>
              </li>
            );
          }
          if (one.kind === 'files') {
            return (
              <li key={one.id}>
                <label className="settings__row settings__row--switch">
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={showFiles}
                    onChange={onToggleShowFiles}
                  />
                </label>
              </li>
            );
          }
          if (one.kind === 'go') {
            return (
              <li key={one.id}>
                <button
                  type="button"
                  className="settings__row"
                  onClick={() => {
                    onGo(one.id);
                    onClose();
                  }}
                >
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <span className="settings__chev" aria-hidden="true">
                    ›
                  </span>
                </button>
              </li>
            );
          }
          return null;
        })}
      </ul>
    </section>
  );
}
