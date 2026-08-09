import { useState } from 'react';
import Composer from './components/Composer';
import './App.css';

export default function App() {
  const [messages, setMessages] = useState<{ id: number; from: 'you' | 'graphe'; text: string }[]>(
    [],
  );

  const send = (text: string) => {
    setMessages((m) => [...m, { id: Date.now(), from: 'you', text }]);
  };

  // The first screen is a single centred conversation. Nothing else.
  // Regions appear the first time they have something to say — see docs/UI-DESIGN.md.
  const empty = messages.length === 0;

  return (
    <main className={`app ${empty ? 'app--empty' : ''}`}>
      <div className="app__column">
        {empty ? (
          <div className="welcome">
            <h1 className="welcome__title">What do you want to make?</h1>
            <p className="welcome__sub">
              Start with a Figma file, a sketch, or just a sentence.
            </p>
          </div>
        ) : (
          <div className="thread">
            {messages.map((m) => (
              <div key={m.id} className={`msg msg--${m.from}`}>
                <div className="msg__who">{m.from === 'you' ? 'You' : 'Graphe'}</div>
                <div className="msg__body">{m.text}</div>
              </div>
            ))}
          </div>
        )}

        <Composer onSend={send} autoFocus />
      </div>
    </main>
  );
}
