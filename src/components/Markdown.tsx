import { useMemo, type ReactNode } from 'react';
import CodeBlock from './CodeBlock';
import {
  decodeEntities,
  languageLabel,
  languageOf,
  parseMarkdown,
  safeHref,
  safeImageSrc,
  type Token,
  type Tokens,
} from '../lib/markdown';
import './Markdown.css';

type Props = {
  /** Markdown source. Half-written is the normal case, not the exception. */
  text: string;
  /** The still-writing mark, put at the end of the last thing said. */
  caret?: ReactNode;
};

/**
 * The agent's words, formatted.
 *
 * Every element on this page is built by hand from Marked's tokens rather than
 * from its HTML output, and that is the security model: there is no HTML string
 * anywhere in the path, so there is nothing to sanitise and nothing that can be
 * missed. A `<script>` in a reply is a `<script>` on the screen — six characters
 * and a word, which is what somebody who typed it meant to show you.
 *
 * It does not animate, in either direction. Formatting appears as the reply
 * arrives, at the moment the syntax that asks for it is complete, and a list
 * that faded in as its second bullet landed would be the typewriter effect
 * wearing a hat.
 */
export default function Markdown({ text, caret }: Props) {
  const blocks = useMemo(() => {
    const tokens = parseMarkdown(text);
    if (tokens === null) return null;
    try {
      return renderBlocks(tokens, caret);
    } catch {
      return null;
    }
  }, [text, caret]);

  /* Whatever went wrong, the words are the point. Plain text with its line
     breaks kept is a worse-looking answer and a perfectly readable one. */
  if (blocks === null) {
    return (
      <p className="md__p md__p--plain">
        {text}
        {caret}
      </p>
    );
  }

  return <>{blocks}</>;
}

/* -------------------------------------------------------------------------- */
/* Blocks                                                                      */
/* -------------------------------------------------------------------------- */

/** Tokens that put nothing on the page, and so cannot be the last thing said. */
function isSilent(token: Token): boolean {
  return token.type === 'space' || token.type === 'def';
}

function renderBlocks(tokens: readonly Token[], tail?: ReactNode): ReactNode[] {
  let last = -1;
  tokens.forEach((token, index) => {
    if (!isSilent(token)) last = index;
  });

  const out: ReactNode[] = [];
  tokens.forEach((token, index) => {
    const node = renderBlock(token, `b${index}`, index === last ? tail : undefined);
    if (node !== null) out.push(node);
  });
  return out;
}

