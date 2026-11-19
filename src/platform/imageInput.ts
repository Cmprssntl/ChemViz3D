import { platform } from "./index";
import { resizeImageForAI } from "../ai/image";

let pendingAndroidImage: ((dataUrl: string | null) => void) | null = null;

/** Wires the Android callback that delivers the camera/gallery result. */
export function installAndroidImageBridge(): void {
  if (!platform.isAndroid || typeof window === "undefined") return;
  window.__chemvizAndroidImageResult = (dataUrl: string) => {
    const resolve = pendingAndroidImage;
    pendingAndroidImage = null;
    resolve?.(dataUrl || null);
  };
}

function requestAndroidImage(timeoutMs = 180_000): Promise<string | null> {
  return new Promise((resolve) => {
    const bridge = window.ChemVizAndroid;
    if (!bridge?.openImageChooser) {
      resolve(null);
      return;
    }
    pendingAndroidImage = resolve;
    bridge.openImageChooser();
    window.setTimeout(() => {
      if (pendingAndroidImage === resolve) {
        pendingAndroidImage = null;
        resolve(null);
      }
    }, timeoutMs);
  });
}

function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.style.display = "none";
    input.addEventListener("change", () => {
      resolve(input.files?.[0] ?? null);
      input.remove();
    }, { once: true });
    // Cancelling a native dialog fires no event; the element is cleaned up on
    // the next pick, so no timer is needed.
    document.body.appendChild(input);
    input.click();
  });
}

/**
 * Acquires an image as a JPEG data URL: the native camera/gallery sheet on
 * Android, a file dialog everywhere else.
 */
export async function acquireImageDataUrl(): Promise<string | null> {
  if (platform.isAndroid) return requestAndroidImage();
  const file = await pickImageFile();
  return file ? resizeImageForAI(file) : null;
}
