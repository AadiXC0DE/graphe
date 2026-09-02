/** The microphone works, or it is not there.
 *
 * The constructor exists in every Chromium, and inside this app the recognition
 * behind it needs a speech service the app does not ship — so the button
 * appeared for everybody, asked for the microphone, and failed with `network` a
 * moment later. That is a broken promise, and worse than no button.
 */

import { describe, expect, it } from 'vitest';

import {
  LISTENING_ANSWER,
  probeListening,
  rememberedListening,
  wordsFor,
} from '../src/lib/saying';

type Handlers = {
  onstart?: (() => void) | null;
  onerror?: ((event: { error?: string }) => void) | null;
};

/** A recogniser that behaves however the test says, and records being stopped. */
function ears(how: 'starts' | 'network' | 'refused' | 'silent' | 'throws') {
  const stopped: string[] = [];
  class Fake {
    lang = '';
    continuous = false;
    interimResults = false;
    onresult: unknown = null;
    onerror: Handlers['onerror'] = null;
    onend: (() => void) | null = null;
    onstart: Handlers['onstart'] = null;
    start(): void {
      if (how === 'throws') throw new Error('no');
      if (how === 'starts') queueMicrotask(() => this.onstart?.());
      if (how === 'network') queueMicrotask(() => this.onerror?.({ error: 'network' }));
      if (how === 'refused') queueMicrotask(() => this.onerror?.({ error: 'not-allowed' }));
      // 'silent' says nothing at all, which is its own answer.
    }
    stop(): void {
      stopped.push('stop');
    }
    abort(): void {
      stopped.push('abort');
    }
  }
  return { scope: { SpeechRecognition: Fake }, stopped };
}

describe('asking the machine rather than asking whether the name exists', () => {
  it('says yes when recognition actually starts', async () => {
    const fake = ears('starts');
    await expect(probeListening(fake.scope, 50)).resolves.toBe(true);
  });

  /* The failure this exists for: the constructor is there, and the service
     behind it is not. */
  it('says no when it starts and immediately cannot reach its service', async () => {
    await expect(probeListening(ears('network').scope, 50)).resolves.toBe(false);
  });

  /* Somebody saying no to the microphone is an answer about this moment, not
     about this machine — the button stays. */
  it('says yes when the person simply has not allowed the microphone', async () => {
    await expect(probeListening(ears('refused').scope, 50)).resolves.toBe(true);
  });

  it('says no to a recogniser that neither starts nor complains', async () => {
    await expect(probeListening(ears('silent').scope, 30)).resolves.toBe(false);
  });

  it('says no rather than throwing when the constructor does', async () => {
    await expect(probeListening(ears('throws').scope, 50)).resolves.toBe(false);
  });

  it('says no where there is no recogniser at all', async () => {
    await expect(probeListening({}, 50)).resolves.toBe(false);
    await expect(probeListening(null, 50)).resolves.toBe(false);
  });

  it('never leaves a recogniser running behind it', async () => {
    for (const how of ['starts', 'network', 'silent'] as const) {
      const fake = ears(how);
      await probeListening(fake.scope, 30);
      expect(fake.stopped).toContain('abort');
    }
  });
});

describe('what was remembered', () => {
  it('reads a yes, a no, and nobody having asked', () => {
    expect(rememberedListening(() => 'yes')).toBe(true);
    expect(rememberedListening(() => 'no')).toBe(false);
    expect(rememberedListening(() => null)).toBeNull();
    expect(rememberedListening(() => 'nonsense')).toBeNull();
  });

  it('is filed under a name the window can find it by', () => {
    expect(LISTENING_ANSWER).toContain('graphe');
  });
});

describe('what a failure means for the button', () => {
  it('takes the button away for the failures that will happen again', () => {
    expect(wordsFor('network').keepOffering).toBe(false);
    expect(wordsFor('service-not-allowed').keepOffering).toBe(false);
  });

  it('leaves it for the ones that are about this moment', () => {
    for (const one of ['no-speech', 'not-allowed', 'audio-capture', 'aborted']) {
      expect(wordsFor(one).keepOffering).toBe(true);
    }
  });
});
