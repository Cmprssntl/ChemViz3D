import React from "react";
import { t } from "../i18n/index";
import type { CoplanarSet } from "../engine/coplanarity";

interface RightPanelCoplanarityProps {
  highlightCoplanar: boolean;
  fragments: CoplanarSet[];
  typeLabel: (type: CoplanarSet["type"]) => string;
  onToggle: (value: boolean) => void;
}

/** Coplanar fragment summary and the highlight toggle. */
export const RightPanelCoplanarity: React.FC<RightPanelCoplanarityProps> = ({
  highlightCoplanar, fragments, typeLabel, onToggle,
}) => {
  // Chain fragments are too numerous (especially for sp2 rings like benzene)
  // and push the controls below the viewport, so the list keeps only the
  // chemically meaningful ring/alkene/carbonyl fragments.
  const shown = fragments.filter((fragment) => fragment.type !== "chain" && fragment.type !== "other").slice(0, 8);
  const chainCount = fragments.filter((fragment) => fragment.type === "chain").length;

  return (
    <>
      {highlightCoplanar && fragments.length > 0 && (
        <div className="section">
          <h3 className="section-title">{t("coplanar")}</h3>
          {shown.map((fragment, index) => (
            <div key={index} className="info-list" style={{ marginBottom: 6 }}>
              <div className="info-item" style={{ color: fragment.type === "ring" ? "#44aaff" : fragment.type === "carbonyl" ? "#88dd44" : "#ffaa44" }}>
                <span className="info-label">{typeLabel(fragment.type)}</span>
                <span className="info-value">{fragment.atomIndices.length} {t("atomsLabel")}</span>
              </div>
            </div>
          ))}
          {chainCount > 0 && (
            <div className="info-item" style={{ color: "#666688", fontSize: 11, marginTop: 2 }}>
              <span className="info-label">{t("coplanarChainLabel")}</span>
              <span className="info-value">{t("coplanarFragmentCount", { count: chainCount })}</span>
            </div>
          )}
        </div>
      )}

      <div className="section">
        <h3 className="section-title">{t("visualAids")}</h3>
        <label className="toggle-label">
          <input type="checkbox" checked={highlightCoplanar} onChange={(e) => onToggle(e.target.checked)} />
          <span>{t("highlightCoplanar")}</span>
        </label>
      </div>
    </>
  );
};
