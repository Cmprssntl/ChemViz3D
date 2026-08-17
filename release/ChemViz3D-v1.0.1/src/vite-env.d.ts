/// <reference types="vite/client" />
declare const __CHEMVIZ_AI_SETTINGS__: {
  text?: { api?: string; model?: string; requestUrl?: string; maxRetries?: number; systemPrompt?: string };
  image?: { api?: string; model?: string; requestUrl?: string; maxRetries?: number; systemPrompt?: string };
  systemPrompt?: string;
} | undefined;
declare const __CHEMVIZ_AI_PROXY_URL__: string | undefined;
declare const __CHEMVIZ_AI_PROXY_SOURCE__: string | undefined;
