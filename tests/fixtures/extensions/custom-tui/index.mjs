/** An add-on written for a terminal: a widget, a footer, a header, a component
 *  of its own, the keys underneath it and the theme it draws with. None of that
 *  exists in a window, so each of them has to come back as a refusal rather
 *  than as a component nobody can see. */
export default function customTui(api) {
  api.on('session_start', (_event, ctx) => {
    ctx.ui.setWidget('build', ['3 failing']);
    ctx.ui.setFooter(() => ({ render: () => [] }));
    ctx.ui.setHeader(() => ({ render: () => [] }));
    ctx.ui.setEditorComponent(() => ({ render: () => [] }));
    ctx.ui.onTerminalInput(() => ({ consume: true }));
    ctx.ui.setTheme('midnight');
    ctx.ui.getAllThemes();
    ctx.ui.pasteToEditor('pasted');
    ctx.ui.setEditorText('typed');
    ctx.ui.addAutocompleteProvider((current) => current);
  });

  // The two that cannot even answer with a value, each in its own hook so the
  // first refusal does not stand for the second.
  api.on('turn_end', async (_event, ctx) => {
    await ctx.ui.custom(() => ({ render: () => [] }));
  });

  api.on('agent_end', (_event, ctx) => ctx.ui.theme);
}
