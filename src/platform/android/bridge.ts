import { platform } from "../index";

/**
 * Console forwarding and the ready ping the Android shell expects.
 *
 * This used to be an inline <script> inside the Android copy of index.html,
 * which meant the Android build could never share the web shell. It now lives
 * in the shared bundle and is a no-op on web and desktop.
 */
export function installAndroidShellBridge(): void {
  if (!platform.isAndroid || typeof window === "undefined") return;
  const bridge = window.ChemVizAndroid;
  if (!bridge) return;

  const forward = (prefix: string) => (...args: unknown[]) => {
    try {
      bridge.onConsoleLog?.(prefix + args.map(stringify).join(" "));
    } catch {
      // Logging must never break the app.
    }
  };
  const originalLog = console.log.bind(console);
  const originalError = console.error.bind(console);
  console.log = (...args: unknown[]) => { forward("")(...args); originalLog(...args); };
  console.error = (...args: unknown[]) => { forward("[E] ")(...args); originalError(...args); };

  window.addEventListener("load", () => {
    try { bridge.onReady?.(); } catch { /* shell already gone */ }
  }, { once: true });
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
