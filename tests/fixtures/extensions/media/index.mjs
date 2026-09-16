/** A tool that answers with a picture as well as words, and one that hands back
 *  a file. The picture is something a window can draw; the file is not. */
const PIXEL =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

export default function media(api) {
  api.registerTool({
    name: 'shoot_the_page',
    label: 'Shoot the page',
    description: 'Takes a picture of the page as it stands.',
    parameters: { type: 'object', properties: { page: { type: 'string' } } },
    execute: async () => ({
      content: [
        { type: 'image', data: PIXEL, mimeType: 'image/png' },
        { type: 'text', text: 'the page as it stands' },
      ],
      details: { note: '1 picture' },
    }),
  });

  api.registerTool({
    name: 'hand_back_the_log',
    label: 'Hand back the log',
    description: 'Hands back the build log as a file.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      content: [
        {
          type: 'resource',
          resource: { uri: 'file:///tmp/build.log', name: 'build.log', mimeType: 'text/plain' },
        },
      ],
    }),
  });
}
