import { platform } from "../../platform";
import {
  DEFAULT_SETTINGS,
  cacheUISettings,
  getAISettings,
  getUISettings,
  normalizeEndpoint,
  normalizeUISettings,
  setRuntimeAISettings,
} from "./storage";
import type { AISettings, UISettings } from "./types";

const DESKTOP_BRIDGE_PREFIX = "/__chemviz_bridge";
const DESKTOP_BRIDGE_TOKEN_HEADER = "X-ChemViz-Bridge-Token";

export function getDesktopBridgeToken(): string {
  if (typeof window === "undefined") return "";
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  return bridge?.version === 1 && typeof bridge.token === "string" ? bridge.token : "";
}

export function hasDesktopDeveloperSettings(): boolean {
  if (typeof window === "undefined") return false;
  const bridge = window.__CHEMVIZ_DESKTOP_BRIDGE__;
  return bridge?.version === 1 && bridge.developerConfigured === true;
}

function desktopBridgeHeaders(): Record<string, string> {
  const token = getDesktopBridgeToken();
  return token ? { [DESKTOP_BRIDGE_TOKEN_HEADER]: token } : {};
}

function androidBridge(): NonNullable<Window["ChemVizAndroid"]> | null {
  if (typeof window === "undefined" || !platform.isAndroid) return null;
  const bridge = window.ChemVizAndroid;
  return bridge && typeof bridge.getSettings === "function" && typeof bridge.saveSettings === "function"
    ? bridge
    : null;
}

/** Load persisted AI and UI settings from the local desktop bridge. */
export async function loadAISettingsFromDesktopBridge(): Promise<UISettings | null> {
  const mobile = androidBridge();
  if (mobile) {
    try {
      const raw = mobile.getSettings?.() || "{}";
      const value = JSON.parse(raw) as Partial<AISettings> & { ui?: unknown };
      const normalized = {
        text: normalizeEndpoint(value.text, DEFAULT_SETTINGS.text),
        image: normalizeEndpoint(value.image, DEFAULT_SETTINGS.image),
      };
      window.localStorage.setItem("chemviz3d.ai-settings.v1", JSON.stringify(normalized));
      setRuntimeAISettings(normalized, hasDesktopDeveloperSettings());
      return cacheUISettings(normalizeUISettings(value.ui));
    } catch (error) {
      console.warn("Unable to load Android settings; using local defaults", error);
      return null;
    }
  }
  const token = getDesktopBridgeToken();
  if (!token || typeof window === "undefined") return null;
  const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
    headers: desktopBridgeHeaders(),
  });
  if (!response.ok) throw new Error(`无法读取桌面客户端配置（HTTP ${response.status}）`);
  const value = await response.json() as Partial<AISettings> & { ui?: unknown };
  const normalized = {
    text: normalizeEndpoint(value.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(value.image, DEFAULT_SETTINGS.image),
  };
  try {
    window.localStorage.setItem("chemviz3d.ai-settings.v1", JSON.stringify(normalized));
  } catch {
    // localStorage is best-effort (QtWebEngine keys it by origin, so it may
    // be a fresh empty store after a relaunch). Never let a storage failure
    // prevent applying the file-based settings below.
  }
  setRuntimeAISettings(normalized, hasDesktopDeveloperSettings());
  return cacheUISettings(normalizeUISettings(value.ui));
}

export async function saveUISettingsToDesktopBridge(settings: UISettings): Promise<boolean> {
  const mobile = androidBridge();
  if (mobile) {
    const current = getAISettings();
    const value = {
      text: current.text,
      image: current.image,
      ui: normalizeUISettings(settings),
    };
    if (!mobile.saveSettings?.(JSON.stringify(value))) throw new Error("无法保存 Android 设置");
    return true;
  }
  const token = getDesktopBridgeToken();
  if (!token) return false;
  // Native QtWebChannel first (packaged desktop), then the HTTP bridge.
  if (await saveViaQtChannel({ ...getAISettings(), ui: normalizeUISettings(settings) })) return true;
  try {
    const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...desktopBridgeHeaders() },
      body: JSON.stringify({ ui: normalizeUISettings(settings) }),
    });
    if (!response.ok) throw new Error(`无法保存桌面客户端界面设置（HTTP ${response.status}）`);
  } catch (error) {
    if (error instanceof Error && /^无法保存桌面客户端界面设置（HTTP/.test(error.message)) {
      throw error;
    }
    const current = getAISettings();
    await saveViaImageBeacon({ ...current, ui: normalizeUISettings(settings) });
  }
  return true;
}

/* QtWebChannel native bridge: the packaged desktop shell exposes settings
 * read/write over Qt's internal IPC (window.qt.webChannelTransport), which
 * keeps working even when QtWebEngine's HTTP network service fails on some
 * Windows builds. The plain web build has no qt object and falls through to
 * the HTTP bridge. */
export interface QtSettingsApi {
  getSettings(callback: (value: string) => void): void;
  saveSettings(content: string, callback: (result: string) => void): void;
  chatCompletions(payloadJson: string, callback: (result: string) => void): void;
}

let qtChannelPromise: Promise<QtSettingsApi | null> | null = null;