function renderBlock(token: Token, key: string, tail?: ReactNode): ReactNode {
  switch (token.type) {
    case 'space':
    case 'def':
      return null;

    case 'paragraph':
      return (
        <p className="md__p" key={key}>
          {inline(token.tokens, key)}
          {tail}
        </p>
      );

    case 'heading': {
      // Never an h1 or h2: this sits inside a conversation, and a reply that
      // outranks the page it is on makes nonsense of the document outline for
      // anyone reading by headings.
      const depth = Math.min(Math.max(Number(token.depth) || 1, 1) + 2, 6);
      const Tag = `h${depth}` as 'h3' | 'h4' | 'h5' | 'h6';
      return (
        <Tag className="md__heading" key={key}>
          {inline(token.tokens, key)}
          {tail}
        </Tag>
      );
    }

    case 'blockquote':
      return (
        <blockquote className="md__quote" key={key}>
          {renderBlocks(token.tokens ?? [], tail)}
        </blockquote>
      );

    case 'list': {
      const items: readonly Tokens.ListItem[] = (token as Tokens.List).items ?? [];
      const lastItem = items.length - 1;
      const children = items.map((item, index) => (
        <li className={`md__item ${item.task ? 'md__item--task' : ''}`} key={`${key}i${index}`}>
          {item.task ? (
            <span className="md__check" aria-hidden="true">
              {item.checked ? (
                <svg viewBox="0 0 14 14" width="12" height="12" fill="none">
                  <path
                    d="M3 7.4 5.7 10 11 4.4"
                    stroke="currentColor"
                    strokeWidth="1.4"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : null}
            </span>
          ) : null}
          {item.task ? <span className="md__sr">{item.checked ? 'Done: ' : 'To do: '}</span> : null}
          {renderBlocks(item.tokens ?? [], index === lastItem ? tail : undefined)}
        </li>
      ));

      return token.ordered ? (
        <ol
          className="md__list md__list--ordered"
          key={key}
          start={typeof token.start === 'number' ? token.start : undefined}
        >
          {children}
        </ol>
      ) : (
        <ul className="md__list" key={key}>
          {children}
        </ul>
      );
    }

    /* The mark goes inside the block, at the end of the last line of code —
       see the note on CodeBlock's `tail`. */
    case 'code': {
      const language = languageOf(token.lang);
      return (
        <CodeBlock
          key={key}
          code={String(token.text ?? '')}
          language={language}
          label={languageLabel(token.lang)}
          tail={tail}
        />
      );
    }

    case 'table': {
      const table = token as Tokens.Table;
      const align: readonly (string | null)[] = table.align ?? [];
      return (
        <div className="md__tablewrap" key={key}>
          <table className="md__table">
            <thead>
              <tr>
                {(table.header ?? []).map((cell, index) => (
                  <th key={`${key}h${index}`} style={cellAlign(align[index])} scope="col">
                    {inline(cell.tokens, `${key}h${index}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(table.rows ?? []).map((row, rowIndex) => (
                <tr key={`${key}r${rowIndex}`}>
                  {row.map((cell, index) => (
                    <td key={`${key}r${rowIndex}c${index}`} style={cellAlign(align[index])}>
                      {inline(cell.tokens, `${key}r${rowIndex}c${index}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          {tail}
        </div>
      );
    }

    /* No mark after a rule. A rule cannot be half-drawn, so a caret under one
       says only "something is about to appear in this empty space", which is the
       one thing it must never say. The next block brings its own. */
    case 'hr':
      return <hr className="md__rule" key={key} />;

    /* A block of raw HTML. It is shown, not run — see the note at the top. */
    case 'html':
      return (
        <p className="md__p md__p--plain" key={key}>
          {String(token.raw ?? '').replace(/\n+$/, '')}
          {tail}
        </p>
      );

    /* Loose list items and anything else that carries inline children. */
    default: {
      const children = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : null;
      if (children !== null) {
        return (
          <p className="md__p" key={key}>
            {inline(children as readonly Token[], key)}
            {tail}
          </p>
        );
      }
      return (
        <p className="md__p" key={key}>
          {decodeEntities(String(token.raw ?? ''))}
          {tail}
        </p>
      );
    }
  }
}

function cellAlign(align: string | null | undefined) {
  return align === 'center' || align === 'right' || align === 'left'
    ? { textAlign: align as 'center' | 'right' | 'left' }
    : undefined;
}

/* -------------------------------------------------------------------------- */
/* Inline                                                                      */
/* -------------------------------------------------------------------------- */

function inline(tokens: readonly Token[] | undefined, key: string): ReactNode[] {
  if (tokens === undefined) return [];
  return tokens.map((token, index) => renderInline(token, `${key}-${index}`));
}

function renderInline(token: Token, key: string): ReactNode {
  switch (token.type) {
    case 'text':
    case 'escape': {
      const children = 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : null;
      if (children !== null && children.length > 0) {
        return <span key={key}>{inline(children as readonly Token[], key)}</span>;
      }
      return <span key={key}>{decodeEntities(String(token.text ?? ''))}</span>;
    }

    case 'strong':
      return <strong key={key}>{inline(token.tokens, key)}</strong>;

    case 'em':
      return <em key={key}>{inline(token.tokens, key)}</em>;

    case 'del':
      return <del key={key}>{inline(token.tokens, key)}</del>;

    case 'codespan':
      return (
        <code className="md__code" key={key}>
          {decodeEntities(String(token.text ?? ''))}
        </code>
      );

    case 'br':
      return <br key={key} />;

    case 'link': {
      const href = safeHref(token.href);
      const children = inline(token.tokens, key);
      /* A link we will not follow is still a sentence somebody wrote. It stays
         as its own words rather than disappearing, and it stays un-clickable. */
      if (href === null) return <span key={key}>{children}</span>;
      return (
        <a
          className="md__link"
          key={key}
          href={href}
          title={typeof token.title === 'string' ? token.title : undefined}
          /* Out to a browser, never into this window: the conversation is not
             a page the agent gets to navigate away from. */
          target="_blank"
          rel="noreferrer noopener nofollow"
        >
          {children}
        </a>
      );
    }

    case 'image': {
      const src = safeImageSrc(token.href);
      const alt = decodeEntities(String(token.text ?? ''));
      if (src === null) return <span key={key}>{alt}</span>;
      return (
        <img
          className="md__image"
          key={key}
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      );
    }

    /* Raw HTML inside a sentence, shown as the characters it is made of. */
    case 'html':
      return <span key={key}>{String(token.raw ?? '')}</span>;

    default:
      return <span key={key}>{decodeEntities(String(token.raw ?? ''))}</span>;
  }
}
