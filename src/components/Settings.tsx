import { useEffect } from 'react';
import { THEMES, THEME_WORDS, showing, type Theme } from '../lib/theme';
import Switch from './Switch';
import './Settings.css';

export type SettingsLink =
  | 'skills'
  | 'connected'
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
  /** Check new work before it lands, rather than as it happens. */
  holdBack: boolean;
  /** The browser this project drives keeps what it is signed in to. */
  keepLogins: boolean;
  /** Which palette somebody has chosen, or to follow the computer. */
  theme: Theme;
  onTheme: (theme: Theme) => void;
  onToggleShowMe: () => void;
  onToggleShowFiles: () => void;
  onToggleHoldBack: () => void;
  onToggleKeepLogins: () => void;
  onGo: (link: SettingsLink) => void;
};

/** Each row knows its own kind and its own id, so a switch row and a link row
 *  are told apart by the union, not by a string field that could disagree. */
const LINKS: readonly (
  | { id: SettingsLink; name: string; note: string; kind: 'go' }
  | { id: 'show-me'; name: string; note: string; kind: 'show-me' }
  | { id: 'files'; name: string; note: string; kind: 'files' }
  | { id: 'hold-back'; name: string; note: string; kind: 'hold-back' }
  | { id: 'keep-logins'; name: string; note: string; kind: 'keep-logins' }
  | { id: 'theme'; name: string; note: string; kind: 'theme' }
)[] = [
  {
    id: 'skills',
    name: 'Skills',
    note: 'Craft you can call up with @ in a message.',
    kind: 'go',
  },
  {
    id: 'connected',
    name: 'Other tools',
    note: 'The design files, databases and services this project can reach.',
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
    name: 'Check new work first',
    note: 'Where there is something to look at, changes are made in a copy and shown to you before anything reaches your files. Everywhere else a save point goes down before the work starts. Off, your files change as the work happens and every moment is one press from undone.',
    kind: 'hold-back',
  },
  {
    id: 'keep-logins',
    name: 'Stay signed in while I browse',
    note: 'The browser I open pages in keeps what it is signed in to, so a site you sign into once stays signed in for this project. Off, every page opens in a browser that has never been anywhere. Turning it off again forgets what was kept.',
    kind: 'keep-logins',
  },
  {
    id: 'theme',
    name: THEME_WORDS.name,
    note: THEME_WORDS.note,
    kind: 'theme',
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
  theme,
  onTheme,
  onToggleShowMe,
  onToggleShowFiles,
  onToggleHoldBack,
  keepLogins,
  onToggleKeepLogins,
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

  /* Following the computer still lands somewhere; this is where. Read at the
     render of the sheet — it is open for seconds, not for ever. */
  const onScreen = showing('system', window.matchMedia('(prefers-color-scheme: dark)').matches);
  const onScreenName = onScreen === 'dark' ? THEME_WORDS.graphe : THEME_WORDS[onScreen];

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
                  <Switch on={showMe} onChange={onToggleShowMe} label={one.name} />
                </label>
              </li>
            );
          }
          if (one.kind === 'keep-logins') {
            return (
              <li key={one.id}>
                <label className="settings__row settings__row--switch">
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <Switch on={keepLogins} onChange={onToggleKeepLogins} label={one.name} />
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
                  <Switch on={holdBack} onChange={onToggleHoldBack} label={one.name} />
                </label>
              </li>
            );
          }
          if (one.kind === 'theme') {
            return (
              <li key={one.id}>
                <div className="settings__row settings__row--theme">
                  <span className="settings__text">
                    <span className="settings__name">{one.name}</span>
                    <span className="settings__note">{one.note}</span>
                  </span>
                  <div className="settings__theme-wrap">
                    <span className="settings__themes" role="group" aria-label={one.name}>
                      {THEMES.map((pick) => (
                        <button
                          key={pick.id}
                          type="button"
                          className={`settings__theme ${theme === pick.id ? 'settings__theme--on' : ''}`}
                          aria-pressed={theme === pick.id}
                          onClick={() => onTheme(pick.id)}
                          title={pick.label}
                        >
                          <span
                            className="settings__thumb"
                            aria-hidden="true"
                            style={
                              {
                                background: pick.preview.bg,
                                borderColor: pick.preview.border,
                                ['--thumb-accent' as string]: pick.preview.accent,
                                ['--thumb-text' as string]: pick.preview.text,
                              } as React.CSSProperties
                            }
                          >
                            <span className="settings__thumb-raised" style={{ background: pick.preview.raised, borderColor: pick.preview.border }} />
                            <span className="settings__thumb-dot" style={{ background: pick.preview.accent }} />
                            <span className="settings__thumb-line" style={{ background: pick.preview.text }} />
                            <span className="settings__thumb-line settings__thumb-line--muted" style={{ background: pick.preview.text }} />
                          </span>
                          <span className="settings__theme-label">{pick.label}</span>
                        </button>
                      ))}
                    </span>
                    <button
                      type="button"
                      className={`settings__system ${theme === 'system' ? 'settings__system--on' : ''}`}
                      aria-pressed={theme === 'system'}
                      onClick={() => onTheme('system')}
                    >
                      {THEME_WORDS.system}
                    </button>
                    {theme === 'system' ? (
                      /* Saying which palette the computer picked spares the
                         reader five thumbnails and a guess about what they
                         are actually looking at. */
                      <p className="settings__system-note">{onScreenName} right now.</p>
                    ) : null}
                  </div>
                </div>
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
                  <Switch on={showFiles} onChange={onToggleShowFiles} label={one.name} />
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
