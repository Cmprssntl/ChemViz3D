import React from "react";
import { t } from "../i18n/index";
import { useStore } from "../store/useStore";
import { useNaming } from "../naming/useNaming";

/** Name-source badge plus regenerate / clear-cache actions. */
export const NamingControls: React.FC = () => {
  const molecule = useStore((s) => s.molecule);
  const { regenerate, clearAll, regenerating, canRegenerate } = useNaming();
  if (!molecule) return null;

  return (
    <div className="section">
      <h3 className="section-title">{t("naming")}</h3>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <button
          className="btn btn-small"
          onClick={regenerate}
          disabled={regenerating || !canRegenerate}
          title={canRegenerate ? undefined : t("namingRegenerateUnavailable")}
          style={{ fontSize: 11 }}
        >
          {regenerating ? "…" : t("namingRegenerate")}
        </button>
        <button className="btn btn-small" onClick={clearAll} style={{ fontSize: 11 }}>
          {t("clearNamingCache")}
        </button>
      </div>
    </div>
  );
};

/** Badge for the current IUPAC name source, or nothing for legacy objects. */
export const NamingSourceBadge: React.FC<{ source?: "preset" | "cache" | "ai" | "local" }> = ({ source }) => {
  if (!source) return null;
  const label = {
    preset: t("namingSourcePreset"),
    cache: t("namingSourceCache"),
    ai: t("namingSourceAi"),
    local: t("namingSourceLocal"),
  }[source];
  return <span className={`naming-badge naming-badge-${source}`}>{label}</span>;
};
