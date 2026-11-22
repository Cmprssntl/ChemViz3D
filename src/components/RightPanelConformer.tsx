import React, { useCallback, useRef } from "react";
import { t } from "../i18n/index";
import { useStore } from "../store/useStore";
import { searchExtremeConformations, type ConformerSearchQuality } from "../engine/conformerSearch";
import type { MoleculeData } from "../types/molecule";

interface CachedSearch {
  sourceKey: string;
  resultKeys: Set<string>;
  quality: ConformerSearchQuality;
  result: ReturnType<typeof searchExtremeConformations>;
}

/** "Most/least planar" conformer search and its possible/definite summary. */
export const RightPanelConformer: React.FC<{ molecule: MoleculeData }> = ({ molecule }) => {
  const quality = useStore((s) => s.conformerSearchQuality);
  const stats = useStore((s) => s.conformerStats);
  const setMolecule = useStore((s) => s.setMolecule);
  const setConformerStats = useStore((s) => s.setConformerStats);
  const setHighlightCoplanar = useStore((s) => s.setHighlightCoplanar);
  const lastSearchRef = useRef<CachedSearch | null>(null);

  const handleSearch = useCallback((mode: "most" | "least") => {
    const molKey = JSON.stringify({ atoms: molecule.atoms, bonds: molecule.bonds });
    let result;
    if (lastSearchRef.current?.quality === quality
      && (lastSearchRef.current.sourceKey === molKey || lastSearchRef.current.resultKeys.has(molKey))) {
      result = lastSearchRef.current.result;
    } else {
      result = searchExtremeConformations(molecule, { quality });
      lastSearchRef.current = {
        sourceKey: molKey,
        quality,
        result,
        resultKeys: new Set([
          JSON.stringify({ atoms: result.mostPlanar.molecule.atoms, bonds: result.mostPlanar.molecule.bonds }),
          JSON.stringify({ atoms: result.leastPlanar.molecule.atoms, bonds: result.leastPlanar.molecule.bonds }),
        ]),
      };
    }

    setMolecule(mode === "most" ? result.mostPlanar.molecule : result.leastPlanar.molecule);
    // 可能 = max over conformations of the largest planar fragment;
    // 一定 = min over conformations of the largest planar fragment.
    setConformerStats({
      possible: result.mostPlanar.coplanarAtomCount,
      definite: result.leastPlanar.coplanarAtomCount,
    });
    setHighlightCoplanar(true);
  }, [molecule, quality, setMolecule, setConformerStats, setHighlightCoplanar]);

  return (
    <div className="section">
      <h3 className="section-title">{t("conformerSearch")}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <div className="info-item">
          <span className="info-label">{t("conformerSearchQuality")}</span>
          <span className="info-value">{t(`conformerSearch${quality[0].toUpperCase()}${quality.slice(1)}`)}</span>
        </div>
        <button className="btn btn-small" onClick={() => handleSearch("most")} style={{ width: "100%", fontSize: 11 }}>
          {t("searchMostPlanar")}
        </button>
        <button className="btn btn-small" onClick={() => handleSearch("least")} style={{ width: "100%", fontSize: 11 }}>
          {t("searchLeastPlanar")}
        </button>
        {stats !== null && (
          <div className="info-list" style={{ marginTop: 4 }}>
            <div className="info-item">
              <span className="info-label" style={{ color: "#44aaff" }}>{t("possibleCoplanar")}</span>
              <span className="info-value">{stats.possible}</span>
            </div>
            <div className="info-item">
              <span className="info-label" style={{ color: "#44cc88" }}>{t("definiteCoplanar")}</span>
              <span className="info-value">{stats.definite}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
