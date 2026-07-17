import React, { useCallback } from "react";
import { useStore } from "../store/useStore";
import { takeScreenshot } from "../utils/screenshot";
import { t } from "../i18n/index";

export const TopBar: React.FC = () => {
  const molecule = useStore((s) => s.molecule);
  const rdkitReady = useStore((s) => s.rdkitReady);
  // Required subscription: React re-renders on language change so t()
  // re-evaluates with the new locale.
  const _locale = useStore((s) => s.locale);

  const handleClose = useCallback(() => {
    window.close();
  }, []);

  const handleExport = useCallback(() => {
    if (!molecule) return;
    import("../types/moleculeFormat").then(({ moleculeDataToChemVZ }) => {
      const chemvz = moleculeDataToChemVZ(molecule.atoms, molecule.bonds, molecule.name);
      const blob = new Blob([JSON.stringify(chemvz, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = (molecule.name || molecule.formula || "molecule").replace(/\s+/g, "_") + ".chemvz.json";
      a.click();
      URL.revokeObjectURL(url);
    });
  }, [molecule]);

  return (
    <div className="top-bar">
      <div className="top-bar-left">
        <h1 className="app-title">{t("appTitle")}</h1>
        <span className="app-subtitle">{t("appSubtitle")}</span>
      </div>
      <div className="top-bar-right">
        <span className="status-badge" style={{ fontSize: 10 }}>
          {rdkitReady ? t("rdkitOn") : t("rdkitOff")}
        </span>
        {molecule && <span className="status-badge">{t("active")}</span>}
        {molecule && (<>
          <button className="btn btn-icon" title={t("exportJson")} onClick={handleExport}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="7 10 12 15 17 10" />
              <line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button className="btn btn-icon" title={t("screenshot")} onClick={() => takeScreenshot()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
        </>)}
        <button className="btn btn-icon" title={t("exit")} onClick={handleClose}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
};