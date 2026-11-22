import React from "react";
import { t } from "../i18n/index";
import type { AtomData, BondData } from "../types/molecule";
import type { CoplanarSet } from "../engine/coplanarity";

interface RightPanelSelectionProps {
  selectedAtom: AtomData | null;
  selectedBond: BondData | null;
  bondAtoms: { atom1?: AtomData; atom2?: AtomData };
  bondLength: number | null;
  selectedAtomFragment: CoplanarSet | null;
  coplanarTypeLabel: (type: CoplanarSet["type"]) => string;
  rotatingBondIndex: number | null;
  rotationAngle: number;
  onToggleRotation: (bond: BondData) => void;
  onRotationAngle: (angle: number) => void;
}

/** Atom/bond details and the single-bond rotation slider. */
export const RightPanelSelection: React.FC<RightPanelSelectionProps> = ({
  selectedAtom, selectedBond, bondAtoms, bondLength, selectedAtomFragment,
  coplanarTypeLabel, rotatingBondIndex, rotationAngle, onToggleRotation, onRotationAngle,
}) => (
  <>
    {selectedAtom && (
      <div className="section">
        <h3 className="section-title">{t("atomProperties")}</h3>
        <div className="info-list">
          <div className="info-item"><span className="info-label">{t("element")}</span><span className="info-value">{selectedAtom.element}</span></div>
          <div className="info-item"><span className="info-label">{t("index")}</span><span className="info-value">{selectedAtom.index}</span></div>
          {selectedAtom.hybridization && <div className="info-item"><span className="info-label">{t("hybridization")}</span><span className="info-value">{selectedAtom.hybridization}</span></div>}
          {selectedAtom.charge !== undefined && <div className="info-item"><span className="info-label">{t("charge")}</span><span className="info-value">{selectedAtom.charge}</span></div>}
          {selectedAtom.mass && <div className="info-item"><span className="info-label">{t("mass")}</span><span className="info-value">{selectedAtom.mass.toFixed(3)}</span></div>}
          <div className="info-item"><span className="info-label">{t("position")}</span><span className="info-value">({selectedAtom.x.toFixed(2)}, {selectedAtom.y.toFixed(2)}, {selectedAtom.z.toFixed(2)})</span></div>
          {selectedAtomFragment && (
            <div className="info-item"><span className="info-label">{t("coplanar")}</span><span className="info-value">{coplanarTypeLabel(selectedAtomFragment.type)}</span></div>
          )}
        </div>
      </div>
    )}

    {selectedBond && (
      <div className="section">
        <h3 className="section-title">{t("bondProperties")}</h3>
        <div className="info-list">
          <div className="info-item"><span className="info-label">{t("index")}</span><span className="info-value">{selectedBond.index}</span></div>
          <div className="info-item"><span className="info-label">{t("bondOrder")}</span><span className="info-value">{selectedBond.order}</span></div>
          <div className="info-item"><span className="info-label">{t("atom1")}</span><span className="info-value">{bondAtoms.atom1?.element} (#{selectedBond.atom1Idx})</span></div>
          <div className="info-item"><span className="info-label">{t("atom2")}</span><span className="info-value">{bondAtoms.atom2?.element} (#{selectedBond.atom2Idx})</span></div>
          {bondLength !== null && <div className="info-item"><span className="info-label">{t("lengthShort")}</span><span className="info-value">{bondLength.toFixed(3)} A</span></div>}
        </div>

        {selectedBond.order === 1 && (
          <div className="rotation-controls" style={{ marginTop: 8 }}>
            <button className="btn btn-small"
              onClick={() => onToggleRotation(selectedBond)}>
              {rotatingBondIndex === selectedBond.index ? t("stopRotation") : t("rotateBond")}
            </button>
            {rotatingBondIndex === selectedBond.index && (
              <div className="slider-container">
                <input type="range" min="-180" max="180" value={rotationAngle}
                  onChange={(e) => onRotationAngle(parseInt(e.target.value))} className="slider" />
                <span className="slider-value">{rotationAngle}°</span>
              </div>
            )}
          </div>
        )}
      </div>
    )}
  </>
);
