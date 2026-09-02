import { useEffect, useState } from 'react';

import { bridge } from '../lib/bridge';
import { LINK_FIGMA } from '../lib/linkfigma';
import './LinkFigma.css';

type Props = {
  /** Where the file Figma has to be pointed at ended up. Null while fetching. */
  manifest: string | null;
};

/** The token half, said plainly. It used to be read from the environment and
 *  nowhere else, so pasting a Figma link worked for somebody who started the
 *  app from a terminal and for nobody else. */
export const FIGMA_TOKEN_WORDS = {
  title: 'Or paste a Figma access token',
  note: 'Kept in this Mac’s login keychain, never in a file. Figma makes one under Settings → Security → Personal access tokens.',
  field: 'Figma access token',
  keep: 'Keep it',
  keeping: 'Keeping…',
  kept: 'Kept. Paste a Figma link and I will read it.',
  cannot: 'This Mac will not let me keep a credential, so set FIGMA_TOKEN in your environment instead.',
  held: 'A token is kept for Figma.',
} as const;

/** The two steps, drawn the same way wherever they are shown. */
export default function LinkFigma({ manifest }: Props) {
  const [token, setToken] = useState('');
  const [keeping, setKeeping] = useState(false);
  const [said, setSaid] = useState<string | null>(null);
  const [canKeep, setCanKeep] = useState<boolean | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    void bridge.credentialsKept().then((answer) => {
      if (!answer.ok) return;
      setCanKeep(answer.value.canKeep);
      setHeld(answer.value.held.includes('figma'));
    });
  }, []);

  const keep = (): void => {
    if (token.trim() === '') return;
    setKeeping(true);
    void bridge.keepCredential('figma', token.trim()).then((answer) => {
      setKeeping(false);
      if (!answer.ok) {
        setSaid(FIGMA_TOKEN_WORDS.cannot);
        return;
      }
      if (!answer.value.ok) {
        setSaid(answer.value.why ?? FIGMA_TOKEN_WORDS.cannot);
        return;
      }
      // Never held in the box afterwards: a credential on screen is a
      // credential in a screenshot.
      setToken('');
      setHeld(true);
      setSaid(FIGMA_TOKEN_WORDS.kept);
    });
  };

  return (
    <div className="letin">
      <p className="letin__title">{LINK_FIGMA.title}</p>
      <ol className="letin__steps">
        {LINK_FIGMA.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>
      {manifest === null ? null : (
        <p className="letin__where">
          {LINK_FIGMA.where} <code>{manifest}</code>
        </p>
      )}
      <p className="letin__after">{LINK_FIGMA.after}</p>

      {canKeep === false ? (
        <p className="letin__after">{FIGMA_TOKEN_WORDS.cannot}</p>
      ) : (
        <div className="letin__token">
          <p className="letin__title">{FIGMA_TOKEN_WORDS.title}</p>
          <p className="letin__after">{FIGMA_TOKEN_WORDS.note}</p>
          <div className="letin__tokenrow">
            <input
              type="password"
              className="letin__field"
              aria-label={FIGMA_TOKEN_WORDS.field}
              placeholder={held ? FIGMA_TOKEN_WORDS.held : FIGMA_TOKEN_WORDS.field}
              value={token}
              onChange={(event) => setToken(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') keep();
              }}
            />
            <button
              type="button"
              className="letin__keep"
              onClick={keep}
              disabled={keeping || token.trim() === ''}
            >
              {keeping ? FIGMA_TOKEN_WORDS.keeping : FIGMA_TOKEN_WORDS.keep}
            </button>
          </div>
          {said === null ? null : <p className="letin__after">{said}</p>}
        </div>
      )}
    </div>
  );
}
