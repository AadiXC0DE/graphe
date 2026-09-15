/** Work that outlives the call that started it: the tool returns at once, and
 *  the add-on delivers the result of its own work when that work finishes. */
export default function asyncResults(api) {
  api.registerTool({
    name: 'start_the_crawl',
    label: 'Start the crawl',
    description: 'Starts the crawl in the background and reports when it finishes.',
    parameters: {
      type: 'object',
      properties: { pages: { type: 'number' } },
      required: ['pages'],
    },
    execute: async (_id, params) => ({
      content: [{ type: 'text', text: `${String(params.pages)} pages queued` }],
    }),
  });

  api.on('agent_end', async () => {
    await new Promise((done) => setTimeout(done, 40));
    api.sendMessage(
      {
        customType: 'crawl-result',
        content: [{ type: 'text', text: 'the crawl finished: 3 pages, none broken' }],
        display: true,
      },
      { triggerTurn: true },
    );
  });
}
