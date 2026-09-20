/** A tool that takes its time, so the folder it came from can be taken away
 *  while it is still running. The call that is already out finishes: removal is
 *  a boundary, not a kill. */
export default function removedMidrun(api) {
  api.registerTool({
    name: 'long_haul',
    label: 'Long haul',
    description: 'Takes about a tenth of a second and says so when it is done.',
    parameters: { type: 'object', properties: {} },
    execute: async () => {
      await new Promise((done) => setTimeout(done, 100));
      return {
        content: [{ type: 'text', text: 'the long haul finished' }],
        details: { note: 'finished after it was removed' },
      };
    },
  });
}
