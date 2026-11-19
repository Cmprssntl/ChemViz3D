/**
 * One source of truth for platform differences.
 *
 * Everything that varies between the web build, the Qt desktop shell and the
 * Android WebView is expressed here as a capability flag. Feature code asks the
 * adapter (`platform.supportsNativeScreenshot`) instead of sniffing globals, so
 * the three builds share one implementation.
 */
export type PlatformKind = "web" | "desktop" | "android";

export interface PlatformCapabilities {
  kind: PlatformKind;
  /** Bridge-backed persistence (settings, AI cache). */
  nativePersistence: boolean;
  /** PNG export through a native dialog instead of a download. */
  nativeScreenshot: boolean;
  /** Camera / gallery import for the image-to-structure flow. */
  imageInput: boolean;
  /** Layout should default to touch affordances. */
  touchFirst: boolean;
}

export abstract class PlatformAdapter {
  abstract readonly kind: PlatformKind;
  abstract readonly capabilities: PlatformCapabilities;

  get isDesktop(): boolean {
    return this.kind === "desktop";
  }

  get isAndroid(): boolean {
    return this.kind === "android";
  }

  get isWeb(): boolean {
    return this.kind === "web";
  }

  /** Mirrors the platform onto `<html data-platform data-touch>`. */
  applyToDocument(): void {
    if (typeof document === "undefined") return;
    const root = document.documentElement;
    root.dataset.platform = this.kind;
    if (this.capabilities.touchFirst) root.dataset.touch = "true";
    else delete root.dataset.touch;
  }
}

export class WebPlatform extends PlatformAdapter {
  readonly kind = "web" as const;
  readonly capabilities: PlatformCapabilities = {
    kind: "web",
    nativePersistence: false,
    nativeScreenshot: false,
    imageInput: false,
    touchFirst: false,
  };
}

export class DesktopPlatform extends PlatformAdapter {
  readonly kind = "desktop" as const;
  readonly capabilities: PlatformCapabilities = {
    kind: "desktop",
    nativePersistence: true,
    nativeScreenshot: true,
    imageInput: false,
    touchFirst: false,
  };
}

export class AndroidPlatform extends PlatformAdapter {
  readonly kind = "android" as const;
  readonly capabilities: PlatformCapabilities = {
    kind: "android",
    nativePersistence: true,
    nativeScreenshot: true,
    imageInput: true,
    touchFirst: true,
  };
}

export function adapterFor(kind: PlatformKind): PlatformAdapter {
  switch (kind) {
    case "android":
      return new AndroidPlatform();
    case "desktop":
      return new DesktopPlatform();
    default:
      return new WebPlatform();
  }
}
