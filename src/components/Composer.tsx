import { useRef, useState, type KeyboardEvent } from 'react';
import './Composer.css';

type Props = {
  onSend: (text: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
  busy?: boolean;
};

export default function Composer({ onSend, placeholder, autoFocus, busy }: Props) {
  const [value, setValue] = useState('');
  const areaRef = useRef<HTMLTextAreaElement>(null);

  const submit = () => {
    const text = value.trim();
    if (!text || busy) return;
    onSend(text);
    setValue('');
    if (areaRef.current) areaRef.current.style.height = 'auto';
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      submit();
    }
  };

  // Grow with content rather than scrolling a fixed box.
  const resize = (el: HTMLTextAreaElement) => {
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  };

  return (
    <div className="composer">
      <textarea
        ref={areaRef}
        className="composer__input"
        value={value}
        rows={1}
        autoFocus={autoFocus}
        placeholder={placeholder ?? 'Describe it, or drop a Figma link or a screenshot'}
        onChange={(e) => {
          setValue(e.target.value);
          resize(e.target);
        }}
        onKeyDown={onKeyDown}
        aria-label="What do you want to make?"
      />
      <div className="composer__row">
        <span className="composer__hint">
          Drop a Figma link, a screenshot, or a photo of a sketch
        </span>
        <button
          className="composer__send"
          onClick={submit}
          disabled={!value.trim() || busy}
          aria-label="Send"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M8 13V3M8 3L3.5 7.5M8 3l4.5 4.5"
              stroke="currentColor"
              strokeWidth="1.6"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
