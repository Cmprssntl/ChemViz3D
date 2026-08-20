import React, { useEffect, useRef, useState } from "react";
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
  getRuntimeAISettings,
  hasDesktopDeveloperSettings,
  hasValidTextAISettings,
  loadAISettingsFromDesktopBridge,
  setRuntimeAISettings,
} from "./ai/config";
import { takeScreenshot, resetCameraView } from "./utils/screenshot";
import "./App.css";

const App: React.FC = () => {
  const { processChemVZFile, processInput, clearCurrentCache, clearAllCache } = useMolecule();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsRequired, setSettingsRequired] = useState(false);
  const [aiUnavailable, setAiUnavailable] = useState(true);
  const [screenshotNotice, setScreenshotNotice] = useState<string | null>(null);
  const screenshotTimer = useRef<number | null>(null);
  const [orientation, setOrientation] = useState<"portrait" | "landscape">(
    window.innerWidth < window.innerHeight ? "portrait" : "landscape",
  );
  const leftCollapsed = useStore((s) => s.leftCollapsed);
  const rightCollapsed = useStore((s) => s.rightCollapsed);
  const setLeftCollapsed = useStore((s) => s.setLeftCollapsed);
  const setRightCollapsed = useStore((s) => s.setRightCollapsed);
  const molecule = useStore((s) => s.molecule);
  const measurePoints = useStore((s) => s.measurePoints);
  const measureType = useStore((s) => s.measureType);

  useEffect(() => {
    const handleResize = () => setOrientation(window.innerWidth < window.innerHeight ? "portrait" : "landscape");
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

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

  // Preserve the Android touch bridge: Java can submit a formula and receives
  // the current molecule/measurement without changing the desktop workflow.
  useEffect(() => {
    const handleAndroidMolecule = (event: Event) => {
      const formula = (event as CustomEvent<{ formula?: string }>).detail?.formula;
      if (formula) processInput(formula);
    };
    window.addEventListener("android-molecule", handleAndroidMolecule);
    return () => window.removeEventListener("android-molecule", handleAndroidMolecule);
  }, [processInput]);

  useEffect(() => {
    if (!window.__chemviz?.sendMoleculeInfo) return;
    if (!molecule) {
      window.__chemviz.sendMoleculeInfo(null);
      return;
    }
    window.__chemviz.sendMoleculeInfo({
      formula: molecule.formula,
      name: molecule.name,
      smiles: molecule.smiles,
      atoms: molecule.atoms.length,
      bonds: molecule.bonds.length,
    });
  }, [molecule]);

  useEffect(() => {
    if (!window.__chemviz?.sendMeasurement || !measureType || measurePoints.length < 2 || !molecule) return;
    const atoms = measurePoints.map((index) => molecule.atoms[index]);
    if (atoms.some((atom) => !atom)) return;
    if (measureType === "distance" && atoms.length === 2) {
      const [a, b] = atoms;
      const value = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
      window.__chemviz.sendMeasurement("distance", { value: Number(value.toFixed(3)) });
    } else if (measureType === "angle" && atoms.length === 3) {
      const [a, b, c] = atoms;
      const ab = { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
      const cb = { x: c.x - b.x, y: c.y - b.y, z: c.z - b.z };
      const dot = ab.x * cb.x + ab.y * cb.y + ab.z * cb.z;
      const abLen = Math.hypot(ab.x, ab.y, ab.z);
      const cbLen = Math.hypot(cb.x, cb.y, cb.z);
      const value = Math.acos(Math.max(-1, Math.min(1, dot / (abLen * cbLen)))) * 180 / Math.PI;
      window.__chemviz.sendMeasurement("angle", { value: Number(value.toFixed(1)) });
    } else if (measureType === "dihedral" && atoms.length === 4) {
      window.__chemviz.sendMeasurement("dihedral", { value: 0 });
    }
  }, [measurePoints, measureType, molecule]);

  useEffect(() => {
    let active = true;
    const initializeSettings = async () => {
      // Seed the in-memory snapshot before any input can reach the parser.
      // The desktop bridge may replace it with the effective on-disk settings.
      setRuntimeAISettings(getAISettings(), hasDesktopDeveloperSettings());
      try {
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
          onOpenAISettings={() => setSettingsOpen(true)} onClearCurrentCache={clearCurrentCache}
          onClearAllCache={clearAllCache} aiUnavailable={aiUnavailable} />
        <button className="panel-tab left-tab" onClick={() => setLeftCollapsed(!leftCollapsed)} title={leftCollapsed ? "Expand" : "Collapse"}>
          {leftCollapsed ? (orientation === "portrait" ? "▼" : "▸") : (orientation === "portrait" ? "▲" : "◂")}
        </button>
        <div className="viewer-container">
          <ErrorBoundary>
          <MoleculeViewer />
          </ErrorBoundary>
        </div>
        <button className="panel-tab right-tab" onClick={() => setRightCollapsed(!rightCollapsed)} title={rightCollapsed ? "Expand" : "Collapse"}>
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
