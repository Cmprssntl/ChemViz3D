import React, { useEffect, useMemo, useState } from "react";
import {
  DEFAULT_SYSTEM_PROMPT,
  getAISettings,
  getChatCompletionsUrl,
  saveAISettings,
  saveAISettingsFile,
  type AIEndpointSettings,
  type AISettings,
} from "../ai/config";
import { t } from "../i18n/index";

type SettingsTab = "text" | "image";

interface AISettingsDialogProps {
  open: boolean;
  required: boolean;
  onSaved: () => void;
  onCancel: () => void;
}

const emptyEndpoint = (): AIEndpointSettings => ({ api: "", model: "", requestUrl: "", maxRetries: 2, systemPrompt: DEFAULT_SYSTEM_PROMPT });
const emptySettings = (): AISettings => ({ text: emptyEndpoint(), image: emptyEndpoint() });

export const AISettingsDialog: React.FC<AISettingsDialogProps> = ({ open, required, onSaved, onCancel }) => {
  const [draft, setDraft] = useState<AISettings>(emptySettings);
  const [tab, setTab] = useState<SettingsTab>("text");
  const [showApi, setShowApi] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);
  const [editingPromptTab, setEditingPromptTab] = useState<SettingsTab | null>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(getAISettings());
    setTab("text");
    setShowApi(false);
    setValidationError(null);
    setEditingPromptTab(null);
  }, [open]);

  const endpoint = draft[tab];
  const fullRequestUrl = useMemo(
    () => tab === "text"
      ? getChatCompletionsUrl(endpoint.requestUrl)
      : getChatCompletionsUrl(endpoint.requestUrl),
    [endpoint.requestUrl, tab],
  );

  if (!open) return null;

  const updateEndpoint = (patch: Partial<AIEndpointSettings>) => {
    setDraft((current) => ({ ...current, [tab]: { ...current[tab], ...patch } }));
    setValidationError(null);
  };

  const handleEnableSystemPromptEditing = () => {
    if (window.confirm(t("systemPromptWarning"))) {
      setEditingPromptTab(tab);
    }
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const text = draft.text;
    if (!text.api.trim() || !text.model.trim() || !text.requestUrl.trim()) {
      setTab("text");
      setValidationError(t("aiSettingsRequired"));
      return;
    }
    try {
      saveAISettings(draft);
      await saveAISettingsFile(draft);
      onSaved();
    } catch (error) {
      setValidationError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <div className="settings-backdrop" role="presentation">
      <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="ai-settings-title">
        <div className="settings-dialog-header">
          <div>
            <h2 id="ai-settings-title">{t("aiSettings")}</h2>
            <p>{required ? t("aiSettingsRequiredHint") : t("aiSettingsHint")}</p>
          </div>
          {!required && (
            <button type="button" className="btn btn-icon" title={t("cancel")} onClick={onCancel}>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
              </svg>
            </button>
          )}
        </div>

        <div className="settings-tabs" role="tablist" aria-label={t("aiSettingsModels")}>
          <button type="button" role="tab" aria-selected={tab === "text"}
            className={`btn settings-tab ${tab === "text" ? "active" : ""}`} onClick={() => setTab("text")}>
            {t("textModel")}
          </button>
          <button type="button" role="tab" aria-selected={tab === "image"}
            className={`btn settings-tab ${tab === "image" ? "active" : ""}`} onClick={() => setTab("image")}>
            {t("imageModel")}
          </button>
        </div>

        <form onSubmit={handleSubmit} className="settings-form">
          <label className="settings-field">
            <span>{t("apiKey")}{tab === "text" ? " *" : ""}</span>
            <input type={showApi ? "text" : "password"} value={endpoint.api}
              onChange={(event) => updateEndpoint({ api: event.target.value })}
              autoComplete="off" placeholder={t("apiKeyPlaceholder")} />
          </label>
          <label className="settings-field">
            <span>{t("model")}{tab === "text" ? " *" : ""}</span>
            <input type="text" value={endpoint.model}
              onChange={(event) => updateEndpoint({ model: event.target.value })}
              placeholder={tab === "text" ? "gpt-4o-mini" : "gpt-image-1"} />
          </label>
          <label className="settings-field">
            <span>{t("requestUrl")}{tab === "text" ? " *" : ""}</span>
            <input type="url" value={endpoint.requestUrl}
              onChange={(event) => updateEndpoint({ requestUrl: event.target.value })}
              placeholder="https://api.openai.com/v1" />
          </label>
          <div className="settings-field">
            <span>{t("fullRequestUrl")}</span>
            <output className="settings-url-preview">{fullRequestUrl || "-"}</output>
          </div>
          <label className="settings-field settings-number-field">
            <span>{t("maxRetries")}</span>
            <input type="number" min="0" max="10" step="1" value={endpoint.maxRetries}
              onChange={(event) => updateEndpoint({ maxRetries: Math.min(10, Math.max(0, Number(event.target.value) || 0)) })} />
          </label>
          <div className="settings-field">
            <span>{t("systemPrompt")}</span>
            {editingPromptTab === tab && <>
              <textarea value={endpoint.systemPrompt}
                onChange={(event) => updateEndpoint({ systemPrompt: event.target.value })}
                rows={10} spellCheck={false} />
              <span className="settings-muted">{t("systemPromptHint")}</span>
            </>}
            <button type="button" className="btn settings-open-button" onClick={handleEnableSystemPromptEditing}
              disabled={editingPromptTab === tab}>
              {editingPromptTab === tab ? t("systemPromptEditing") : t("editSystemPrompt")}
            </button>
          </div>
          <label className="settings-check">
            <input type="checkbox" checked={showApi} onChange={(event) => setShowApi(event.target.checked)} />
            <span>{t("showApiKey")}</span>
          </label>
          {tab === "image" && <p className="settings-muted">{t("imageSettingsReserved")}</p>}
          {validationError && <div className="error-banner settings-error">{validationError}</div>}
          <div className="settings-actions">
            {!required && <button type="button" className="btn" onClick={onCancel}>{t("cancel")}</button>}
            <button type="submit" className="btn btn-primary">{t("saveSettingsFile")}</button>
          </div>
        </form>
      </section>
    </div>
  );
};
