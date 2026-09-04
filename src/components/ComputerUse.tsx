import { useEffect, useState, type ReactNode } from 'react';
import Switch from './Switch';
import type { ComputerStatus } from '../lib/ipc';
import {
  MOST_ALLOWED_APPS,
  MOST_BROWSER_SITES,
  allowApp,
  computerWords,
  forgetApp,
  holdSite,
  releaseSite,
  type ComputerUse,
} from '../work/computeruse';
import './ComputerUse.css';

type Props = {
  use: ComputerUse;
  onChange: (next: ComputerUse) => void;
  /** What this Mac reports, or null before it has been asked. */
  status?: ComputerStatus | null;
  onRefreshStatus?: () => void;
  onOpenSettings?: (which: 'see' | 'point') => void;
};

function AnyAppIcon(): ReactNode {
  return (
    <span className="computer__icon computer__icon--any" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="2" y="2" width="8" height="8" rx="2.5" fill="currentColor" opacity="0.95" />
        <rect x="12" y="2" width="8" height="8" rx="4" fill="currentColor" opacity="0.6" />
        <rect x="2" y="12" width="8" height="8" rx="4" fill="currentColor" opacity="0.6" />
        <rect x="12" y="12" width="8" height="8" rx="2.5" fill="currentColor" opacity="0.95" />
      </svg>
    </span>
  );
}

function BrowserIcon(): ReactNode {
  return (
    <span className="computer__icon computer__icon--browser" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <circle cx="11" cy="11" r="8" />
        <path d="M3 11h16M11 3c2.5 2.2 3.8 5 3.8 8S13.5 16.8 11 19c-2.5-2.2-3.8-5-3.8-8S8.5 5.2 11 3Z" />
      </svg>
    </span>
  );
}

function ExcelIcon(): ReactNode {
  return (
    <span className="computer__icon computer__icon--excel" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22">
        <rect x="2" y="2" width="18" height="18" rx="4" fill="currentColor" opacity="0.9" />
        <path d="M7 7l8 8M15 7l-8 8" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
      </svg>
    </span>
  );
}

function LockIcon(): ReactNode {
  return (
    <span className="computer__icon computer__icon--lock" aria-hidden="true">
      <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="5" y="10" width="12" height="8" rx="2" />
        <path d="M7.5 10V7.5a3.5 3.5 0 0 1 7 0V10" />
      </svg>
    </span>
  );
}

/**
 * Computer use, drawn the way Codex draws it: what Graphe may work, and which
 * apps skip the question.
 *
 * One panel rather than six scattered rows, because these switches only make
 * sense beside each other: the master that enables the rest, the rows it
 * enables, and the list it lets skip the question. The refusals are named
 * under the list they cannot cross, so nobody learns them by pressing.
 */
