/** The local scripted provider used only by the real-window test harness. */

import type { ProviderConfig } from '@earendil-works/pi-coding-agent';

export const SCRIPTED_MODEL_ENV = 'GRAPHE_TEST_MODEL';
export const SCRIPTED_PROVIDER = 'graphe-scripted';
export const SCRIPTED_MODEL_ID = 'scripted';

/**
 * Keep the provider declaration in one place. The in-process runtime and the
 * child runtime must expose the same model, otherwise the child smoke suite
 * can pass the first boot and fail as soon as it tries to open a conversation.
 */
export function scriptedProviderConfig(baseUrl: string): ProviderConfig {
  return {
    name: 'Scripted test model',
    baseUrl,
    api: 'pi-messages' as const,
    apiKey: 'scripted',
    models: [
      {
        id: SCRIPTED_MODEL_ID,
        name: 'Scripted replies',
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        contextWindow: 200_000,
        maxTokens: 8_192,
      },
    ],
  };
}
