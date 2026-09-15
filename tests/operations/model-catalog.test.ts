/** Which model a conversation is actually thinking with.
 *
 * 9.5 asks that the real provider/model identity is what is persisted, and that
 * an unavailable model asks for a replacement rather than quietly billing
 * another provider. The half of that which is a pure decision is here: the
 * model in front is looked up by provider *and* id, never by id alone, and a
 * model the catalogue does not describe is a question rather than a no.
 *
 * The substitution itself is not in this file, because it is not in a pure
 * function: `chooseAModelIfNoneIs` (electron/main.ts:7501) writes a different
 * provider's model into preferences when the stored choice stops being usable,
 * and `createSession` (src/agent/pi/adapter.ts:2632) passes a stale choice to Pi
 * as no model at all, so Pi answers with whichever model the account makes
 * available. Both need Electron or a live Pi runtime to run, so neither is
 * covered here — see the report beside this suite.
 */

import { describe, expect, it } from 'vitest';

import { modelInFront, readsPictures, type ModelReading } from '../../src/lib/attachments';
import { modelKey, type ModelChoice } from '../../src/lib/ipc';
import { byTier, tierOf } from '../../src/lib/modeltiers';

function connection(over: Partial<ModelReading> = {}): ModelReading {
  return {
    chosen: { providerId: 'anthropic', modelId: 'claude-one' },
    providers: [
      {
        providerId: 'anthropic',
        models: [
          { id: 'claude-one', label: 'Claude One', takesImages: true },
          { id: 'claude-two', label: 'Claude Two', takesImages: null },
        ],
      },
      { providerId: 'openai', models: [{ id: 'gpt-one', label: 'GPT One', takesImages: false }] },
    ],
    ...over,
  };
}

/* ========================================================================== */

describe('the identity that is written down', () => {
  it('is the provider and the model together, in one key', () => {
    const choice: ModelChoice = { providerId: 'anthropic', modelId: 'claude-one' };
    expect(modelKey(choice)).toBe('anthropic/claude-one');
    // Two providers can both ship a model with the same id; the preference
    // must not treat them as the same thing.
    expect(modelKey({ providerId: 'openai', modelId: 'claude-one' })).not.toBe(modelKey(choice));
  });

  it('survives being written and read back', () => {
    const choice: ModelChoice = { providerId: 'google-vertex', modelId: 'gemini-x' };
    expect(JSON.parse(JSON.stringify(choice))).toEqual(choice);
  });
});

describe('the model in front', () => {
  it('is the chosen one, not one that happens to share its id', () => {
    expect(modelInFront(connection())?.id).toBe('claude-one');

    // The same id under another provider is a different model, and picking it
    // would be billing somebody else for the answer.
    const elsewhere: ModelReading = {
      chosen: { providerId: 'anthropic', modelId: 'gpt-one' },
      providers: connection().providers,
    };
    expect(modelInFront(elsewhere)).toBeNull();
  });

  it('is nothing at all when the catalogue no longer lists it', () => {
    const gone: ModelReading = {
      chosen: { providerId: 'anthropic', modelId: 'claude-nine' },
      providers: connection().providers,
    };
    expect(modelInFront(gone)).toBeNull();
    expect(modelInFront({ chosen: null, providers: [] })).toBeNull();
    expect(modelInFront(null)).toBeNull();
  });

  it('is a question, not a no, when the entry says nothing about pictures', () => {
    expect(readsPictures(connection())).toBe(true);
    expect(
      readsPictures({ chosen: { providerId: 'anthropic', modelId: 'claude-two' }, providers: connection().providers }),
    ).toBeNull();
    expect(
      readsPictures({ chosen: { providerId: 'openai', modelId: 'gpt-one' }, providers: connection().providers }),
    ).toBe(false);
  });
});

describe('the price tiers', () => {
  it('group models by what they cost, and never mix an unpriced one in', () => {
    const priced = { rates: { input: 1, output: 1 } };
    const dear = { rates: { input: 40, output: 60 } };
    const unknown = { rates: null };

    expect(tierOf(priced)).toBe('fast');
    expect(tierOf(dear)).toBe('best');
    expect(tierOf(unknown)).toBeNull();
    // One unpriced model is enough to say the list cannot be sorted by price.
    expect(byTier([priced, dear, unknown])).toBeNull();
  });
});