export default function ComputerUse({ use, onChange, status = null, onRefreshStatus, onOpenSettings }: Props) {
  const [app, setApp] = useState('');
  const [site, setSite] = useState('');
  const [learnMore, setLearnMore] = useState(false);
  const [managing, setManaging] = useState(true);

  useEffect(() => {
    onRefreshStatus?.();
  }, [onRefreshStatus]);

  const flip = (row: 'anyApp' | 'browser' | 'excel' | 'lockedUse', on: boolean): void => {
    onChange({ ...use, [row]: on });
  };

  const addApp = (): void => {
    const next = allowApp(use, app);
    if (next !== use) {
      onChange(next);
      setApp('');
    }
  };

  const addSite = (): void => {
    const next = holdSite(use, site);
    if (next !== use) {
      onChange(next);
      setSite('');
    }
  };

  const excelMeta =
    status === null || status === undefined
      ? ''
      : status.excelInstalled
        ? ''
        : 'Not installed here';

  return (
    <div className="computer">
      <h3 className="settings__subtitle">{computerWords.control}</h3>
      <div className="settings__group">
        <ul className="settings__rows">
          <li>
            <div className="settings__row">
              <AnyAppIcon />
              <span className="settings__text">
                <span className="settings__name">{computerWords.anyAppName}</span>
                <span className="settings__note">{computerWords.anyAppNote}</span>
              </span>
              {use.anyApp ? (
                <Switch on label={computerWords.anyAppName} onChange={(on) => flip('anyApp', on)} />
              ) : (
                <button type="button" className="computer__install" onClick={() => flip('anyApp', true)}>
                  {computerWords.install}
                </button>
              )}
            </div>
          </li>
          <li>
            <div className="settings__row">
              <BrowserIcon />
              <span className="settings__text">
                <span className="settings__name">{computerWords.browserName}</span>
                <span className="settings__note">{computerWords.browserNote}</span>
              </span>
              {use.browser ? (
                <button type="button" className="computer__install" onClick={() => setManaging((was) => !was)}>
                  {computerWords.browserManage}
                </button>
              ) : (
                <button type="button" className="computer__install" onClick={() => flip('browser', true)}>
                  {computerWords.enable}
                </button>
              )}
              <Switch on={use.browser} label={computerWords.browserName} onChange={(on) => flip('browser', on)} />
            </div>
          </li>
          <li>
            <div className="settings__row">
              <ExcelIcon />
              <span className="settings__text">
                <span className="settings__name">{computerWords.excelName}</span>
                <span className="settings__note">{computerWords.excelNote}</span>
              </span>
              {excelMeta === '' ? null : <span className="settings__meta">{excelMeta}</span>}
              <Switch on={use.excel} label={computerWords.excelName} onChange={(on) => flip('excel', on)} />
            </div>
          </li>
        </ul>
      </div>

      {use.anyApp && onOpenSettings !== undefined ? (
        <p className="computer__perms">
          macOS still asks twice, once to see and once to point.{' '}
          <button type="button" className="settings__inline" onClick={() => onOpenSettings('see')}>
            Seeing
          </button>{' '}
          <button type="button" className="settings__inline" onClick={() => onOpenSettings('point')}>
            Pointing
          </button>
        </p>
      ) : null}

      <div className="settings__group">
        <ul className="settings__rows">
          <li>
            <div className="settings__row">
              <LockIcon />
              <span className="settings__text">
                <span className="settings__name">{computerWords.lockedTitle}</span>
                <span className="settings__note">{computerWords.lockedNote}</span>
                {learnMore ? <span className="settings__note">{computerWords.lockedLearn}</span> : null}
                <button type="button" className="settings__inline" onClick={() => setLearnMore((was) => !was)}>
                  Learn more
                </button>
              </span>
              <Switch on={use.lockedUse} label={computerWords.lockedTitle} onChange={(on) => flip('lockedUse', on)} />
            </div>
          </li>
        </ul>
      </div>

      <h3 className="settings__subtitle settings__name">{computerWords.alwaysTitle}</h3>
      <p className="settings__pagenote">{computerWords.alwaysNote}</p>
      <div className="settings__group">
        {use.allowedApps.length === 0 ? (
          <p className="computer__empty">{computerWords.alwaysEmpty}</p>
        ) : (
          <ul className="settings__rows">
            {use.allowedApps.map((name) => (
              <li key={name}>
                <div className="settings__row">
                  <span className="settings__text">
                    <span className="settings__name">{name}</span>
                  </span>
                  <button
                    type="button"
                    className="computer__install"
                    aria-label={`Remove ${name}`}
                    onClick={() => onChange(forgetApp(use, name))}
                  >
                    {computerWords.remove}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      {use.allowedApps.length >= MOST_ALLOWED_APPS ? (
        <p className="settings__machine">The list is full. Take one off to add another.</p>
      ) : (
        <div className="computer__add">
          <input
            type="text"
            className="settings__field"
            aria-label={computerWords.alwaysTitle}
            placeholder={computerWords.appHint}
            value={app}
            onChange={(event) => setApp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addApp();
            }}
          />
          <button type="button" className="computer__install" disabled={app.trim() === ''} onClick={addApp}>
            {computerWords.add}
          </button>
        </div>
      )}

      {managing || use.browserSites.length > 0 ? (
        <>
          <h3 className="settings__subtitle settings__name">{computerWords.sitesTitle}</h3>
          <p className="settings__pagenote">{computerWords.sitesNote}</p>
          <div className="settings__group">
            {use.browserSites.length === 0 ? (
              <p className="computer__empty">{computerWords.sitesEmpty}</p>
            ) : (
              <ul className="settings__rows">
                {use.browserSites.map((held) => (
                  <li key={held}>
                    <div className="settings__row">
                      <span className="settings__text">
                        <span className="settings__name">{held}</span>
                      </span>
                      <button
                        type="button"
                        className="computer__install"
                        aria-label={`Release ${held}`}
                        onClick={() => onChange(releaseSite(use, held))}
                      >
                        {computerWords.remove}
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {use.browserSites.length >= MOST_BROWSER_SITES ? (
            <p className="settings__machine">The list is full. Release one to hold another.</p>
          ) : (
            <div className="computer__add">
              <input
                type="text"
                className="settings__field"
                aria-label={computerWords.sitesTitle}
                placeholder={computerWords.siteHint}
                value={site}
                onChange={(event) => setSite(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') addSite();
                }}
              />
              <button type="button" className="computer__install" disabled={site.trim() === ''} onClick={addSite}>
                {computerWords.add}
              </button>
            </div>
          )}
          <p className="settings__machine">
            Held to named sites, the browser starts clean every time, so staying signed in and holding sites cannot both be had.
          </p>
        </>
      ) : null}
    </div>
  );
}
