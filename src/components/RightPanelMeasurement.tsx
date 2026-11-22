import React from "react";
import { t } from "../i18n/index";
import type { MoleculeData } from "../types/molecule";

interface RightPanelMeasurementProps {
  molecule: MoleculeData;
  measurePoints: number[];
  measureMode: boolean;
  measureType: "distance" | "angle" | "dihedral" | null;
  onMeasureType: (type: "distance" | "angle" | "dihedral" | null) => void;
  onClear: () => void;
}

/** Distance readout plus the measurement mode buttons. */
export const RightPanelMeasurement: React.FC<RightPanelMeasurementProps> = ({
  molecule, measurePoints, measureMode, measureType, onMeasureType, onClear,
}) => (
  <>
    {measurePoints.length >= 2 && (
      <div className="section">
        <h3 className="section-title">{t("distance")}</h3>
        <div className="info-list">
          <div className="info-item">
            <span className="info-label">{t("distance")}</span>
            <span className="info-value" style={{ color: "#44ff88" }}>{distanceOf(molecule, measurePoints).toFixed(2)} Å</span>
          </div>
        </div>
      </div>
    )}

    <div className="section">
      <h3 className="section-title">{t("tools")}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="mode-toggle">
          <button className={`btn mode-btn ${measureType === "distance" ? "active" : ""}`}
            onClick={() => onMeasureType(measureType === "distance" ? null : "distance")} style={{ fontSize: 11 }}>{t("distance")}</button>
          <button className={`btn mode-btn ${measureType === "angle" ? "active" : ""}`}
            onClick={() => onMeasureType(measureType === "angle" ? null : "angle")} style={{ fontSize: 11 }}>{t("angle")}</button>
          <button className={`btn mode-btn ${measureType === "dihedral" ? "active" : ""}`}
            onClick={() => onMeasureType(measureType === "dihedral" ? null : "dihedral")} style={{ fontSize: 11 }}>{t("dihedralShort")}</button>
        </div>
        {measureMode && <div style={{ fontSize: 10, color: "#8888aa", textAlign: "center", marginTop: 4 }}>{t("rightClickCancel")}</div>}
        {measurePoints.length > 0 && <button className="btn btn-small" onClick={onClear} style={{ fontSize: 11, color: "#ff6666", marginTop: 4 }}>{t("clear")}</button>}
      </div>
    </div>
  </>
);

function distanceOf(molecule: MoleculeData, points: number[]): number {
  const first = molecule.atoms[points[0]];
  const second = molecule.atoms[points[1]];
  if (!first || !second) return 0;
  return Math.hypot(first.x - second.x, first.y - second.y, first.z - second.z);
}
