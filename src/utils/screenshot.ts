/**
 * Module-level WebGL renderer reference for screenshot capture.
 * Avoids polluting Zustand store or passing refs through props.
 */
import { t } from "../i18n/index";

let _renderer: (() => string | undefined) | null = null;

/** Register a function that returns a data URL from the current frame. */
export function setScreenshotFn(fn: (() => string | undefined) | null): void {
  _renderer = fn;
}

/** Register a function that resets the camera to its initial position. */
export function setResetCameraFn(fn: (() => void) | null): void {
  _resetCamera = fn;
}
let _resetCamera: (() => void) | null = null;

/** Reset the 3D camera to its default position. */
export function resetCameraView(): void {
  _resetCamera?.();
}

/** Copy the current view and persist a PNG through the desktop bridge. */
export async function takeScreenshot(filename = `screenshot-${Date.now()}.png`): Promise<void> {
  if (!_renderer) return;
  const dataUrl = _renderer();
  if (!dataUrl) return;
  const android = window.ChemVizAndroid;
  if (android?.saveScreenshot) {
    const saved = android.saveScreenshot(filename, dataUrl);
    const message = saved ? t("screenshotSavedToAlbum") : t("screenshotSaveAlbumFailed");
    window.dispatchEvent(new CustomEvent("chemviz-toast", { detail: { message } }));
    return;
  }
  const blob = await (await fetch(dataUrl)).blob();
  let copied = false;
  try {
    if (navigator.clipboard && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      copied = true;
    }
  } catch (error) {
    console.warn("Unable to copy screenshot to clipboard", error);
  }
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  let savedPath = "";
  if (bridge?.version === 1 && bridge.token) {
    try {
      const response = await fetch("/__chemviz_bridge/screenshots", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-ChemViz-Bridge-Token": bridge.token },
        body: JSON.stringify({ filename, dataUrl }),
      });
      if (response.ok) savedPath = ((await response.json()) as { path?: string }).path || "";
    } catch (error) {
      console.warn("Unable to save screenshot through desktop bridge", error);
    }
  }
  const message = copied
    ? (savedPath ? t("screenshotCopiedAndSaved", { path: savedPath }) : t("screenshotCopied"))
    : (savedPath ? t("screenshotSaved", { path: savedPath }) : t("screenshotSaveFailed"));
  window.dispatchEvent(new CustomEvent("chemviz-toast", { detail: { message } }));
}
