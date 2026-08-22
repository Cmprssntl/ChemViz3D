import { create } from "zustand";
import type { MoleculeData, DisplayMode, SelectedEntity, LabelDisplayMode } from "../types/molecule";
import type { ConformerSearchQuality } from "../engine/conformerSearch";
import type { LocaleKey } from "../i18n/index";
import { setLocale } from "../i18n/index";
import {
  cacheUISettings,
  getUISettings,
  normalizeUISettings,
  saveUISettingsToDesktopBridge,
  type UISettings,
} from "../ai/config";

function persistUISettings(patch: Partial<UISettings>): UISettings {
  const settings = cacheUISettings(normalizeUISettings({ ...getUISettings(), ...patch }));
  void saveUISettingsToDesktopBridge(settings).catch((error) => console.error(error));
  return settings;
}

const persistedUISettings = getUISettings();
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
  parseSource: "preset" | "cache" | "ai" | null;
  currentCacheInput: string | null;
  setParseSource: (source: "preset" | "cache" | "ai" | null, input?: string | null) => void;
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
  conformerSearchQuality: ConformerSearchQuality;
  setConformerSearchQuality: (quality: ConformerSearchQuality) => void;
  conformerStats: { possible: number; definite: number } | null;
  setConformerStats: (stats: { possible: number; definite: number } | null) => void;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  setLeftCollapsed: (collapsed: boolean) => void;
  setRightCollapsed: (collapsed: boolean) => void;
  setAppLocale: (l: LocaleKey) => void;
  applyUISettings: (settings: unknown) => void;
}

export const useStore = create<AppState>((set) => ({
  inputFormula: "",
  setInputFormula: (val) => set({ inputFormula: val }),

  molecule: null,
  isLoading: false,
  error: null,
  infoMessage: null,
  parseSource: null,
  currentCacheInput: null,
  rdkitReady: false,

  setMolecule: (mol) => set({ molecule: mol }),
  setLoading: (loading) => set({ isLoading: loading }),
  setError: (err) => set({ error: err }),
  setInfoMessage: (msg) => set({ infoMessage: msg }),
  setParseSource: (source, input = null) => set({ parseSource: source, currentCacheInput: input }),
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
  conformerSearchQuality: persistedUISettings.conformerSearchQuality,
  setConformerSearchQuality: (quality) => { set({ conformerSearchQuality: quality }); persistUISettings({ conformerSearchQuality: quality }); },
  conformerStats: null,
  setConformerStats: (stats) => set({ conformerStats: stats }),
  leftCollapsed: false,
  rightCollapsed: false,
  setLeftCollapsed: (collapsed) => set({ leftCollapsed: collapsed }),
  setRightCollapsed: (collapsed) => set({ rightCollapsed: collapsed }),
  setAppLocale: (l) => { set({ locale: l }); setLocale(l); persistUISettings({ locale: l }); },
  applyUISettings: (value) => {
    const settings = cacheUISettings(normalizeUISettings(value));
    setLocale(settings.locale);
    set({
      locale: settings.locale,
      displayMode: settings.displayMode,
      labelDisplayMode: settings.labelDisplayMode,
      conformerSearchQuality: settings.conformerSearchQuality,
    });
  },
}));
