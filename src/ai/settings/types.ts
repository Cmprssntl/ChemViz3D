export interface AIConfig {
  /** API root or a complete Chat Completions URL. */
  baseUrl: string;
  apiKey: string;
  model: string;
  maxRetries: number;
  systemPrompt: string;
}

export interface AIEndpointSettings {
  api: string;
  model: string;
  requestUrl: string;
  maxRetries: number;
  systemPrompt: string;
}

export interface AISettings {
  text: AIEndpointSettings;
  image: AIEndpointSettings;
}

export interface UISettings {
  locale: "zh-CN" | "zh-TW" | "en-US";
  displayMode: "ball-and-stick" | "space-filling";
  labelDisplayMode: "always" | "hover" | "never";
  conformerSearchQuality: "fast" | "balanced" | "precise";
}
