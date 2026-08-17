import React, { useEffect, useState } from "react";
import { TopBar } from "./components/TopBar";
import { LeftPanel } from "./components/LeftPanel";
import { RightPanel } from "./components/RightPanel";
import { MoleculeViewer } from "./components/MoleculeViewer";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useMolecule } from "./hooks/useMolecule";
import { useStore } from "./store/useStore";
import { AISettingsDialog } from "./components/AISettingsDialog";
import { hasTextAISettings } from "./ai/config";
import { takeScreenshot, resetCameraView } from "./utils/screenshot";
import "./App.css";

const App: React.FC = () => {
  const { processChemVZFile, processInput } = useMolecule();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);

  useEffect(() => {
    const required = !hasTextAISettings();
    setSettingsRequired(required);
    setSettingsOpen(required);
  }, []);

  // Escape key → close window
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (settingsOpen) {
          if (!settingsRequired) setSettingsOpen(false);
          return;
        }
        window.close();
      }
    };
    // ---
    const kb = (e2: KeyboardEvent) => {
      if (e2.target instanceof HTMLInputElement || e2.target instanceof HTMLTextAreaElement) return;
            if (e2.key === 'r' || e2.key === 'R') {
        resetCameraView();
        const s = useStore.getState();
        s.setSelected(null);
        s.setRotatingBond(null);
        s.clearMeasurePoints();
      }
      else if (e2.key === 'm' || e2.key === 'M') { const s = useStore.getState(); s.setMeasureMode(!s.measureMode); }
      else if (e2.key === 'f' || e2.key === 'F') {
        if (!document.fullscreenElement) document.documentElement.requestFullscreen();
        else document.exitFullscreen();
      }
      else if (e2.key === 's' && (e2.ctrlKey || e2.metaKey)) { e2.preventDefault(); takeScreenshot(); }
    };
    window.addEventListener("keydown", handler);
    window.addEventListener("keydown", kb);
    return () => { window.removeEventListener("keydown", handler); window.removeEventListener("keydown", kb); };
  }, [settingsOpen, settingsRequired]);

  const handleSettingsSaved = () => {
    setSettingsRequired(false);
    setSettingsOpen(false);
  };

  return (
    <div className="app-container">
      <TopBar />
      <div className="main-content">
        <LeftPanel onProcessInput={processInput} onProcessChemVZFile={processChemVZFile}
          onOpenAISettings={() => setSettingsOpen(true)} />
        <div className="viewer-container">
          <ErrorBoundary>
          <MoleculeViewer />
          </ErrorBoundary>
        </div>
        <RightPanel />
      </div>
      <AISettingsDialog open={settingsOpen} required={settingsRequired}
        onSaved={handleSettingsSaved} onCancel={() => setSettingsOpen(false)} />
    </div>
  );
};

export default App;
