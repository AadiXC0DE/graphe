/** Provider failures, said in words somebody can act on.
 *
 * A model refusing a picture comes back as a wall of JSON. Unrecognised, it is
 * shown as "something went wrong on my side" — which is not true, is not
 * actionable, and does not mention the picture or the model, so the person
 * attaches another one and it happens again.
 */

import { describe, expect, it } from 'vitest';

import { plainTrouble } from '../electron/plainly';

describe('a model that will not take a picture', () => {
  it('is recognised however the provider phrased it', () => {
    for (const raw of [
      '400 invalid_request_error: image input is not supported for this model',
      "This model does not support image input",
      'Unsupported content type: vision is not allowed on gpt-x',
      'no support for image content in messages',
      'multimodal input not supported',
    ]) {
      expect(plainTrouble(raw).what, raw).toBe('This model cannot read pictures.');
    }
  });

  it('says both ways out of it', () => {
    const said = plainTrouble('image input is not supported for this model');
    expect(said.because).toMatch(/take it out/i);
    expect(said.because).toMatch(/pick a model/i);
  });

  /* It sits above the context rule on purpose: a provider refusing a picture
     often mentions a size or a token in the same sentence, and being told the
     conversation is too long sends somebody to start a new one for nothing. */
  it('is not mistaken for a conversation that grew too long', () => {
    const said = plainTrouble('image is too large: image input not supported, token limit');
    expect(said.what).toBe('This model cannot read pictures.');
  });

  it('leaves a real context failure alone', () => {
    expect(plainTrouble('maximum context length exceeded').what).toMatch(/too long/i);
  });

  it('keeps the raw text underneath, for whoever wants it', () => {
    const said = plainTrouble('400 invalid_request_error: image input is not supported');
    expect(said.details).toContain('invalid_request_error');
  });
});
