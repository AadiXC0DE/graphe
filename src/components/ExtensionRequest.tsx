import { useState } from 'react';

import type { ExtensionAnswer, ExtensionRequest } from '../lib/ipc';
import './ExtensionRequest.css';

type Props = {
  /** What an add-on asked. Null draws nothing. */
  request: ExtensionRequest | null;
  onAnswer: (answer: ExtensionAnswer) => void;
};

export const SAYS = {
  from: 'An add-on is asking',
  cancel: 'Cancel',
  confirm: 'Yes',
  decline: 'No',
  send: 'Send',
} as const;

/**
 * A question an add-on asked, put where the person can answer it.
 *
 * Pi's default interface answers every one of these on its own — it selects
 * nothing, declines, and reports nothing — so before this existed an installed
 * add-on carried on with an answer nobody gave while the person never saw the
 * question. Every one of these has a way out that says "nobody answered",
 * which is a different thing from "no".
 */
export default function ExtensionRequest({ request, onAnswer }: Props) {
  const [typed, setTyped] = useState('');

  if (request === null) return null;

  const cancel = (): void => {
    if (request.kind === 'confirm') onAnswer({ kind: 'confirm', value: false });
    else if (request.kind === 'select') onAnswer({ kind: 'select', value: null });
    else if (request.kind === 'editor') onAnswer({ kind: 'editor', value: null });
    else onAnswer({ kind: 'input', value: null });
  };

  return (
    <section className="addonask" role="group" aria-label={SAYS.from}>
      <p className="addonask__from">{SAYS.from}</p>
      <h2 className="addonask__title">{request.title}</h2>
      {request.kind === 'confirm' ? <p className="addonask__body">{request.message}</p> : null}

      {request.kind === 'select' ? (
        <ul className="addonask__choices">
          {request.options.map((one) => (
            <li key={one.value}>
              <button
                type="button"
                className="addonask__choice"
                onClick={() => onAnswer({ kind: 'select', value: one.value })}
              >
                {one.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {request.kind === 'input' ? (
        <input
          className="addonask__field"
          type="text"
          value={typed}
          placeholder={request.placeholder ?? ''}
          aria-label={request.title}
          onChange={(event) => setTyped(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return;
            event.preventDefault();
            onAnswer({ kind: 'input', value: typed });
          }}
        />
      ) : null}

      {request.kind === 'editor' ? (
        <textarea
          className="addonask__editor"
          value={typed === '' ? request.prefill : typed}
          aria-label={request.title}
          rows={6}
          onChange={(event) => setTyped(event.target.value)}
        />
      ) : null}

      <div className="addonask__actions">
        <button type="button" className="addonask__button addonask__button--keep" onClick={cancel}>
          {request.kind === 'confirm' ? SAYS.decline : SAYS.cancel}
        </button>
        {request.kind === 'confirm' ? (
          <button
            type="button"
            className="addonask__button addonask__button--go"
            onClick={() => onAnswer({ kind: 'confirm', value: true })}
          >
            {SAYS.confirm}
          </button>
        ) : null}
        {request.kind === 'input' ? (
          <button
            type="button"
            className="addonask__button addonask__button--go"
            onClick={() => onAnswer({ kind: 'input', value: typed })}
          >
            {SAYS.send}
          </button>
        ) : null}
        {request.kind === 'editor' ? (
          <button
            type="button"
            className="addonask__button addonask__button--go"
            onClick={() =>
              onAnswer({ kind: 'editor', value: typed === '' ? request.prefill : typed })
            }
          >
            {SAYS.send}
          </button>
        ) : null}
      </div>
    </section>
  );
}
