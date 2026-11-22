import React, { useCallback, useMemo } from "react";
import { useStore } from "../store/useStore";
import { detectPlanarFragments, type CoplanarSet } from "../engine/coplanarity";
import { t } from "../i18n/index";
import { RightPanelSelection } from "./RightPanelSelection";
import { RightPanelMeasurement } from "./RightPanelMeasurement";
import { RightPanelCoplanarity } from "./RightPanelCoplanarity";
import { RightPanelConformer } from "./RightPanelConformer";

export const RightPanel: React.FC = () => {
  const molecule = useStore((s) => s.molecule);
  const selected = useStore((s) => s.selected);
  const rotatingBond = useStore((s) => s.rotatingBond);
  const setRotatingBond = useStore((s) => s.setRotatingBond);
  const rotationAngle = useStore((s) => s.rotationAngle);
  const setRotationAngle = useStore((s) => s.setRotationAngle);
  const highlightCoplanar = useStore((s) => s.highlightCoplanar);
  const setHighlightCoplanar = useStore((s) => s.setHighlightCoplanar);
  const measureMode = useStore((s) => s.measureMode);
  const measureType = useStore((s) => s.measureType);
  const setMeasureType = useStore((s) => s.setMeasureType);
  const clearMeasurePoints = useStore((s) => s.clearMeasurePoints);
  const measurePoints = useStore((s) => s.measurePoints);
  // Language reactivity: force re-render when locale changes.
  useStore((s) => s.locale);

  const coplanarTypeLabel = (type: CoplanarSet["type"]): string => {
    if (type === "ring") return t("coplanarRing");
    if (type === "alkene") return t("coplanarAlkene");
    if (type === "carbonyl") return t("coplanarCarbonyl");
    return t("coplanarOther");
  };

  // Prevent the 3D viewer from capturing pointer events on the right panel.
  // OrbitControls calls setPointerCapture() on pointerdown, which can keep
  // capturing events even after the pointer leaves the canvas.
  const handlePanelPointerDown = useCallback((event: React.PointerEvent) => {
    event.stopPropagation();
  }, []);

  const planarFragments = useMemo<CoplanarSet[]>(() => {
    if (!molecule || !highlightCoplanar) return [];
    return detectPlanarFragments(molecule);
  }, [molecule, highlightCoplanar]);

  const selectedAtomFragment = useMemo(() => {
    if (!selected || selected.type !== "atom" || !highlightCoplanar) return null;
    return planarFragments.find((fragment) => fragment.atomIndices.includes(selected.index)) || null;
  }, [selected, planarFragments, highlightCoplanar]);

  if (!molecule) {
    return (
      <div className="panel right-panel" onPointerDown={handlePanelPointerDown}>
        <h2 className="panel-title">{t("details")}</h2>
        <p className="hint-text">{t("clickHint")}</p>
      </div>
    );
  }

  const selectedAtom = selected?.type === "atom"
    ? molecule.atoms.find((atom) => atom.index === selected.index) ?? null
    : null;
  const selectedBond = selected?.type === "bond"
    ? molecule.bonds.find((bond) => bond.index === selected.index) ?? null
    : null;

  let bondLength: number | null = null;
  let bondAtoms: { atom1?: typeof molecule.atoms[0]; atom2?: typeof molecule.atoms[0] } = {};
  if (selectedBond) {
    bondAtoms = {
      atom1: molecule.atoms.find((atom) => atom.index === selectedBond.atom1Idx),
      atom2: molecule.atoms.find((atom) => atom.index === selectedBond.atom2Idx),
    };
    if (bondAtoms.atom1 && bondAtoms.atom2) {
      bondLength = Math.hypot(
        bondAtoms.atom1.x - bondAtoms.atom2.x,
        bondAtoms.atom1.y - bondAtoms.atom2.y,
        bondAtoms.atom1.z - bondAtoms.atom2.z,
      );
    }
  }

  return (
    <div className="panel right-panel" onPointerDown={handlePanelPointerDown}>
      <h2 className="panel-title">{t("details")}</h2>

      <RightPanelSelection
        selectedAtom={selectedAtom}
        selectedBond={selectedBond}
        bondAtoms={bondAtoms}
        bondLength={bondLength}
        selectedAtomFragment={selectedAtomFragment}
        coplanarTypeLabel={coplanarTypeLabel}
        rotatingBondIndex={rotatingBond?.index ?? null}
        rotationAngle={rotationAngle}
        onToggleRotation={(bond) => setRotatingBond(
          rotatingBond?.index === bond.index ? null : { type: "bond", index: bond.index },
        )}
        onRotationAngle={setRotationAngle}
      />

      {!selected && <p className="hint-text">{t("clickHint")}</p>}

      <RightPanelMeasurement
        molecule={molecule}
        measurePoints={measurePoints}
        measureMode={measureMode}
        measureType={measureType}
        onMeasureType={setMeasureType}
        onClear={clearMeasurePoints}
      />

      <RightPanelCoplanarity
        highlightCoplanar={highlightCoplanar}
        fragments={planarFragments}
        typeLabel={coplanarTypeLabel}
        onToggle={setHighlightCoplanar}
      />

      <RightPanelConformer molecule={molecule} />
    </div>
  );
};
