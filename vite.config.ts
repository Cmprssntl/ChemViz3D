import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

interface SettingsFile {
  text?: Partial<{ api: string; model: string; requestUrl: string; maxRetries: number; systemPrompt: string }>;
  image?: Partial<{ api: string; model: string; requestUrl: string; maxRetries: number; systemPrompt: string }>;
  systemPrompt?: string;
  ui?: Partial<{ locale: string; displayMode: string; labelDisplayMode: string; conformerSearchQuality: string }>;
}

const emptyEndpoint = { api: '', model: '', requestUrl: '', maxRetries: 2, systemPrompt: '' };
const defaultSettings = {
  text: { ...emptyEndpoint },
  image: { ...emptyEndpoint },
};
const AI_PROXY_PATH = '/__chemviz_ai_proxy';

function readSettings(fileName: string): SettingsFile {
  const filePath = path.resolve(process.cwd(), fileName);
  if (!fs.existsSync(filePath)) return {};
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8')) as SettingsFile;
  } catch (error) {
    throw new Error(`Invalid ${fileName}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function mergeEndpoint(base: typeof emptyEndpoint, override?: SettingsFile['text']) {
  const nonEmpty = (value: unknown, fallback: string) =>
    typeof value === 'string' && value.trim() ? value.trim() : fallback;
  return {
    api: nonEmpty(override?.api, base.api),
    model: nonEmpty(override?.model, base.model),
    requestUrl: nonEmpty(override?.requestUrl, base.requestUrl),
    maxRetries: typeof override?.maxRetries === 'number' && Number.isInteger(override.maxRetries)
      ? Math.min(10, Math.max(0, override.maxRetries))
      : base.maxRetries,
    systemPrompt: nonEmpty(override?.systemPrompt, base.systemPrompt),
  };
}

function loadAISettings(command: 'build' | 'serve') {
  const publicSettings = readSettings('settings.int');
  // Never bundle the ignored developer key into a production build.
  const developerSettings = command === 'serve' ? readSettings('settings.developer.int') : {};
  const legacySystemPrompt = typeof developerSettings.systemPrompt === 'string' && developerSettings.systemPrompt.trim()
    ? developerSettings.systemPrompt.trim()
    : (typeof publicSettings.systemPrompt === 'string' && publicSettings.systemPrompt.trim()
      ? publicSettings.systemPrompt.trim()
      : '');
  const text = mergeEndpoint(mergeEndpoint(defaultSettings.text, publicSettings.text), developerSettings.text);
  const image = mergeEndpoint(mergeEndpoint(defaultSettings.image, publicSettings.image), developerSettings.image);
  const ui = {
    locale: publicSettings.ui?.locale === 'zh-TW' || publicSettings.ui?.locale === 'en-US' ? publicSettings.ui.locale : 'zh-CN',
    displayMode: publicSettings.ui?.displayMode === 'space-filling' ? 'space-filling' : 'ball-and-stick',
    labelDisplayMode: publicSettings.ui?.labelDisplayMode === 'hover' || publicSettings.ui?.labelDisplayMode === 'never'
      ? publicSettings.ui.labelDisplayMode
      : 'always',
    conformerSearchQuality: publicSettings.ui?.conformerSearchQuality === 'fast' || publicSettings.ui?.conformerSearchQuality === 'precise'
      ? publicSettings.ui.conformerSearchQuality
      : 'balanced',
  };
  return {
    text: legacySystemPrompt && !text.systemPrompt ? { ...text, systemPrompt: legacySystemPrompt } : text,
    image: legacySystemPrompt && !image.systemPrompt ? { ...image, systemPrompt: legacySystemPrompt } : image,
    ui,
  };
}

function createAIProxy(requestUrl: string) {
  const normalized = requestUrl.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(normalized)) return undefined;
  const endpoint = normalized.endsWith('/chat/completions') ? normalized : `${normalized}/chat/completions`;
  let parsed: URL;
  try {
    parsed = new URL(endpoint);
  } catch {
    return undefined;
  }
  return {
    target: parsed.origin,
    changeOrigin: true,
    secure: true,
    rewrite: () => parsed.pathname,
  };
}

export default defineConfig(({ command }) => {
  const aiSettings = loadAISettings(command);
  const proxy = command === 'serve' ? createAIProxy(aiSettings.text.requestUrl) : undefined;
  return {
  define: {
    __CHEMVIZ_AI_SETTINGS__: JSON.stringify(aiSettings),
    __CHEMVIZ_AI_PROXY_URL__: JSON.stringify(proxy ? AI_PROXY_PATH : ''),
    __CHEMVIZ_AI_PROXY_SOURCE__: JSON.stringify(proxy ? aiSettings.text.requestUrl : ''),
  },
  plugins: [
    react(),
    // Android WebView (普通 <script>, 非 type="module") 不支持 import.meta,
    // 替换为普通 JS 表达式避免 SyntaxError
    {
      name: 'fix-import-meta-android',
      renderChunk(code) {
        return {
          code: code
            .replace(/import\.meta\.resolve/g, 'void 0')
            .replace(/import\.meta\.url/g, 'location.href'),
          map: null
        };
      }
    }
  ],
  optimizeDeps: {
    exclude: ['@rdkit/rdkit']
  },
  build: {
    // 关闭 module preload polyfill（Vite 内置会生成 import.meta 代码）
    modulePreload: false,
    // 关闭 CSS 代码分割，Android 版只引用单个 style.css
    cssCodeSplit: false
  },
  server: {
    port: 5173,
    open: true,
    ...(proxy ? { proxy: { [AI_PROXY_PATH]: proxy } } : {}),
  }
  };
})
