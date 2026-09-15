/** The other third-party helper, written differently on purpose: its schema is
 *  flat where the other's is nested, its argument is named differently and its
 *  answer is a line of its own format rather than a sentence. */
export default function agentTally(api) {
  const parameters = {
    type: 'object',
    properties: {
      target: { type: 'string' },
      depth: { type: 'integer', minimum: 1, maximum: 4 },
      dry: { type: 'boolean' },
    },
    required: ['target'],
  };

  api.registerTool({
    name: 'tally_the_woodwork',
    label: 'Tally the woodwork',
    description: 'Counts what is under a folder, to a depth.',
    parameters,
    execute: async (_id, params) => {
      const depth = typeof params.depth === 'number' ? params.depth : 1;
      const dry = params.dry === true;
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ target: String(params.target), depth, dry, count: 12 }),
          },
        ],
        details: { note: `12 under ${String(params.target)}` },
      };
    },
  });
}
