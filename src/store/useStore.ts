import { create } from "zustand";
import type { MoleculeData, DisplayMode, SelectedEntity, LabelDisplayMode } from "../types/molecule";
import type { LocaleKey } from "../i18n/index";
import { setLocale } from "../i18n/index";

const UI_SETTINGS_STORAGE_KEY = "chemviz3d.ui-settings.v1";
const LOCALES = new Set<LocaleKey>(["zh-CN", "zh-TW", "en-US"]);
const DISPLAY_MODES = new Set<DisplayMode>(["ball-and-stick", "space-filling"]);
const LABEL_MODES = new Set<LabelDisplayMode>(["always", "hover", "never"]);

interface PersistedUISettings {
  locale?: unknown;
  displayMode?: unknown;
  labelDisplayMode?: unknown;
}

function readPersistedUISettings(): { locale: LocaleKey; displayMode: DisplayMode; labelDisplayMode: LabelDisplayMode } {
  const fallback = { locale: "zh-CN" as LocaleKey, displayMode: "ball-and-stick" as DisplayMode, labelDisplayMode: "always" as LabelDisplayMode };
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(UI_SETTINGS_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as PersistedUISettings;
    return {
      locale: LOCALES.has(parsed.locale as LocaleKey) ? parsed.locale as LocaleKey : fallback.locale,
      displayMode: DISPLAY_MODES.has(parsed.displayMode as DisplayMode) ? parsed.displayMode as DisplayMode : fallback.displayMode,
      labelDisplayMode: LABEL_MODES.has(parsed.labelDisplayMode as LabelDisplayMode)
        ? parsed.labelDisplayMode as LabelDisplayMode
        : fallback.labelDisplayMode,
    };
  } catch {
    return fallback;
  }
}

function persistUISettings(patch: Partial<PersistedUISettings>): void {
  if (typeof window === "undefined") return;
  try {
    const current = readPersistedUISettings();
    window.localStorage.setItem(UI_SETTINGS_STORAGE_KEY, JSON.stringify({ ...current, ...patch }));
  } catch {
    // Ignore unavailable browser storage.
  }
}

const persistedUISettings = readPersistedUISettings();
setLocale(persistedUISettings.locale);

interface AppState {
  inputFormula: string;
  setInputFormula: (val: string) => void;

  molecule: MoleculeData | null;
  isLoading: boolean;
  error: string | null;
  infoMessage: string | null;
  rdkitReady: boolean;

  setMolecule: (mol: MoleculeData | null) => void;
  setLoading: (loading: boolean) => void;
  setError: (err: string | null) => void;
  setInfoMessage: (msg: string | null) => void;
  setRdkitReady: (ready: boolean) => void;

  displayMode: DisplayMode;
  setDisplayMode: (mode: DisplayMode) => void;

  selected: SelectedEntity | null;
  setSelected: (sel: SelectedEntity | null) => void;

  /** The bond currently being rotated (selected entity) */
  rotatingBond: SelectedEntity | null;
  /** Current rotation angle in degrees */
  rotationAngle: number;
  /** Snapshot of original atom positions when rotation started */
  originalPositions: Array<{ x: number; y: number; z: number }> | null;

  setRotatingBond: (bond: SelectedEntity | null) => void;
  setRotationAngle: (angle: number) => void;
  setOriginalPositions: (pos: Array<{ x: number; y: number; z: number }> | null) => void;

  highlightCoplanar: boolean;
  setHighlightCoplanar: (val: boolean) => void;


  /** Measurement mode */
  measureMode: boolean;
  setMeasureMode: (val: boolean) => void;
  /** Type of measurement to perform */
  measureType: 'distance' | 'angle' | 'dihedral' | null;
  setMeasureType: (type: 'distance' | 'angle' | 'dihedral' | null) => void;
  /** Atom indices queued for measurement (2=distance, 3=angle, 4=dihedral) */
  measurePoints: number[];
  setMeasurePoints: (pts: number[]) => void;
  clearMeasurePoints: () => void;

  /** Current UI locale */
  locale: LocaleKey;
  labelDisplayMode: LabelDisplayMode;
  setLabelDisplayMode: (mode: LabelDisplayMode) => void;
  conformerStats: { possible: number; definite: number } | null;
  setConformerStats: (stats: { possible: number; definite: number } | null) => void;
  setAppLocale: (l: LocaleKey) => void;
}

export const useStore = create<AppState>((set) => ({
  inputFormula: "",
  setInputFormula: (val) => set({ inputFormula: val }),

  molecule: null,
  isLoading: false,
  error: null,
  infoMessage: null,
  rdkitReady: false,

  setMolecule: (mol) => set({ molecule: mol }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (err) => set({ error: err }),
  setInfoMessage: (msg) => set({ infoMessage: msg }),
  setRdkitReady: (ready) => set({ rdkitReady: ready }),

  displayMode: persistedUISettings.displayMode,
  setDisplayMode: (mode) => { set({ displayMode: mode }); persistUISettings({ displayMode: mode }); },

  selected: null,
  setSelected: (sel) => set({ selected: sel }),

  rotatingBond: null,
  rotationAngle: 0,
  originalPositions: null,

  setRotatingBond: (bond) => set({ rotatingBond: bond, rotationAngle: 0, originalPositions: null }),
  setRotationAngle: (angle) => set({ rotationAngle: angle }),
  setOriginalPositions: (pos) => set({ originalPositions: pos }),

  highlightCoplanar: false,
  setHighlightCoplanar: (val) => set({ highlightCoplanar: val }),


  measureMode: false,
  setMeasureMode: (val) => set({ measureMode: val, measurePoints: [], selected: null }),
  measureType: null,
  setMeasureType: (type) => set({ measureType: type, measurePoints: [], measureMode: type !== null }),
  measurePoints: [],
  setMeasurePoints: (pts) => set({ measurePoints: pts }),
  clearMeasurePoints: () => set({ measurePoints: [] }),

  locale: persistedUISettings.locale,
  labelDisplayMode: persistedUISettings.labelDisplayMode,
  setLabelDisplayMode: (mode) => { set({ labelDisplayMode: mode }); persistUISettings({ labelDisplayMode: mode }); },
  conformerStats: null,
  setConformerStats: (stats) => set({ conformerStats: stats }),
  setAppLocale: (l) => { set({ locale: l }); setLocale(l); persistUISettings({ locale: l }); },
}));
