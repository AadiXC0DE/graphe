/** An add-on that talks in messages of its own: one it wants on screen with
 *  something attached to it, one it wants kept out of the conversation, and one
 *  turn it asks the app to take on its behalf. */
export default function messages(api) {
  api.sendMessage({
    customType: 'field-notes',
    content: [{ type: 'text', text: 'The first four buttons are re-drawn.' }],
    display: true,
    details: { files: ['buttons.css'] },
  });

  api.sendMessage({
    customType: 'private-notes',
    content: [{ type: 'text', text: 'not for the screen' }],
    display: false,
  });

  api.sendUserMessage('Carry on from those notes.', { deliverAs: 'followUp' });
}
