/**
 * Image helpers shared by the web file picker, the desktop dialog and the
 * Android camera/gallery bridge. Keeping them here means every platform sends
 * the same downscaled data URL to the vision model.
 */

const MAX_DIMENSION = 1600;
const JPEG_QUALITY = 0.82;

/** Downscales an image file and returns a JPEG data URL. */
export function resizeImageForAI(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight));
        const width = Math.max(1, Math.round(image.naturalWidth * scale));
        const height = Math.max(1, Math.round(image.naturalHeight * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建图片处理画布");
        context.drawImage(image, 0, 0, width, height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(objectUrl);
          if (!blob) {
            reject(new Error("无法压缩图片"));
            return;
          }
          const reader = new FileReader();
          reader.onload = () => typeof reader.result === "string"
            ? resolve(reader.result)
            : reject(new Error("无法读取压缩图片"));
          reader.onerror = () => reject(new Error("无法读取压缩图片"));
          reader.readAsDataURL(blob);
        }, "image/jpeg", JPEG_QUALITY);
      } catch (error) {
        URL.revokeObjectURL(objectUrl);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("无法读取图片文件"));
    };
    image.src = objectUrl;
  });
}

/** Stable cache key for an image, so repeat imports reuse the AI result. */
export async function imageCacheInput(dataUrl: string): Promise<string> {
  try {
    const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(dataUrl));
    return `image:${Array.from(new Uint8Array(bytes)).map((value) => value.toString(16).padStart(2, "0")).join("")}`;
  } catch {
    let hash = 2166136261;
    for (const char of dataUrl) {
      hash ^= char.codePointAt(0) || 0;
      hash = Math.imul(hash, 16777619);
    }
    return `image:${(hash >>> 0).toString(16).padStart(8, "0")}`;
  }
}
