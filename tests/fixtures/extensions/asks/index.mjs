/** An add-on that asks the person the four things Pi lets it ask, and says out
 *  loud what it got back — including the times nobody answered. */
export default function asks(api) {
  api.registerCommand('ask-four', {
    description: 'Asks the four questions and says what came back.',
    handler: async (_args, ctx) => {
      const chosen = await ctx.ui.select('Which file should I change?', ['hero.css', 'nav.css']);
      ctx.ui.notify(chosen === undefined ? 'the file question went unanswered' : `chosen ${chosen}`);

      const yes = await ctx.ui.confirm('Overwrite it?', 'There is already a file there.');
      ctx.ui.notify(yes ? 'overwriting it' : 'left alone');

      const typed = await ctx.ui.input('What should it say?', 'a heading');
      ctx.ui.notify(typed === undefined ? 'nothing was typed' : `typed ${typed}`);

      const written = await ctx.ui.editor('Rewrite the paragraph', 'The old one.');
      ctx.ui.notify(written === undefined ? 'the editor was closed' : `edited to ${written}`);
    },
  });
}
