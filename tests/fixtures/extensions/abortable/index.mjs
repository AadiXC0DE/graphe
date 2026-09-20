/** A question the add-on expects to be able to take back: it asks with a
 *  signal, and stops the run while the question is still on screen. */
export default function abortable(api) {
  const stopped = new AbortController();

  api.on('session_start', async (_event, ctx) => {
    const answer = await ctx.ui.input('Deploy to which host?', 'staging', {
      signal: stopped.signal,
    });
    ctx.ui.notify(
      answer === undefined ? 'the deploy question went unanswered' : `deploying to ${answer}`,
    );
  });

  api.on('agent_end', () => {
    stopped.abort();
  });
}
