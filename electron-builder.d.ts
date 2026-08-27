// So a test can read the packaging config as the object it is rather than as
// text. The config itself is JavaScript because part of it has to be worked out
// at build time — see the note at the top of electron-builder.js.
import type { Configuration } from 'electron-builder';

declare const config: () => Promise<Configuration>;
export default config;
