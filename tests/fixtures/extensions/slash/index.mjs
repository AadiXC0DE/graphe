/** A command meant for Pi's command context rather than for prose: it waits for
 *  the run in front of it to finish before it starts, and says what it did. */
export default function slash(api) {
  api.registerCommand('tally', {
    description: 'Counts what the conversation has touched so far.',
    handler: async (args, ctx) => {
      await ctx.waitForIdle();
      ctx.ui.notify(args.trim() === '' ? 'tallying everything' : `tallying ${args.trim()}`);
    },
  });
}
