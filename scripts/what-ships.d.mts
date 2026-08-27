// So a test can ask what ships and get an answer with a shape. The module
// itself is JavaScript because the build runs it directly, without a compile.
export declare const RUNTIME: readonly string[];
export declare function leaveOut(): Promise<string[]>;
export declare function carriedAlong(): Promise<string[]>;
export declare function leaveOutTheLanguages(context: {
  electronPlatformName: string;
  appOutDir: string;
  packager: { appInfo: { productFilename: string } };
}): Promise<void>;
