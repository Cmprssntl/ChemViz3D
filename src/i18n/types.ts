/** Shape of a translation map for one locale. */
export interface TranslationMap {
  // App / TopBar
  appTitle: string;
  appSubtitle: string;
  rdkitOn: string;
  rdkitOff: string;
  active: string;
  exportJson: string;
  screenshot: string;
  exit: string;

  // LeftPanel
  inputPlaceholder: string;
  visualize: string;
  processing: string;
  invalidFormula: string;
  displayMode: string;
  ballAndStick: string;
  spaceFilling: string;
  moleculeInfo: string;
  formula: string;
  name: string;
  smiles: string;
  atoms: string;
  bonds: string;
  loadFromFile: string;
  openFile: string;
  examples: string;

  // RightPanel
  details: string;
  clickHint: string;
  atomProperties: string;
  element: string;
  index: string;
  hybridization: string;
  charge: string;
  mass: string;
  position: string;
  coplanar: string;
  bondProperties: string;
  bondOrder: string;
  atom1: string;
  atom2: string;
  lengthShort: string;
  rotateBond: string;
  stopRotation: string;
  visualAids: string;
  highlightCoplanar: string;
  measure: string;
  measuring: string;
  tools: string;
  distance: string;
  angle: string;
  dihedralShort: string;
  atomsLabel: string;

  // Viewer overlays
  processingMol: string;
  enterFormula: string;
  measureClick1: string;
  measureClick2: string;
  measureClick3: string;
  measureClick4: string;
  measureMode: string;

  // File handling
  errorInvalidFile: string;
  errorBuild: string;
  errorFile: string;

  // Keyboard
  shortcuts: string;
  shortcutReset: string;
  shortcutMeasure: string;
  shortcutFullscreen: string;
  shortcutScreenshot: string;
  shortcutExit: string;
  settings: string;
  language: string;
  labelDisplay: string;
  labelAlways: string;
  labelHover: string;
  labelNever: string;
  rightClickCancel: string;
  clear: string;

  // Properties (new)
  properties: string;
  molecularWeight: string;
  logP: string;
  hbd: string;
  hba: string;
  rotatableBonds: string;
  tpsa: string;
  lipinski: string;
  lipinskiPass: string;
  lipinskiFail: string;
  propertyMW: string;
  unitA2: string;
    conformerSearch: string;
  searchMostPlanar: string;
  searchLeastPlanar: string;
  possibleCoplanar: string;
  definiteCoplanar: string;
  noCoplanarFound: string;
  [key: string]: string;
}