function loadQWebChannelScript(): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector("script[data-chemviz-qwebchannel]")) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = "qrc:///qtwebchannel/qwebchannel.js";
    script.dataset.chemvizQwebchannel = "1";
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("qwebchannel.js 加载失败"));
    document.head.appendChild(script);
  });
}

export function getQtSettingsApi(): Promise<QtSettingsApi | null> {
  const qt = (window as { qt?: { webChannelTransport?: unknown } } | undefined)?.qt;
  if (typeof window === "undefined" || !qt?.webChannelTransport) {
    return Promise.resolve(null);
  }
  if (!qtChannelPromise) {
    qtChannelPromise = loadQWebChannelScript()
      .then(
        () =>
          new Promise<QtSettingsApi | null>((resolve) => {
            const ctor = (window as unknown as {
              QWebChannel?: new (
                transport: unknown,
                callback: (channel: { objects: Record<string, QtSettingsApi> }) => void,
              ) => void;
            }).QWebChannel;
            if (!ctor) {
              resolve(null);
              return;
            }
            new ctor(qt.webChannelTransport as unknown, (channel) => {
              resolve(channel.objects.chemviz ?? null);
            });
          }),
      )
      .catch(() => null);
  }
  return qtChannelPromise;
}

/** Prefer the native QtWebChannel save when the desktop shell provides it. */
export async function saveViaQtChannel(settings: Partial<AISettings> & { ui?: unknown }): Promise<boolean> {
  const api = await getQtSettingsApi();
  if (!api) return false;
  const result = await new Promise<string>((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("保存超时")), 10000);
    api.saveSettings(JSON.stringify(settings, null, 2), (value) => {
      window.clearTimeout(timer);
      resolve(value);
    });
  });
  if (result !== "ok") {
    const detail = result.startsWith("error:") ? `：${result.slice(6)}` : "";
    throw new Error(`无法保存桌面客户端配置${detail}`);
  }
  return true;
}

/** Write settings without fetch(): an <img> GET beacon is not subject to
 * QtWebEngine's flaky fetch() on some Windows builds ("Failed to fetch"),
 * so saving keeps working even when the fetch network stack does not. */
export function saveViaImageBeacon(
  settings: Partial<AISettings> & { ui?: unknown },
): Promise<void> {
  const token = getDesktopBridgeToken();
  if (!token) return Promise.reject(new Error("bridge 未连接"));
  const payload = encodeURIComponent(JSON.stringify(settings));
  return new Promise((resolve, reject) => {
    const image = new Image();
    const timer = window.setTimeout(() => reject(new Error("保存超时")), 15000);
    image.onload = () => {
      window.clearTimeout(timer);
      resolve();
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      reject(new Error("无法保存桌面客户端配置（bridge 通道不可用）"));
    };
    image.src = `${DESKTOP_BRIDGE_PREFIX}/settings?action=save&token=${encodeURIComponent(token)}&data=${payload}&t=${Date.now()}`;
  });
}

/** Write settings.int with an explicit file picker, or download it when unavailable. */
export async function saveAISettingsFile(settings: AISettings): Promise<"bridge" | "picker" | "download"> {
  const normalized = {
    text: normalizeEndpoint(settings.text, DEFAULT_SETTINGS.text),
    image: normalizeEndpoint(settings.image, DEFAULT_SETTINGS.image),
    ui: getUISettings(),
  };
  const content = `${JSON.stringify(normalized, null, 2)}\n`;
  const mobile = androidBridge();
  if (mobile) {
    if (!mobile.saveSettings?.(content)) throw new Error("无法保存 Android 设置");
    return "bridge";
  }
  // 1) Native QtWebChannel (packaged desktop): never depends on HTTP.
  if (await saveViaQtChannel(normalized)) return "bridge";
  const bridgeToken = getDesktopBridgeToken();
  if (bridgeToken) {
    try {
      const response = await fetch(`${DESKTOP_BRIDGE_PREFIX}/settings`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", ...desktopBridgeHeaders() },
        body: content,
      });
      if (!response.ok) {
        let detail = "";
        try {
          const payload = await response.json() as { error?: unknown };
          if (typeof payload.error === "string") detail = `：${payload.error}`;
        } catch {
          // Keep the status-only error when the bridge did not return JSON.
        }
        throw new Error(`无法保存桌面客户端配置（HTTP ${response.status}）${detail}`);
      }
    } catch (error) {
      // A non-HTTP failure (e.g. TypeError "Failed to fetch" in QtWebEngine)
      // means the request never reached the bridge; fall back to the image
      // beacon so saving never depends on fetch working.
      if (error instanceof Error && /^无法保存桌面客户端配置（HTTP/.test(error.message)) {
        throw error;
      }
      await saveViaImageBeacon(normalized);
    }
    return "bridge";
  }
  const picker = (window as Window & {
    showSaveFilePicker?: (options?: unknown) => Promise<{
      createWritable: () => Promise<{ write: (value: string) => Promise<void>; close: () => Promise<void> }>;
    }>;
  }).showSaveFilePicker;

  if (picker) {
    const handle = await picker({
      suggestedName: "settings.int",
      types: [{ description: "ChemViz3D settings", accept: { "application/json": [".int", ".json"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return "picker";
  }

  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "settings.int";
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
  return "download";
}
