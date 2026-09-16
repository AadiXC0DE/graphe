/** Everything an add-on says without asking anything: three severities, a
 *  status line, and the working message. One of them wants the line cleared
 *  again, which is the same key it set. */
export default function notices(api) {
  api.on('session_start', (_event, ctx) => {
    ctx.ui.notify('The button row is re-drawn.');
    ctx.ui.notify('Two pages are missing a heading.', 'warning');
    ctx.ui.notify('The build file would not parse.', 'error');
    ctx.ui.setStatus('tidy', '3 pages to tidy');
    ctx.ui.setStatus('tidy', undefined);
    ctx.ui.setWorkingMessage('tidying the pages');
    ctx.ui.setWorkingVisible(false);
    ctx.ui.setTitle('tidy up');
  });
}
