import React, { useCallback } from "react";
import { useStore } from "../store/useStore";
import { resetCameraView, takeScreenshot } from "../utils/screenshot";
import { t } from "../i18n/index";

export const TopBar: React.FC = () => {
  const molecule = useStore((s) => s.molecule);
  const rdkitReady = useStore((s) => s.rdkitReady);
  // Required subscription: React re-renders on language change so t()
  // re-evaluates with the new locale.
  const _locale = useStore((s) => s.locale);

  const handleClear = useCallback(() => {
    const state = useStore.getState();
    state.setMolecule(null);
    state.setError(null);
    state.setInfoMessage(null);
    state.setParseSource(null);
    state.setSelected(null);
    state.setRotatingBond(null);
    state.setMeasureMode(false);
    state.setMeasureType(null);
    state.setConformerStats(null);
  }, []);

  const handleResetView = useCallback(() => {
    resetCameraView();
    const state = useStore.getState();
    state.setSelected(null);
    state.setRotatingBond(null);
    state.clearMeasurePoints();
  }, []);

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
          <button className="btn btn-icon" title={t("screenshot")} onClick={() => takeScreenshot()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
          </button>
          <button className="btn btn-icon" title={t("resetView")} onClick={handleResetView}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
              <path d="M3 12a9 9 0 1 0 3-6.7" />
              <polyline points="3 4 3 10 9 10" />
            </svg>
          </button>
        </>)}
        <button className="btn btn-icon" title={t("clear")} onClick={handleClear}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
};
