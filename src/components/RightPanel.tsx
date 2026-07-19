import React, { useMemo, useCallback } from "react";
import { useStore } from "../store/useStore";
import { detectPlanarFragments, CoplanarSet } from "../engine/coplanarity";
import { searchExtremeConformations } from "../engine/conformerSearch";
import { t } from "../i18n/index";

export const RightPanel: React.FC = () => {
  const molecule = useStore((s) => s.molecule);
  const selected = useStore((s) => s.selected);
  const rotatingBond = useStore((s) => s.rotatingBond);
  const setRotatingBond = useStore((s) => s.setRotatingBond);
  const rotationAngle = useStore((s) => s.rotationAngle);
  const setRotationAngle = useStore((s) => s.setRotationAngle);
  const highlightCoplanar = useStore((s) => s.highlightCoplanar);
  const setHighlightCoplanar = useStore((s) => s.setHighlightCoplanar);
  const conformerStats = useStore((s) => s.conformerStats);
  const setConformerStats = useStore((s) => s.setConformerStats);
  const setMolecule = useStore((s) => s.setMolecule);
  const measureMode = useStore((s) => s.measureMode);
  const measureType = useStore((s) => s.measureType);
  const setMeasureType = useStore((s) => s.setMeasureType);
  const clearMeasurePoints = useStore((s) => s.clearMeasurePoints);
  const measurePoints = useStore((s) => s.measurePoints);
  // Language reactivity: force re-render when locale changes
  const _locale = useStore((s) => s.locale);

  // Prevent the 3D viewer from capturing pointer events on the right panel.
  // The OrbitControls calls domElement.setPointerCapture() on pointerdown,
  // which can keep capturing events even after the pointer leaves the canvas.
  const handlePanelPointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
  }, []);

  const planarFragments = useMemo<CoplanarSet[]>(() => {
    if (!molecule || !highlightCoplanar) return [];
    return detectPlanarFragments(molecule);
  }, [molecule, highlightCoplanar]);

  const selectedAtomFragment = useMemo(() => {
    if (!selected || selected.type !== "atom" || !highlightCoplanar) return null;
    return planarFragments.find((f) => f.atomIndices.includes(selected.index)) || null;
  }, [selected, planarFragments, highlightCoplanar]);

  // Cache last search result to avoid recomputation
  const lastSearchRef = React.useRef<{ molKey: string; result: any } | null>(null);

  const handleConformerSearch = useCallback((mode: "most" | "least") => {
    if (!molecule) return;

    // Build a key to check if the molecule has changed since last search
    const molKey = JSON.stringify({ atoms: molecule.atoms, bonds: molecule.bonds });
    let result;
    if (lastSearchRef.current?.molKey === molKey) {
      result = lastSearchRef.current.result;
    } else {
      result = searchExtremeConformations(molecule);
      lastSearchRef.current = { molKey, result };
    }

    // Set molecule to the requested conformation
    const targetMol = mode === "most" ? result.mostPlanar.molecule : result.leastPlanar.molecule;
    setMolecule(targetMol);

    // Display correct stats:
    // 可能 = max over all conformations of (largest planar fragment size)
    // 一定 = min over all conformations of (largest planar fragment size)
    setConformerStats({
      possible: result.mostPlanar.coplanarAtomCount,
      definite: result.leastPlanar.coplanarAtomCount,
    });
    setHighlightCoplanar(true);
  }, [molecule, setMolecule, setConformerStats, setHighlightCoplanar]);

  if (!molecule) {
    return (
      <div className="panel right-panel" onPointerDown={handlePanelPointerDown}>
        <h2 className="panel-title">{t("details")}</h2>
        <p className="hint-text">{t("clickHint")}</p>
      </div>
    );
  }

  const selectedAtom = selected?.type === "atom"
    ? molecule.atoms.find((a) => a.index === selected.index) : null;
  const selectedBond = selected?.type === "bond"
    ? molecule.bonds.find((b) => b.index === selected.index) : null;

  let bondLength: number | null = null;
  let bondAtoms = { atom1: undefined as typeof molecule.atoms[0] | undefined, atom2: undefined as typeof molecule.atoms[0] | undefined };
  if (selectedBond) {
    bondAtoms = {
      atom1: molecule.atoms.find((a) => a.index === selectedBond.atom1Idx),
      atom2: molecule.atoms.find((a) => a.index === selectedBond.atom2Idx),
    };
    if (bondAtoms.atom1 && bondAtoms.atom2) {
      const dx = bondAtoms.atom1.x - bondAtoms.atom2.x;
      const dy = bondAtoms.atom1.y - bondAtoms.atom2.y;
      const dz = bondAtoms.atom1.z - bondAtoms.atom2.z;
      bondLength = Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
  }

  return (
    <div className="panel right-panel" onPointerDown={handlePanelPointerDown}>
      <h2 className="panel-title">{t("details")}</h2>

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
              <div className="info-item"><span className="info-label">{t("coplanar")}</span><span className="info-value">{selectedAtomFragment.type}</span></div>
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
                onClick={() => setRotatingBond(rotatingBond?.index === selectedBond.index ? null : { type: "bond", index: selectedBond.index })}>
                {rotatingBond?.index === selectedBond.index ? t("stopRotation") : t("rotateBond")}
              </button>
              {rotatingBond?.index === selectedBond.index && (
                <div className="slider-container">
                  <input type="range" min="-180" max="180" value={rotationAngle}
                    onChange={(e) => setRotationAngle(parseInt(e.target.value))} className="slider" />
                  <span className="slider-value">{rotationAngle}°</span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {!selected && <p className="hint-text">{t("clickHint")}</p>}

      {measurePoints.length >= 2 && molecule && (
        <div className="section">
          <h3 className="section-title">{t("distance")}</h3>
          <div className="info-list">
            {(() => {
              const atoms = molecule.atoms;
              const ps = measurePoints.map(i => ({ x: atoms[i].x, y: atoms[i].y, z: atoms[i].z }));
              const dx = ps[0].x - ps[1].x, dy = ps[0].y - ps[1].y, dz = ps[0].z - ps[1].z;
              const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
              return [
                <div className="info-item" key="d12">
                  <span className="info-label">{t("distance")}</span>
                  <span className="info-value" style={{ color: "#44ff88" }}>{d.toFixed(2)} Å</span>
                </div>
              ];
            })()}
          </div>
        </div>
      )}

      {highlightCoplanar && planarFragments.length > 0 && (
        <div className="section">
          <h3 className="section-title">{t("coplanar")}</h3>
          {/* Only show chemically meaningful fragments (ring, alkene, carbonyl).
              Chain fragments are too numerous (especially for sp2 rings like
              benzene) and push the button section below the viewport, making
              the right panel un- scrollable and unfocusable. */}
          {planarFragments.filter(f => f.type !== "chain" && f.type !== "other").slice(0, 8).map((frag, fi) => (
            <div key={fi} className="info-list" style={{ marginBottom: 6 }}>
              <div className="info-item" style={{ color: frag.type === "ring" ? "#44aaff" : frag.type === "carbonyl" ? "#88dd44" : "#ffaa44" }}>
                <span className="info-label">{frag.type}</span>
                <span className="info-value">{frag.atomIndices.length} atoms</span>
              </div>
            </div>
          ))}
          {/* Summary info: count of chain fragments */}
          {(() => {
            const chainCount = planarFragments.filter(f => f.type === "chain").length;
            if (chainCount === 0) return null;
            return (
              <div className="info-item" style={{ color: "#666688", fontSize: 11, marginTop: 2 }}>
                <span className="info-label">chains</span>
                <span className="info-value">{chainCount} fragments</span>
              </div>
            );
          })()}
        </div>
      )}

      {/* Measure tools */}
      <div className="section">
        <h3 className="section-title">{t("tools")}</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div className="mode-toggle">
            <button className={`btn mode-btn ${measureType === "distance" ? "active" : ""}`}
              onClick={() => setMeasureType(measureType === "distance" ? null : "distance")} style={{ fontSize: 11 }}>{t("distance")}</button>
            <button className={`btn mode-btn ${measureType === "angle" ? "active" : ""}`}
              onClick={() => setMeasureType(measureType === "angle" ? null : "angle")} style={{ fontSize: 11 }}>{t("angle")}</button>
            <button className={`btn mode-btn ${measureType === "dihedral" ? "active" : ""}`}
              onClick={() => setMeasureType(measureType === "dihedral" ? null : "dihedral")} style={{ fontSize: 11 }}>{t("dihedralShort")}</button>
          </div>
          {measureMode && <div style={{ fontSize: 10, color: "#8888aa", textAlign: "center", marginTop: 4 }}>{t("rightClickCancel")}</div>}
          {measurePoints.length > 0 && <button className="btn btn-small" onClick={() => clearMeasurePoints()} style={{ fontSize: 11, color: "#ff6666", marginTop: 4 }}>{t("clear")}</button>}
        </div>
      </div>

      {/* Coplanarity toggle */}
      <div className="section">
        <h3 className="section-title">{t("visualAids")}</h3>
        <label className="toggle-label">
          <input type="checkbox" checked={highlightCoplanar} onChange={(e) => setHighlightCoplanar(e.target.checked)} />
          <span>{t("highlightCoplanar")}</span>
        </label>
      </div>

      {/* Conformer search */}
      {molecule && (
        <div className="section">
          <h3 className="section-title">{t("conformerSearch")}</h3>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <button className="btn btn-small" onClick={() => handleConformerSearch("most")} style={{ width: "100%", fontSize: 11 }}>
              {t("searchMostPlanar")}
            </button>
            <button className="btn btn-small" onClick={() => handleConformerSearch("least")} style={{ width: "100%", fontSize: 11 }}>
              {t("searchLeastPlanar")}
            </button>
            {conformerStats !== null && (
              <div className="info-list" style={{ marginTop: 4 }}>
                <div className="info-item">
                  <span className="info-label" style={{ color: "#44aaff" }}>{t("possibleCoplanar")}</span>
                  <span className="info-value">{conformerStats.possible}</span>
                </div>
                <div className="info-item">
                  <span className="info-label" style={{ color: "#44cc88" }}>{t("definiteCoplanar")}</span>
                  <span className="info-value">{conformerStats.definite}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
