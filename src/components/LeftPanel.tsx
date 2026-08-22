import React, { useEffect, useMemo, useState } from "react";
import { t } from "../i18n/index";
import { useStore } from "../store/useStore";
import { calcMoleculeProperties } from "../engine/properties";
import type { MoleculeProperties } from "../engine/properties";

interface LeftPanelProps {
  onProcessInput: (input: string, forceAI?: boolean) => void;
  onProcessChemVZFile: (file: File) => void;
  onRegenerate: (input: string) => void;
  onOpenAISettings: () => void;
  onClearCurrentCache: (input: string) => Promise<void>;
  onClearAllCache: () => Promise<void>;
  aiUnavailable: boolean;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({ onProcessInput, onProcessChemVZFile, onRegenerate, onOpenAISettings, onClearCurrentCache, onClearAllCache, aiUnavailable }) => {
  const [isTouchDevice, setIsTouchDevice] = useState(false);
  const [isAndroid, setIsAndroid] = useState(false);
  const inputFormula = useStore((s) => s.inputFormula);
  const setInputFormula = useStore((s) => s.setInputFormula);
  const displayMode = useStore((s) => s.displayMode);
  const setDisplayMode = useStore((s) => s.setDisplayMode);
  const molecule = useStore((s) => s.molecule);
  const error = useStore((s) => s.error);
  const infoMessage = useStore((s) => s.infoMessage);
  const isLoading = useStore((s) => s.isLoading);
  const locale = useStore((s) => s.locale);
  const setAppLocale = useStore((s) => s.setAppLocale);
  const labelDisplayMode = useStore((s) => s.labelDisplayMode);
  const setLabelDisplayMode = useStore((s) => s.setLabelDisplayMode);
  const conformerSearchQuality = useStore((s) => s.conformerSearchQuality);
  const setConformerSearchQuality = useStore((s) => s.setConformerSearchQuality);
  const parseSource = useStore((s) => s.parseSource);
  const currentCacheInput = useStore((s) => s.currentCacheInput);

  useEffect(() => {
    const update = () => setIsTouchDevice(
      navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches,
    );
    update();
    setIsAndroid(Boolean(window.ChemVizAndroid));
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  const molProps = useMemo<MoleculeProperties | null>(() => {
    if (!molecule) return null;
    return calcMoleculeProperties(molecule.atoms, molecule.bonds);
  }, [molecule]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputFormula.trim()) onProcessInput(inputFormula.trim());
  };

  const examples = ["CH4","C2H6","C2H4","C2H2","C6H6","C3H6","C4H8","C5H10","C6H12","C7H14","CH3OH","C2H5OH","CH3COOH","H2O","NH3","CO2"];

  return (<div className="panel left-panel"><h2 className="panel-title">{t("inputPanel")}</h2>
    {aiUnavailable && <div className="info-banner" role="status">{t("aiDisabledWarning")}</div>}
    <form onSubmit={handleSubmit} className="input-form">
      <input type="text" value={inputFormula} onChange={(e) => setInputFormula(e.target.value)}
        placeholder={t("inputPlaceholder")} className="formula-input" disabled={isLoading} />
      <button type="submit" className="btn btn-primary" disabled={isLoading || !inputFormula.trim()}>
        {isLoading ? t("processing") : t("visualize")}
      </button>
    </form>
    {error && <div className="error-banner">{error}</div>}
    {infoMessage && <div className="info-banner">{infoMessage}</div>}
    <div className="section" style={{borderTop:"1px solid var(--border-color)"}}>
      {isAndroid ? <button type="button" className="btn file-input-label" style={{width:"100%",textAlign:"center"}} onClick={() => window.ChemVizAndroid?.openImageChooser?.()} disabled={isLoading}>
        {t("fromImageParse")}
      </button> : <label className="btn file-input-label" style={{width:"100%",textAlign:"center",cursor:"pointer"}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {t("openFile")}
        <input type="file" accept=".json" style={{display:"none"}} disabled={isLoading} onChange={(e) => {const f = e.target.files?.[0]; if (f) { onProcessChemVZFile(f); e.target.value = "";}}} />
      </label>}
    </div>
    <div className="section"><h3 className="section-title">{t("displayMode")}</h3>
      <div className="mode-toggle">
        <button className={`btn mode-btn ${displayMode === "ball-and-stick" ? "active" : ""}`} onClick={() => setDisplayMode("ball-and-stick")}>{t("ballAndStick")}</button>
        <button className={`btn mode-btn ${displayMode === "space-filling" ? "active" : ""}`} onClick={() => setDisplayMode("space-filling")}>{t("spaceFilling")}</button>
      </div>
    </div>
    {molecule && (<div className="section"><h3 className="section-title">{t("moleculeInfo")}</h3>
      <div className="info-list">
        <div className="info-item"><span className="info-label">{t("formula")}</span><span className="info-value">{molecule.formula}</span></div>
        <div className="info-item"><span className="info-label">{t("name")}</span><span className="info-value">{molecule.name}</span></div>
        <div className="info-item"><span className="info-label">{t("smiles")}</span><span className="info-value">{molecule.smiles}</span></div>
        <div className="info-item"><span className="info-label">{t("atoms")}</span><span className="info-value">{molecule.atoms.length}</span></div>
        <div className="info-item"><span className="info-label">{t("bonds")}</span><span className="info-value">{molecule.bonds.length}</span></div>
      </div>
    </div>)}
    {molProps && (<div className="section"><h3 className="section-title">{t("properties")}</h3>
      <div className="info-list">
        <div className="info-item"><span className="info-label">{t("molecularWeight")}</span><span className="info-value">{molProps.molecularWeight.toFixed(2)} g/mol</span></div>
        <div className="info-item"><span className="info-label">{t("logP")}</span><span className="info-value" style={{color:molProps.logP>5?"#ff6666":molProps.logP<0?"#66aaff":"#44cc88"}}>{molProps.logP.toFixed(2)}</span></div>
        <div className="info-item"><span className="info-label">{t("hbd")}</span><span className="info-value">{molProps.hBondDonors}</span></div>
        <div className="info-item"><span className="info-label">{t("hba")}</span><span className="info-value">{molProps.hBondAcceptors}</span></div>
        <div className="info-item"><span className="info-label">{t("rotatableBonds")}</span><span className="info-value">{molProps.rotatableBonds}</span></div>
        <div className="info-item"><span className="info-label">{t("tpsa")}</span><span className="info-value">{molProps.tpsa.toFixed(1)} {t("unitA2")}</span></div>
      </div>
    </div>)}
    <div className="section"><h3 className="section-title">{t("examples")}</h3>
      <div className="examples-grid">{examples.map((ex) => (<button key={ex} className="btn example-btn" onClick={() => {setInputFormula(ex);onProcessInput(ex);}} disabled={isLoading}>{ex}</button>))}</div>
    </div>
    <div className="section"><h3 className="section-title">{t(isTouchDevice ? "touchHelp" : "shortcuts")}</h3>
      {isTouchDevice ? (
        <div className="info-list">
          <div className="touch-tip">{t("touchDragRotate")}</div>
          <div className="touch-tip">{t("touchPinchZoom")}</div>
          <div className="touch-tip">{t("touchTwoFingerPan")}</div>
          <div className="touch-tip">{t("touchTapAtom")}</div>
          <div className="touch-tip">{t("touchTapVisualize")}</div>
        </div>
      ) : (
        <div className="info-list">
          <div className="info-item"><span className="info-label">R</span><span className="info-value">{t("shortcutReset")}</span></div>
          <div className="info-item"><span className="info-label">Ctrl+S</span><span className="info-value">{t("shortcutScreenshot")}</span></div>
        </div>
      )}
    </div>
    <div className="section"><h3 className="section-title">{t("settings")}</h3>
      <div className="settings-stack">
        <label className="toggle-label">
          <span style={{fontSize:12}}>{t("language")}</span>
          <select value={locale} onChange={(e) => setAppLocale(e.target.value as any)}
            style={{marginLeft:"auto",padding:"2px 6px",fontSize:11,background:"var(--bg-tertiary)",color:"var(--text-primary)",border:"1px solid var(--border-color)",borderRadius:4}}>
            <option value="zh-CN">简体中文</option>
            <option value="zh-TW">繁體中文</option>
            <option value="en-US">English</option>
          </select>
        </label>
        <label className="toggle-label">
          <span style={{fontSize:12}}>{t("labelDisplay")}</span>
          <select value={labelDisplayMode} onChange={(e) => setLabelDisplayMode(e.target.value as any)}
            style={{marginLeft:"auto",padding:"2px 6px",fontSize:11,background:"var(--bg-tertiary)",color:"var(--text-primary)",border:"1px solid var(--border-color)",borderRadius:4}}>
            <option value="always">{t("labelAlways")}</option>
            <option value="hover">{t("labelHover")}</option>
            <option value="never">{t("labelNever")}</option>
          </select>
        </label>
        <label className="toggle-label">
          <span style={{fontSize:12}}>{t("conformerSearchQuality")}</span>
          <select value={conformerSearchQuality} onChange={(e) => setConformerSearchQuality(e.target.value as "fast" | "balanced" | "precise")}
            style={{marginLeft:"auto",padding:"2px 6px",fontSize:11,background:"var(--bg-tertiary)",color:"var(--text-primary)",border:"1px solid var(--border-color)",borderRadius:4}}>
            <option value="fast">{t("conformerSearchFast")}</option>
            <option value="balanced">{t("conformerSearchBalanced")}</option>
            <option value="precise">{t("conformerSearchPrecise")}</option>
          </select>
        </label>
        <button type="button" className="btn settings-open-button" onClick={onOpenAISettings}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-1.7 1.7-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V20h-2.4v-.2A1.7 1.7 0 0 0 11 18.24a1.7 1.7 0 0 0-1.88.34l-.06.06-1.7-1.7.06-.06A1.7 1.7 0 0 0 7.76 15 1.7 1.7 0 0 0 6.2 13.97H6v-2.4h.2A1.7 1.7 0 0 0 7.76 10a1.7 1.7 0 0 0-.34-1.88l-.06-.06 1.7-1.7.06.06A1.7 1.7 0 0 0 9.12 6.08 1.7 1.7 0 0 0 11 5.76V4h2.4v1.76a1.7 1.7 0 0 0 1.03.32 1.7 1.7 0 0 0 1.88-.34l.06-.06 1.7 1.7-.06.06A1.7 1.7 0 0 0 16.24 10a1.7 1.7 0 0 0 1.56 1.03H18v2.4h-.2A1.7 1.7 0 0 0 16.24 15Z" />
          </svg>
          {t("aiSettings")}
        </button>
        <div className="cache-actions">
          {currentCacheInput && (parseSource === "cache" || parseSource === "ai") && <>
            {parseSource === "ai" && <button type="button" className="btn settings-open-button" onClick={() => onRegenerate(currentCacheInput)} disabled={isLoading}>{t("regenerate")}</button>}
            <button type="button" className="btn settings-open-button" onClick={() => void onClearCurrentCache(currentCacheInput)} disabled={isLoading}>{t("clearCurrentCache")}</button>
          </>}
          <button type="button" className="btn settings-open-button" onClick={() => void onClearAllCache()} disabled={isLoading}>{t("clearAllCache")}</button>
        </div>
      </div>
    </div>
  </div>)
};
