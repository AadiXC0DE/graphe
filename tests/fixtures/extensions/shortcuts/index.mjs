/** The two shortcut cases the plan asks to be detected: the same key claimed
 *  twice, and one key Pi keeps for its own navigation. */
export default function shortcuts(api) {
  api.registerShortcut('ctrl+k', {
    description: 'Show the ledger',
    handler: () => undefined,
  });
  api.registerShortcut('ctrl+k', {
    description: 'Show the calendar',
    handler: () => undefined,
  });
  api.registerShortcut('app.model.select', {
    description: 'Pick a model',
    handler: () => undefined,
  });
}
