import React, { useMemo } from "react";
import { t } from "../i18n/index";
import { useStore } from "../store/useStore";
import { calcMoleculeProperties } from "../engine/properties";
import type { MoleculeProperties } from "../engine/properties";

interface LeftPanelProps {
  onProcessFormula: (formula: string) => void;
  onProcessChemVZFile: (file: File) => void;
}

export const LeftPanel: React.FC<LeftPanelProps> = ({ onProcessFormula, onProcessChemVZFile }) => {
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

  const molProps = useMemo<MoleculeProperties | null>(() => {
    if (!molecule) return null;
    return calcMoleculeProperties(molecule.atoms, molecule.bonds);
  }, [molecule]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputFormula.trim()) onProcessFormula(inputFormula.trim());
  };

  const examples = ["CH4","C2H6","C2H4","C2H2","C6H6","CH3OH","C2H5OH","CH3COOH","H2O","NH3","CO2"];

  return (<div className="panel left-panel"><h2 className="panel-title">Input</h2>
    <form onSubmit={handleSubmit} className="input-form">
      <input type="text" value={inputFormula} onChange={(e) => setInputFormula(e.target.value)}
        placeholder={t("inputPlaceholder")} className="formula-input" disabled={isLoading} />
      <button type="submit" className="btn btn-primary" disabled={isLoading || !inputFormula.trim()}>{isLoading ? t("processing") : t("visualize")}</button>
    </form>
    {error && <div className="error-banner">{error}</div>}
    <div className="section" style={{borderTop:"1px solid var(--border-color)"}}>
      <h3 className="section-title">{t("loadFromFile")}</h3>
      <label className="btn file-input-label" style={{width:"100%",textAlign:"center",cursor:"pointer"}}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
          <polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
        </svg>
        {t("openFile")}
        <input type="file" accept=".json" style={{display:"none"}} disabled={isLoading} onChange={(e) => {const f = e.target.files?.[0]; if (f) { onProcessChemVZFile(f); e.target.value = "";}}} />
      </label>
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
      <div className="examples-grid">{examples.map((ex) => (<button key={ex} className="btn example-btn" onClick={() => {setInputFormula(ex);onProcessFormula(ex);}} disabled={isLoading}>{ex}</button>))}</div>
    </div>
    <div className="section"><h3 className="section-title">{t("shortcuts")}</h3>
      <div className="info-list">
        <div className="info-item"><span className="info-label">R</span><span className="info-value">{t("shortcutReset")}</span></div>
        <div className="info-item"><span className="info-label">M</span><span className="info-value">{t("shortcutMeasure")}</span></div>
        <div className="info-item"><span className="info-label">F</span><span className="info-value">{t("shortcutFullscreen")}</span></div>
        <div className="info-item"><span className="info-label">Ctrl+S</span><span className="info-value">{t("shortcutScreenshot")}</span></div>
        <div className="info-item"><span className="info-label">Esc</span><span className="info-value">{t("shortcutExit")}</span></div>
      </div>
    </div>
    <div className="section"><h3 className="section-title">{t("settings")}</h3>
      <label className="toggle-label" style={{marginBottom:8}}>
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
    </div>
  </div>)
};
