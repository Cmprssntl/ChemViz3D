import React, { useCallback, useEffect, useRef, useState } from "react";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { MoleculeViewer } from "./components/MoleculeViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useMolecule } from "./hooks/useMolecule";
import { useStore } from "./store/useStore";
import { AISettingsDialog } from "./components/AISettingsDialog";
import {
  getAISettings,
  getInjectedUISettings,
  getRuntimeAISettings,
  hasDesktopDeveloperSettings,
  hasValidTextAISettings,
  loadAISettingsFromDesktopBridge,
  restoreSettingsFromInjection,
  setRuntimeAISettings,
} from "./ai/config";
import { takeScreenshot, resetCameraView } from "./utils/screenshot";
import { t } from "./i18n/index";
import { loadExternalPresets } from "./ai/localParser";
import { acquireImageDataUrl } from "./platform/imageInput";
import { useResponsiveLayout } from "./hooks/useResponsiveLayout";
import "./App.css";

const App: React.FC = () => {
  const { processChemVZFile, processInput, processImageData, regenerate, clearCurrentCache, clearAllCache } = useMolecule();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(true);
  const [screenshotNotice, setScreenshotNotice] = useState<string | null>(null);
  const screenshotTimer = useRef<number | null>(null);
  const { orientation } = useResponsiveLayout();
  const leftCollapsed = useStore((s) => s.leftCollapsed);
  const setError = useStore((s) => s.setError);

  /**
   * One entry point for image import: the Android shell opens the native
   * camera/gallery sheet, every other platform uses a file dialog. Both return
   * the same downscaled JPEG data URL.
   */
  const handleProcessImage = useCallback(async () => {
    try {
      const dataUrl = await acquireImageDataUrl();
      if (dataUrl) await processImageData(dataUrl);
    } catch (error) {
      setError(t("aiParsingFailed") + (error instanceof Error ? error.message : String(error)));
    }
  }, [processImageData, setError]);
  const rightCollapsed = useStore((s) => s.rightCollapsed);
  const setLeftCollapsed = useStore((s) => s.setLeftCollapsed);
  const setRightCollapsed = useStore((s) => s.setRightCollapsed);
  useEffect(() => {
    const handleToast = (event: Event) => {
      const message = (event as CustomEvent<{ message?: string }>).detail?.message;
      if (!message) return;
      setScreenshotNotice(message);
      const openSettings = (event as CustomEvent<{ openSettings?: boolean }>).detail?.openSettings;
      if (openSettings) {
        setSettingsRequired(true);
        setSettingsOpen(true);
      }
      if (screenshotTimer.current !== null) window.clearTimeout(screenshotTimer.current);
      screenshotTimer.current = window.setTimeout(() => {
        setScreenshotNotice(null);
        screenshotTimer.current = null;
      }, 4500);
    };
    window.addEventListener("chemviz-toast", handleToast);
    window.addEventListener("chemviz-ai-settings-required", handleToast);
    return () => {
      window.removeEventListener("chemviz-toast", handleToast);
      window.removeEventListener("chemviz-ai-settings-required", handleToast);
      if (screenshotTimer.current !== null) window.clearTimeout(screenshotTimer.current);
    };
  }, []);

  // Preserve the Android touch bridge: Java can submit a formula through a
  // custom DOM event without changing the desktop workflow.
  useEffect(() => {
    const handleAndroidMolecule = (event: Event) => {
      const formula = (event as CustomEvent<{ formula?: string }>).detail?.formula;
      if (formula) processInput(formula);
    };
    window.addEventListener("android-molecule", handleAndroidMolecule);
    return () => window.removeEventListener("android-molecule", handleAndroidMolecule);
  }, [processInput]);

  useEffect(() => {
    let active = true;
    const initializeSettings = async () => {
      // Seed the in-memory snapshot before any input can reach the parser.
      setRuntimeAISettings(getAISettings(), hasDesktopDeveloperSettings());
      // Apply the HTML-injected settings immediately: the bridge inlines the
      // on-disk settings into the page, so reads need no network and finish
      // instantly even when QtWebEngine's fetch is slow or fails.
      restoreSettingsFromInjection();
      const injectedUi = getInjectedUISettings();
      if (injectedUi) useStore.getState().applyUISettings(injectedUi);
      try {
        await loadExternalPresets();
        // Refresh from the bridge file once the network service is ready.
        // This is an enhancement, not a dependency: injected settings above
        // already provided a working snapshot.
        const uiSettings = await loadAISettingsFromDesktopBridge();
        if (uiSettings) useStore.getState().applyUISettings(uiSettings);
      } catch (error) {
        console.error(error);
      }
      if (!active) return;
      const available = hasValidTextAISettings(getRuntimeAISettings());
      setAiUnavailable(!available);
      setSettingsRequired(false);
    };
    void initializeSettings();
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const kb = (e2: KeyboardEvent) => {
      if (e2.target instanceof HTMLInputElement || e2.target instanceof HTMLTextAreaElement) return;
      if (e2.key === 'r' || e2.key === 'R') {
        resetCameraView();
        const s = useStore.getState();
        s.setSelected(null);
        s.setRotatingBond(null);
        s.clearMeasurePoints();
      }
      else if (e2.key === 's' && (e2.ctrlKey || e2.metaKey)) { e2.preventDefault(); takeScreenshot(); }
    };
    window.addEventListener("keydown", kb);
    return () => window.removeEventListener("keydown", kb);
  }, []);

  const handleSettingsSaved = () => {
    setSettingsRequired(false);
    setSettingsOpen(false);
    setAiUnavailable(!hasValidTextAISettings(getRuntimeAISettings()));
  };

  return (
    <div className={`app-container orientation-${orientation} ${leftCollapsed ? "left-collapsed" : ""} ${rightCollapsed ? "right-collapsed" : ""}`}>
      <TopBar />
      {screenshotNotice && <div className="screenshot-toast" role="status">{screenshotNotice}</div>}
      <div className="main-content">
        <LeftPanel onProcessInput={processInput} onProcessChemVZFile={processChemVZFile}
          onProcessImage={handleProcessImage} onRegenerate={regenerate}
          onOpenAISettings={() => setSettingsOpen(true)} onClearCurrentCache={clearCurrentCache}
          onClearAllCache={clearAllCache} aiUnavailable={aiUnavailable} />
        <button className="panel-tab left-tab" onClick={() => setLeftCollapsed(!leftCollapsed)} title={t(leftCollapsed ? "expandPanel" : "collapsePanel")}>
          {leftCollapsed ? (orientation === "portrait" ? "▼" : "▸") : (orientation === "portrait" ? "▲" : "◂")}
        </button>
        <div className="viewer-container">
          <ErrorBoundary>
          <MoleculeViewer />
          </ErrorBoundary>
        </div>
        <button className="panel-tab right-tab" onClick={() => setRightCollapsed(!rightCollapsed)} title={t(rightCollapsed ? "expandPanel" : "collapsePanel")}>
          {rightCollapsed ? (orientation === "portrait" ? "▲" : "◂") : (orientation === "portrait" ? "▼" : "▸")}
        </button>
        <RightPanel />
      </div>
      <AISettingsDialog open={settingsOpen} required={settingsRequired}
        onSaved={handleSettingsSaved} onCancel={() => setSettingsOpen(false)} />
    </div>
  );
};

export default App;
