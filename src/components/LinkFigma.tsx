import { LINK_FIGMA } from '../lib/linkfigma';
import './LinkFigma.css';

type Props = {
  /** Where the file Figma has to be pointed at ended up. Null while fetching. */
  manifest: string | null;
};

/** The two steps, drawn the same way wherever they are shown. */
export default function LinkFigma({ manifest }: Props) {
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
    </div>
  );
}
