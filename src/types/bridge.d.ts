interface Window {
  /**
   * Android WebView bridge (`addJavascriptInterface`).
   * Every method is optional because the same bundle also runs on desktop/web.
   */
  ChemVizAndroid?: {
    onReady(): void;
    onConsoleLog(message: string): void;
    saveScreenshot?(filename: string, dataUrl: string): boolean;
    /** Mobile persistence bridge. Methods are synchronous on the JS side. */
    getSettings?(): string;
    saveSettings?(content: string): boolean;
    getCache?(key: string): string;
    saveCache?(key: string, content: string): boolean;
    deleteCache?(key: string): boolean;
    clearCache?(): boolean;
    /** Clear cache entries whose storage key starts with `prefix`. */
    clearCacheByPrefix?(prefix: string): boolean;
    requestChatCompletions?(requestId: string, url: string, apiKey: string, body: string): void;
    /** Opens the native camera/gallery sheet; the result arrives via
     *  `window.__chemvizAndroidImageResult`. */
    openImageChooser?(): void;
  };
}
