/** An add-on that brings a model provider with it. Pi's own registry learns it
 *  and can then be asked to think with it; nothing here lists it. */
export default function providers(api) {
  api.registerProvider('cinder', {
    name: 'Cinder',
    baseUrl: 'https://models.invalid/cinder',
    api: 'pi-messages',
    models: [
      {
        id: 'cinder-small',
        name: 'Cinder Small',
        contextWindow: 32_000,
        maxTokens: 4_096,
      },
    ],
  });
}
