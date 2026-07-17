/**
 * Module-level WebGL renderer reference for screenshot capture.
 * Avoids polluting Zustand store or passing refs through props.
 */

let _renderer: (() => string | undefined) | null = null;

/** Register a function that returns a data URL from the current frame. */
export function setScreenshotFn(fn: (() => string | undefined) | null): void {
  _renderer = fn;
}

/** Download the current 3D view as a PNG file. */
/** Register a function that resets the camera to its initial position. */
export function setResetCameraFn(fn: (() => void) | null): void {
  _resetCamera = fn;
}
let _resetCamera: (() => void) | null = null;

/** Reset the 3D camera to its default position. */
export function resetCameraView(): void {
  _resetCamera?.();
}

export function takeScreenshot(filename = "screenshot.png"): void {
  if (!_renderer) return;
  const dataUrl = _renderer();
  if (!dataUrl) return;
  const a = document.createElement("a");
  a.download = filename;
  a.href = dataUrl;
  a.click();
}
